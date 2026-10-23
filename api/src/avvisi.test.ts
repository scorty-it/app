// Le regole girano sempre; il giro completo (fotografia → avviso → Telegram e feed) solo su un database "_test" (lo svuota).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { sql } from 'kysely'
import { costruisciApp } from './app.ts'
import { decidiAvviso, inviaTelegram, leggiCanali, rssAvvisi, testoAvviso, type UltimoAvviso } from './avvisi.ts'
import { db, pool } from './db.ts'
import { BIT, zeriIniziali } from './firme.ts'
import { migra } from './migra.ts'
import { pulisci } from './pulizia.ts'

const ora = (h: number) => new Date(Date.UTC(2026, 9, 22, h)) // in Italia due ore in più (ora legale)
const f = (h: number, confermati: number) => ({ ora: ora(h), confermati })
const peggiorato = (h: number, confermati: number): UltimoAvviso => ({ tipo: 'peggiora', ora: ora(h), confermati })

test('avvisi: peggiora se i comuni confermati sono più di 6 ore prima', () => {
  assert.deepEqual(decidiAvviso(f(15, 4), f(9, 1), null), { tipo: 'peggiora', adesso: 4, prima: 1, ora_prima: ora(9) })
})

test('avvisi: niente se sono uguali o meno, se sono zero, o se manca la fotografia di 6 ore prima', () => {
  assert.equal(decidiAvviso(f(15, 3), f(9, 3), null), null)
  assert.equal(decidiAvviso(f(15, 2), f(9, 5), null), null)
  assert.equal(decidiAvviso(f(15, 0), f(9, 0), null), null)
  assert.equal(decidiAvviso(f(15, 2), null, null), null)
})

test('avvisi: al massimo uno ogni 6 ore per provincia', () => {
  assert.equal(decidiAvviso(f(15, 5), f(9, 1), peggiorato(11, 2)), null) // 4 ore dopo l'ultimo
  assert.equal(decidiAvviso(f(17, 5), f(11, 2), peggiorato(11, 2))?.tipo, 'peggiora') // 6 ore dopo
})

test('avvisi: migliora una volta sola, quando i confermati tornano a zero o alla metà', () => {
  assert.deepEqual(decidiAvviso(f(13, 4), f(7, 1), peggiorato(11, 8)), { tipo: 'migliora', adesso: 4, prima: 8, ora_prima: ora(11) })
  assert.equal(decidiAvviso(f(13, 0), null, peggiorato(11, 1))?.tipo, 'migliora')
  assert.equal(decidiAvviso(f(13, 5), f(7, 1), peggiorato(11, 8)), null) // non ancora la metà
  assert.equal(decidiAvviso(f(14, 0), f(8, 1), { tipo: 'migliora', ora: ora(13), confermati: 4 }), null)
})

test('avvisi: il testo, con l’ora italiana, l’hashtag della provincia e il link con la sua etichetta', () => {
  assert.equal(
    testoAvviso('SA', 'Salerno', { tipo: 'peggiora', adesso: 11, prima: 4, ora_prima: ora(9) }, 'https://scorty.it', 'telegram'),
    'Provincia di Salerno: in peggioramento #Salerno\n11 comuni senza carburante confermati, alle 11:00 erano 4.\n' +
      'Situazione aggiornata: https://scorty.it/province/SA?da=telegram',
  )
  assert.equal(
    testoAvviso('BT', 'Barletta-Andria-Trani', { tipo: 'migliora', adesso: 0, prima: 1, ora_prima: ora(9) }, 'https://scorty.it', 'rss'),
    'Provincia di Barletta-Andria-Trani: in miglioramento #BarlettaAndriaTrani\nNessun comune senza carburante confermato, alle 11:00 era 1.\n' +
      'Situazione aggiornata: https://scorty.it/province/BT?da=rss',
  )
  assert.match(testoAvviso('NA', 'Napoli', { tipo: 'peggiora', adesso: 1, prima: 0, ora_prima: ora(9) }, 'https://scorty.it', 'telegram'),
    /\n1 comune senza carburante confermato, alle 11:00 nessuno\./)
})

test('avvisi: Telegram nel canale della regione; di notte senza suono; un errore non ferma niente', async () => {
  const inviati: { url: string; corpo: Record<string, unknown> }[] = []
  const finta = (ok: boolean) => (async (url: string, init: RequestInit) => {
    inviati.push({ url, corpo: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 400 })
  }) as typeof fetch
  assert.equal(await inviaTelegram('123:abc', '@scorty_campania', 'ciao', new Date('2026-10-22T10:00:00Z'), finta(true)), true)
  assert.equal(inviati[0].url, 'https://api.telegram.org/bot123:abc/sendMessage')
  assert.deepEqual(inviati[0].corpo, { chat_id: '@scorty_campania', text: 'ciao', disable_notification: false, link_preview_options: { is_disabled: true } })
  await inviaTelegram('123:abc', '@scorty_campania', 'notte', new Date('2026-10-22T21:30:00Z'), finta(true)) // 23:30 in Italia
  assert.equal(inviati[1].corpo.disable_notification, true)
  assert.equal(await inviaTelegram('123:abc', '@scorty_campania', 'no', new Date(), finta(false), () => {}), false)
  const rotta = (async () => { throw new Error('rete') }) as typeof fetch
  assert.equal(await inviaTelegram('123:abc', '@scorty_campania', 'no', new Date(), rotta, () => {}), false)
})

test('avvisi: se Telegram non pubblica, il motivo va nei log; il token mai', async () => {
  const log: string[] = []
  const registra = (m: string) => void log.push(m)
  const rifiuta = (async () => new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 })) as typeof fetch
  assert.equal(await inviaTelegram('123:abc', '@scorty_sicilia', 'x', new Date(), rifiuta, registra), false)
  const rotta = (async () => { throw new Error('connessione rifiutata: https://api.telegram.org/bot123:abc/sendMessage') }) as typeof fetch
  assert.equal(await inviaTelegram('123:abc', '@scorty_sicilia', 'x', new Date(), rotta, registra), false)
  assert.deepEqual(log, [
    'Telegram @scorty_sicilia: Bad Request: chat not found',
    'Telegram @scorty_sicilia: connessione rifiutata: https://api.telegram.org/bot…/sendMessage',
  ])
})

test('avvisi: i canali dal .env, uno per regione', () => {
  assert.deepEqual(leggiCanali('Campania=@scorty_campania, Puglia=@scorty_puglia'), { Campania: '@scorty_campania', Puglia: '@scorty_puglia' })
  assert.deepEqual(leggiCanali(''), {})
  assert.deepEqual(leggiCanali(undefined), {})
  assert.deepEqual(leggiCanali('Campania=scorty_campania,=@x,Puglia'), {}) // senza @ o senza regione non vale
})

test('avvisi: il feed RSS della provincia, dal più recente, con i caratteri speciali al sicuro', () => {
  const xml = rssAvvisi('SA', 'Salerno', 'https://scorty.it', [
    { id: 2, provincia: 'SA', tipo: 'migliora', ora: ora(15), adesso: 1, prima: 4, ora_prima: ora(9) },
    { id: 1, provincia: 'SA', tipo: 'peggiora', ora: ora(9), adesso: 4, prima: 1, ora_prima: ora(3) },
  ])
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0">/)
  assert.match(xml, /<title>Scorty – avvisi carburante, provincia di Salerno<\/title>/)
  assert.ok(xml.indexOf('in miglioramento') < xml.indexOf('in peggioramento'))
  assert.match(xml, /<pubDate>Thu, 22 Oct 2026 15:00:00 GMT<\/pubDate>/)
  assert.match(xml, /<link>https:\/\/scorty.it\/province\/SA\?da=rss<\/link>/)
  assert.match(rssAvvisi('XX', 'A & <B>', 'https://scorty.it', []), /provincia di A &amp; &lt;B&gt;/)
})

const attivo = process.env.PGDATABASE?.endsWith('_test') ?? false

describe('avvisi dal database', { skip: !attivo && 'serve PGDATABASE che finisca con _test' }, () => {
  const inviati: { canale: string; testo: string }[] = []
  const app = costruisciApp({
    segreto: 's'.repeat(32),
    avvisi: { origine: 'https://scorty.it', canali: { Campania: '@scorty_campania' }, invia: async (canale, testo) => (inviati.push({ canale, testo }), true) },
  })
  app.log.level = 'silent'
  const SALERNO = { lat: 40.68, lon: 14.77 }
  let punto = 0

  async function segnalaFinito() {
    const s = (await app.inject({ url: '/api/sfida' })).json()
    let nonce = 0
    while (zeriIniziali(createHash('sha256').update(s.sfida + nonce).digest()) < BIT) nonce++
    const token = (await app.inject({ method: 'POST', url: '/api/dispositivo', payload: { sfida: s.sfida, firma: s.firma, nonce } })).json().token
    const r = await app.inject({
      method: 'POST', url: '/api/segnalazioni', headers: { authorization: `Bearer ${token}` },
      payload: { punto_id: punto, prodotto: 'gasolio', stato: 'esaurito', ...SALERNO },
    })
    assert.equal(r.statusCode, 200)
  }

  before(async () => {
    await migra(pool)
    await sql`truncate punti, dispositivi, segnalazioni, voti, code, viste, anomalie, correzioni, andamento, avvisi restart identity cascade`.execute(db)
    punto = (await sql<{ id: number }>`
      insert into punti (nome, geom, prodotti, fonte, id_fonte, comune, provincia)
      values ('Salerno 1', ST_MakePoint(${SALERNO.lon}, ${SALERNO.lat})::geography, '{gasolio}', 'test', 'sa1', 'Salerno', 'SA') returning id
    `.execute(db)).rows[0].id
  })
  after(async () => {
    await app.close()
    await db.destroy()
  })

  test('la fotografia dell’ora fa partire l’avviso nel canale della regione, una volta sola', async () => {
    // Due persone d'accordo: Salerno è senza carburante, confermato. Sei ore prima nessun comune.
    await segnalaFinito()
    await segnalaFinito()
    await sql`
      insert into andamento (provincia, ora, comuni_senza, comuni_senza_confermati, con_notizie, verde, giallo, rosso)
      values ('SA', date_trunc('hour', now()) - interval '6 hours', 0, 0, 0, 0, 0, 0)
    `.execute(db)
    await app.fotografaProvince()
    assert.equal(inviati.length, 1)
    assert.equal(inviati[0].canale, '@scorty_campania')
    assert.match(inviati[0].testo, /^Provincia di Salerno: in peggioramento #Salerno\n1 comune senza carburante confermato, alle \d\d:00 nessuno\./)
    const { rows } = await sql<{ tipo: string; inviato: boolean }>`select tipo, telegram_il is not null as inviato from avvisi`.execute(db)
    assert.deepEqual(rows, [{ tipo: 'peggiora', inviato: true }])
    await app.fotografaProvince() // la fotografia di quest'ora c'è già: niente di nuovo
    assert.equal(inviati.length, 1)
  })

  test('il feed RSS della provincia e i canali per la pagina degli avvisi', async () => {
    const r = await app.inject({ url: '/api/province/SA/avvisi.rss' })
    assert.equal(r.statusCode, 200)
    assert.match(r.headers['content-type'] as string, /application\/rss\+xml/)
    assert.match(r.body, /<title>Provincia di Salerno: in peggioramento<\/title>/)
    assert.equal((await app.inject({ url: '/api/province/ZZ/avvisi.rss' })).statusCode, 404)
    assert.deepEqual((await app.inject({ url: '/api/avvisi/canali' })).json(), [{ regione: 'Campania', canale: '@scorty_campania', link: 'https://t.me/scorty_campania' }])
  })

  test('la pulizia cancella gli avvisi con più di un anno', async () => {
    await sql`
      insert into avvisi (provincia, ora, tipo, adesso, prima, ora_prima) values
        ('NA', now() - interval '366 days', 'peggiora', 3, 1, now() - interval '366 days 6 hours'),
        ('NA', now() - interval '364 days', 'peggiora', 2, 1, now() - interval '364 days 6 hours')
    `.execute(db)
    await pulisci()
    const { rows } = await sql<{ adesso: number }>`select adesso from avvisi where provincia = 'NA'`.execute(db)
    assert.deepEqual(rows.map((r) => r.adesso), [2])
  })
})
