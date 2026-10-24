// Le regole girano sempre; il giro completo (fotografia → avviso → Telegram e feed) solo su un database "_test" (lo svuota).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { sql } from 'kysely'
import { costruisciApp } from './app.ts'
import { decidiAvviso, inviaTelegram, leggiCanali, rssAvvisi, testoAvviso, type UltimoAvviso, type Voci } from './avvisi.ts'
import { db, pool } from './db.ts'
import { BIT, zeriIniziali } from './firme.ts'
import { migra } from './migra.ts'
import { pulisci } from './pulizia.ts'

const ora = (h: number) => new Date(Date.UTC(2026, 9, 22, h)) // in Italia due ore in più (ora legale)
// Le voci di un avviso: i comuni senza carburante confermati e, per bene, quelli senza (null = di prima della spesa). Il terzo
// argomento, se c'è, è quanti negozi hanno notizie (0 = nessuna notizia dai negozi, null = di prima di quel dato).
const v = (carburante: number, beni: Record<string, number> | null = {}, spesa_con_notizie?: number | null): Voci =>
  spesa_con_notizie === undefined ? { carburante, beni } : { carburante, beni, spesa_con_notizie }
const f = (h: number, confermati: number) => ({ ora: ora(h), voci: v(confermati, null) })
const peggiorato = (h: number, confermati: number): UltimoAvviso => ({ tipo: 'peggiora', ora: ora(h), voci: v(confermati, null) })

test('avvisi: peggiora se i comuni confermati sono più di 6 ore prima', () => {
  assert.deepEqual(decidiAvviso(f(15, 4), f(9, 1), null), { tipo: 'peggiora', adesso: v(4, null), prima: v(1, null), ora_prima: ora(9) })
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
  assert.deepEqual(decidiAvviso(f(13, 4), f(7, 1), peggiorato(11, 8)), { tipo: 'migliora', adesso: v(4, null), prima: v(8, null), ora_prima: ora(11) })
  assert.equal(decidiAvviso(f(13, 0), null, peggiorato(11, 1))?.tipo, 'migliora')
  assert.equal(decidiAvviso(f(13, 5), f(7, 1), peggiorato(11, 8)), null) // non ancora la metà
  assert.equal(decidiAvviso(f(14, 0), f(8, 1), { tipo: 'migliora', ora: ora(13), voci: v(4, null) }), null)
})

test('avvisi: peggiora anche se sale solo un bene', () => {
  assert.equal(decidiAvviso({ ora: ora(16), voci: v(1, { acqua: 2 }) }, { ora: ora(10), voci: v(1, {}) }, null)?.tipo, 'peggiora')
})

test('avvisi: peggiora bene per bene, non sul totale', () => {
  // L'acqua sale da 0 a 2 anche se il pane scende da 2 a 0 e il totale cala.
  const a = decidiAvviso({ ora: ora(16), voci: v(1, { acqua: 2 }) }, { ora: ora(10), voci: v(1, { pane: 2 }) }, null)
  assert.deepEqual(a, { tipo: 'peggiora', adesso: v(1, { acqua: 2 }), prima: v(1, { pane: 2 }), ora_prima: ora(10) })
  // Un bene che cala o resta fermo non è una notizia.
  assert.equal(decidiAvviso({ ora: ora(16), voci: v(1, { acqua: 2 }) }, { ora: ora(10), voci: v(1, { acqua: 2, pane: 1 }) }, null), null)
})

test('avvisi: le fotografie di prima della spesa non fanno partire avvisi sulla spesa', () => {
  assert.equal(decidiAvviso({ ora: ora(16), voci: v(1, { acqua: 2 }) }, { ora: ora(10), voci: v(1, null) }, null), null)
  // Il carburante invece si confronta lo stesso.
  assert.equal(decidiAvviso({ ora: ora(16), voci: v(2, { acqua: 2 }) }, { ora: ora(10), voci: v(1, null) }, null)?.tipo, 'peggiora')
})

test('avvisi: una pausa sola per carburante e spesa', () => {
  assert.equal(decidiAvviso({ ora: ora(16), voci: v(1, { pane: 1 }) }, { ora: ora(10), voci: v(1, {}) }, { tipo: 'peggiora', ora: ora(13), voci: v(1, {}) }), null)
})

test('avvisi: niente miglioramento se intanto qualcosa è salito; il peggioramento aspetta la pausa', () => {
  const ultimo = { tipo: 'peggiora' as const, ora: ora(10), voci: v(3, {}) }
  assert.equal(decidiAvviso({ ora: ora(13), voci: v(1, { acqua: 2 }) }, { ora: ora(7), voci: v(1, {}) }, ultimo), null)
  assert.equal(decidiAvviso({ ora: ora(16), voci: v(1, { acqua: 2 }) }, { ora: ora(10), voci: v(3, {}) }, ultimo)?.tipo, 'peggiora')
})

test('avvisi: miglioramento quando ogni voce dell’ultimo avviso è a zero o alla metà', () => {
  const ultimo = { tipo: 'peggiora' as const, ora: ora(17), voci: v(0, { acqua: 2, pane: 3 }) }
  assert.equal(decidiAvviso({ ora: ora(20), voci: v(0, { acqua: 2 }) }, null, ultimo), null) // l'acqua manca come prima
  const a = decidiAvviso({ ora: ora(20), voci: v(0, { acqua: 1 }) }, null, ultimo)
  assert.deepEqual(a, { tipo: 'migliora', adesso: v(0, { acqua: 1 }), prima: v(0, { acqua: 2, pane: 3 }), ora_prima: ora(17) })
  // Una voce che nell'ultimo avviso era a zero e intanto è salita impedisce il miglioramento, anche con le altre a posto.
  assert.equal(decidiAvviso({ ora: ora(20), voci: v(1, {}) }, null, ultimo), null)
})

test('avvisi: se l’ultimo avviso è di prima della spesa, per il miglioramento contano solo i comuni senza carburante', () => {
  const ultimo = { tipo: 'peggiora' as const, ora: ora(10), voci: v(3, null) }
  // L'acqua adesso manca in 2 comuni, ma l'ultimo avviso non diceva niente della spesa: non è «salita».
  assert.equal(decidiAvviso({ ora: ora(13), voci: v(1, { acqua: 2 }) }, null, ultimo)?.tipo, 'migliora')
  assert.equal(decidiAvviso({ ora: ora(13), voci: v(2, { acqua: 2 }) }, null, ultimo), null) // il carburante non è ancora alla metà
})

test('avvisi: il testo, con l’ora italiana, l’hashtag della provincia e il link con la sua etichetta', () => {
  assert.equal(
    testoAvviso('SA', 'Salerno', { tipo: 'peggiora', adesso: v(11, null), prima: v(4, null), ora_prima: ora(9) }, 'https://scorty.it', 'telegram'),
    'Provincia di Salerno: in peggioramento #Salerno\n11 comuni senza carburante confermati, alle 11:00 erano 4.\n' +
      'Situazione aggiornata: https://scorty.it/province/SA?da=telegram',
  )
  assert.equal(
    testoAvviso('BT', 'Barletta-Andria-Trani', { tipo: 'migliora', adesso: v(0, null), prima: v(1, null), ora_prima: ora(9) }, 'https://scorty.it', 'rss'),
    'Provincia di Barletta-Andria-Trani: in miglioramento #BarlettaAndriaTrani\nNessun comune senza carburante confermato, alle 11:00 era 1.\n' +
      'Situazione aggiornata: https://scorty.it/province/BT?da=rss',
  )
  assert.match(testoAvviso('NA', 'Napoli', { tipo: 'peggiora', adesso: v(1, null), prima: v(0, null), ora_prima: ora(9) }, 'https://scorty.it', 'telegram'),
    /\n1 comune senza carburante confermato, alle 11:00 nessuno\./)
})

// `ora(8)` è «10:00» in Italia (ora legale).
const messaggio = (a: { adesso: Voci; prima: Voci }, tipo: 'peggiora' | 'migliora' = 'peggiora') =>
  testoAvviso('NA', 'Napoli', { tipo, ...a, ora_prima: ora(8) }, 'https://scorty.it', 'telegram')
const RIGA_LINK = 'Situazione aggiornata: https://scorty.it/province/NA?da=telegram'

test('avvisi: il testo con carburante e spesa', () => {
  assert.equal(
    messaggio({ adesso: v(3, { acqua: 2, pane: 1 }), prima: v(1, { pane: 1 }) }),
    'Provincia di Napoli: in peggioramento #Napoli\n' +
      'Carburante: 3 comuni senza, confermati; alle 10:00 era 1.\n' +
      'Spesa (comuni confermati): acqua in 2 comuni (prima nessuno), pane in 1 comune (come prima).\n' + RIGA_LINK,
  )
  // Le altre forme del carburante.
  assert.match(messaggio({ adesso: v(1, { acqua: 1 }), prima: v(0, {}) }), /\nCarburante: 1 comune senza, confermato; alle 10:00 nessuno\.\n/)
  assert.match(messaggio({ adesso: v(0, { acqua: 1 }), prima: v(3, {}) }), /\nCarburante: nessun comune senza; alle 10:00 erano 3\.\n/)
  // Il titolo segue il tipo.
  assert.match(messaggio({ adesso: v(0, {}), prima: v(3, { acqua: 2 }) }, 'migliora'), /^Provincia di Napoli: in miglioramento #Napoli\n/)
})

test('avvisi: nel messaggio la spesa compare per bene, solo i beni con qualcosa adesso o prima, nell’ordine dei beni', () => {
  const riga = (a: Voci, p: Voci) => messaggio({ adesso: a, prima: p }).split('\n')[2]
  assert.equal(riga(v(0, {}), v(0, {})), 'Spesa: nessun comune senza beni.')
  assert.equal(riga(v(0, {}), v(0, { pane: 2 })), 'Spesa (comuni confermati): pane in nessun comune (prima 2).')
  assert.equal(riga(v(0, { acqua: 2 }), v(0, null)), 'Spesa (comuni confermati): acqua in 2 comuni.') // senza confronto, niente parentesi
  assert.equal(riga(v(0, {}), v(0, null)), 'Spesa: nessun comune senza beni.')
  // Nomi di NOME_PRODOTTO e ordine di BENI, non quello delle chiavi.
  assert.equal(
    riga(v(0, { neonati: 1, frutta_verdura: 3, acqua: 1 }), v(0, { latte: 1 })),
    'Spesa (comuni confermati): acqua in 1 comune (prima nessuno), latte in nessun comune (prima 1), frutta e verdura in 3 comuni (prima nessuno), prodotti per neonati in 1 comune (prima nessuno).',
  )
})

test('avvisi: senza notizie dai negozi la riga della spesa non dice «nessun comune senza beni»', () => {
  const riga = (a: Voci, p: Voci) => messaggio({ adesso: a, prima: p }).split('\n')[2]
  // Nessun bene da elencare e nessun negozio con notizie: sembrerebbe che vada tutto bene, e invece non si sa.
  assert.equal(riga(v(0, {}, 0), v(0, {})), 'Spesa: nessuna notizia dai negozi.')
  assert.equal(riga(v(2, {}, 0), v(0, null)), 'Spesa: nessuna notizia dai negozi.') // anche senza confronto
  // Con almeno un negozio con notizie lo zero è vero.
  assert.equal(riga(v(0, {}, 1), v(0, {})), 'Spesa: nessun comune senza beni.')
  // Avvisi e fotografie di prima di questo dato (null o assente): come oggi.
  assert.equal(riga(v(0, {}, null), v(0, {})), 'Spesa: nessun comune senza beni.')
  assert.equal(riga(v(0, {}), v(0, {})), 'Spesa: nessun comune senza beni.')
  // Se c'è un bene da elencare l'elenco vince, con l'etichetta dei confermati.
  assert.equal(riga(v(0, { acqua: 1 }, 3), v(0, {})), 'Spesa (comuni confermati): acqua in 1 comune (prima nessuno).')
  // Se adesso nessun negozio ha notizie, «acqua in nessun comune (prima 2)» direbbe che l'acqua è tornata: non si sa (R18).
  assert.equal(riga(v(0, {}, 0), v(0, { acqua: 2 })), 'Spesa: nessuna notizia dai negozi.')
  // Il messaggio intero.
  assert.equal(
    messaggio({ adesso: v(3, {}, 0), prima: v(1, {}) }),
    'Provincia di Napoli: in peggioramento #Napoli\nCarburante: 3 comuni senza, confermati; alle 10:00 era 1.\nSpesa: nessuna notizia dai negozi.\n' + RIGA_LINK,
  )
})

test('avvisi: miglioramento senza notizie dai negozi: la spesa non entra nel confronto, conta solo il carburante', () => {
  const ultimo = { tipo: 'peggiora' as const, ora: ora(10), voci: v(1, { acqua: 1 }, 1) }
  // I beni sono scomparsi perché nessun negozio ha più notizie, non perché l'acqua è tornata; il carburante non è sceso: niente «migliora».
  assert.equal(decidiAvviso({ ora: ora(13), voci: v(1, {}, 0) }, null, ultimo), null)
  // Se il carburante è sceso alla metà, il miglioramento parte per il carburante e la spesa dice che non si sa.
  const a = decidiAvviso({ ora: ora(13), voci: v(0, {}, 0) }, null, ultimo)
  assert.deepEqual(a, { tipo: 'migliora', adesso: v(0, {}, 0), prima: v(1, { acqua: 1 }, 1), ora_prima: ora(10) })
  assert.equal(
    messaggio({ adesso: a!.adesso, prima: a!.prima }, 'migliora'),
    'Provincia di Napoli: in miglioramento #Napoli\nCarburante: nessun comune senza; alle 10:00 era 1.\nSpesa: nessuna notizia dai negozi.\n' + RIGA_LINK,
  )
  // Con almeno un negozio con notizie il confronto sui beni c'è come prima: l'acqua a zero fa «migliora»…
  assert.equal(decidiAvviso({ ora: ora(13), voci: v(0, {}, 2) }, null, ultimo)?.tipo, 'migliora')
  // …e l'acqua che non è calata no, anche con il carburante a posto.
  assert.equal(decidiAvviso({ ora: ora(13), voci: v(0, { acqua: 1 }, 2) }, null, ultimo), null)
})

test('avvisi: il miglioramento parte solo se almeno una voce peggiorata è stata davvero confrontata (R19)', () => {
  // L'ultimo avviso era solo per l'acqua (carburante 0) e adesso nessun negozio ha notizie: l'unica voce comparabile è un carburante
  // che era già a zero, e «0 contro 0» non dice che sia migliorato niente. Non si sa.
  const soloSpesa = { tipo: 'peggiora' as const, ora: ora(10), voci: v(0, { acqua: 2 }, 3) }
  assert.equal(decidiAvviso({ ora: ora(13), voci: v(0, {}, 0) }, null, soloSpesa), null)
  // Lo stesso se l'ultimo avviso è di prima della spesa (beni null) e il carburante era a zero.
  assert.equal(decidiAvviso({ ora: ora(13), voci: v(0, {}) }, null, { tipo: 'peggiora', ora: ora(10), voci: v(0, null) }), null)
  // Con notizie dai negozi l'acqua è confrontata e a zero: migliora.
  assert.equal(decidiAvviso({ ora: ora(13), voci: v(0, {}, 2) }, null, soloSpesa)?.tipo, 'migliora')
  // Se il carburante valeva almeno 1 nell'ultimo avviso è confrontato, con o senza la spesa (R4 e R18).
  assert.equal(decidiAvviso({ ora: ora(13), voci: v(1, { acqua: 2 }) }, null, { tipo: 'peggiora', ora: ora(10), voci: v(3, null) })?.tipo, 'migliora')
  assert.equal(decidiAvviso({ ora: ora(13), voci: v(0, {}, 0) }, null, { tipo: 'peggiora', ora: ora(10), voci: v(1, { acqua: 2 }, 3) })?.tipo, 'migliora')
})

test('avvisi: peggioramento senza notizie dai negozi: un bene che «sale» non conta, il carburante sì', () => {
  assert.equal(decidiAvviso({ ora: ora(16), voci: v(1, { acqua: 2 }, 0) }, { ora: ora(10), voci: v(1, {}) }, null), null)
  const p = decidiAvviso({ ora: ora(16), voci: v(2, {}, 0) }, { ora: ora(10), voci: v(1, { acqua: 3 }) }, null)
  assert.equal(p?.tipo, 'peggiora')
  assert.ok(messaggio({ adesso: p!.adesso, prima: p!.prima }).includes('\nSpesa: nessuna notizia dai negozi.\n'))
  // Con notizie dai negozi un bene che sale fa partire l'avviso, come prima.
  assert.equal(decidiAvviso({ ora: ora(16), voci: v(1, { acqua: 2 }, 3) }, { ora: ora(10), voci: v(1, {}) }, null)?.tipo, 'peggiora')
})

test('avvisi: la decisione porta con sé quanti negozi hanno notizie', () => {
  const a = decidiAvviso({ ora: ora(16), voci: v(3, {}, 0) }, { ora: ora(10), voci: v(1, {}, 4) }, null)
  assert.deepEqual(a, { tipo: 'peggiora', adesso: v(3, {}, 0), prima: v(1, {}, 4), ora_prima: ora(10) })
})

test('avvisi: gli avvisi di prima della spesa si leggono come prima', () => {
  const salvato = { id: 7, provincia: 'SA', tipo: 'peggiora' as const, ora: ora(11), adesso: v(11, null), prima: v(4, null), ora_prima: ora(9) }
  const vecchio = 'Provincia di Salerno: in peggioramento #Salerno\n11 comuni senza carburante confermati, alle 11:00 erano 4.\n' +
    'Situazione aggiornata: https://scorty.it/province/SA?da=rss'
  assert.equal(testoAvviso('SA', 'Salerno', salvato, 'https://scorty.it', 'rss'), vecchio)
  const xml = rssAvvisi('SA', 'Salerno', 'https://scorty.it', [salvato])
  assert.ok(xml.includes(`<description>${vecchio}</description>`))
  assert.ok(xml.includes('<title>Provincia di Salerno: in peggioramento</title>'))
  // Un avviso di prima della spesa non ha nemmeno il dato sui negozi: se ce l'avesse, le parole restano le stesse.
  assert.equal(testoAvviso('SA', 'Salerno', { ...salvato, adesso: v(11, null, 0) }, 'https://scorty.it', 'rss'), vecchio)
  // Anche un avviso di prima della spesa che torna a migliorare.
  assert.equal(
    testoAvviso('SA', 'Salerno', { tipo: 'migliora', adesso: v(1, null), prima: v(4, null), ora_prima: ora(9) }, 'https://scorty.it', 'rss'),
    'Provincia di Salerno: in miglioramento #Salerno\n1 comune senza carburante confermato, alle 11:00 erano 4.\nSituazione aggiornata: https://scorty.it/province/SA?da=rss',
  )
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
    { id: 2, provincia: 'SA', tipo: 'migliora', ora: ora(15), adesso: v(1, null), prima: v(4, null), ora_prima: ora(9) },
    { id: 1, provincia: 'SA', tipo: 'peggiora', ora: ora(9), adesso: v(4, null), prima: v(1, null), ora_prima: ora(3) },
  ])
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0">/)
  assert.match(xml, /<title>Scorty – avvisi carburante e spesa, provincia di Salerno<\/title>/)
  assert.match(xml, /<description>Quando nella provincia di Salerno aumentano i comuni senza carburante o senza un bene della spesa confermati, e quando tornano a calare\.<\/description>/)
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
    // Il messaggio è sempre quello nuovo. A Salerno non c'è nessun negozio: la spesa non dice «nessun comune senza beni»
    // (sembrerebbe che vada tutto bene) ma che non ci sono notizie dai negozi.
    assert.match(inviati[0].testo, /^Provincia di Salerno: in peggioramento #Salerno\nCarburante: 1 comune senza, confermato; alle \d\d:00 nessuno\.\nSpesa: nessuna notizia dai negozi\.\n/)
    const { rows } = await sql<{ tipo: string; inviato: boolean; spesa_con_notizie: number | null }>`
      select tipo, telegram_il is not null as inviato, spesa_con_notizie from avvisi`.execute(db)
    assert.deepEqual(rows, [{ tipo: 'peggiora', inviato: true, spesa_con_notizie: 0 }])
    // La fotografia dell'ora ricorda quanti negozi avevano notizie: zero, non «non lo so».
    const { rows: foto } = await sql`select spesa_con_notizie from andamento where provincia = 'SA' and ora = date_trunc('hour', now())`.execute(db)
    assert.deepEqual(foto, [{ spesa_con_notizie: 0 }])
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

  test('la fotografia con un comune senza acqua confermato fa partire un messaggio unico', async () => {
    // Si riparte da capo (il primo test ha già fotografato quest'ora). Il carburante resta com'era, un comune confermato
    // come sei ore prima; sale solo l'acqua: il messaggio è uno, con carburante e spesa insieme.
    await sql`delete from andamento`.execute(db)
    await sql`delete from avvisi`.execute(db)
    inviati.length = 0
    const { rows: [{ id: negozio }] } = await sql<{ id: number }>`
      insert into punti (nome, tipo, geom, prodotti, fonte, id_fonte, comune, provincia)
      values ('Spesa Salerno', 'negozio', ST_MakePoint(${SALERNO.lon}, ${SALERNO.lat})::geography, '{acqua,pane}', 'test-spesa', 'spesa-salerno', 'Salerno', 'SA')
      returning id`.execute(db)
    try {
      for (let i = 0; i < 2; i++) {
        const { rows: [{ id: telefono }] } = await sql<{ id: string }>`insert into dispositivi default values returning id`.execute(db)
        await sql`insert into segnalazioni (punto_id, prodotto, stato, dispositivo_id) values (${negozio}, 'acqua', 'esaurito', ${telefono})`.execute(db)
      }
      await sql`
        insert into andamento (provincia, ora, comuni_senza, comuni_senza_confermati, con_notizie, verde, giallo, rosso,
          spesa_comuni_senza, spesa_comuni_senza_confermati, spesa_beni)
        values ('SA', date_trunc('hour', now()) - interval '6 hours', 1, 1, 1, 0, 0, 1, 0, 0, '{}')
      `.execute(db)
      await app.fotografaProvince()
      assert.equal(inviati.length, 1)
      assert.equal(inviati[0].canale, '@scorty_campania')
      assert.match(inviati[0].testo, /^Provincia di Salerno: in peggioramento #Salerno\nCarburante: 1 comune senza, confermato; alle \d\d:00 era 1\.\n/)
      assert.ok(inviati[0].testo.includes('\nSpesa (comuni confermati): acqua in 1 comune (prima nessuno).\n'), inviati[0].testo)
      const { rows } = await sql`
        select tipo, adesso, prima, beni, beni_prima, spesa_con_notizie, telegram_il is not null as inviato from avvisi
      `.execute(db)
      assert.deepEqual(rows, [{ tipo: 'peggiora', adesso: 1, prima: 1, beni: { acqua: 1 }, beni_prima: {}, spesa_con_notizie: 1, inviato: true }])
      await app.fotografaProvince() // la fotografia di quest'ora c'è già: niente di nuovo
      assert.equal(inviati.length, 1)

      // Il feed dice la stessa cosa.
      const feed = (await app.inject({ url: '/api/province/SA/avvisi.rss' })).body
      assert.match(feed, /<description>Provincia di Salerno: in peggioramento #Salerno\nCarburante: 1 comune senza, confermato; alle \d\d:00 era 1\.\nSpesa \(comuni confermati\): acqua in 1 comune \(prima nessuno\)\./)
    } finally {
      await sql`delete from andamento`.execute(db)
      await sql`delete from avvisi`.execute(db)
      await sql`delete from segnalazioni where punto_id = ${negozio}`.execute(db)
      await sql`delete from punti where id = ${negozio}`.execute(db)
    }
  })

  test('dopo un peggioramento con i beni, quando l’acqua torna parte un solo «migliora», con i beni salvati e lo stesso testo nel feed', async () => {
    // Tutto preparato qui, a Napoli, senza dipendere dai test prima: un distributore senza notizie, un negozio dove per due
    // telefoni l'acqua c'è, e un peggioramento di tre ore fa salvato con l'acqua senza in un comune (beni {acqua: 1}).
    await sql`delete from andamento`.execute(db)
    await sql`delete from avvisi`.execute(db)
    inviati.length = 0
    const NAPOLI = { lat: 40.85, lon: 14.27 }
    const { rows: [{ id: distributore }] } = await sql<{ id: number }>`
      insert into punti (nome, tipo, geom, prodotti, fonte, id_fonte, comune, provincia)
      values ('Distributore Napoli', 'distributore', ST_MakePoint(${NAPOLI.lon}, ${NAPOLI.lat})::geography, '{gasolio}', 'test-migliora', 'distributore-napoli', 'Napoli', 'NA')
      returning id`.execute(db)
    const { rows: [{ id: negozio }] } = await sql<{ id: number }>`
      insert into punti (nome, tipo, geom, prodotti, fonte, id_fonte, comune, provincia)
      values ('Spesa Napoli', 'negozio', ST_MakePoint(${NAPOLI.lon}, ${NAPOLI.lat})::geography, '{acqua,pane}', 'test-migliora', 'spesa-napoli', 'Napoli', 'NA')
      returning id`.execute(db)
    try {
      for (let i = 0; i < 2; i++) {
        const { rows: [{ id: telefono }] } = await sql<{ id: string }>`insert into dispositivi default values returning id`.execute(db)
        await sql`insert into segnalazioni (punto_id, prodotto, stato, dispositivo_id) values (${negozio}, 'acqua', 'disponibile', ${telefono})`.execute(db)
      }
      await sql`
        insert into avvisi (provincia, ora, tipo, adesso, prima, ora_prima, beni, beni_prima, spesa_con_notizie)
        values ('NA', date_trunc('hour', now()) - interval '3 hours', 'peggiora', 0, 0, date_trunc('hour', now()) - interval '9 hours', '{"acqua": 1}', '{}', 1)
      `.execute(db)

      await app.fotografaProvince()
      const napoli = () => inviati.filter((m) => m.testo.startsWith('Provincia di Napoli'))
      assert.equal(napoli().length, 1)
      assert.equal(napoli()[0].canale, '@scorty_campania')
      const testo = /^Provincia di Napoli: in miglioramento #Napoli\nCarburante: nessun comune senza; alle \d\d:00 nessuno\.\nSpesa \(comuni confermati\): acqua in nessun comune \(prima 1\)\.\n/
      assert.match(napoli()[0].testo, testo)
      const { rows } = await sql`
        select tipo, adesso, prima, beni, beni_prima, spesa_con_notizie, telegram_il is not null as inviato from avvisi where provincia = 'NA' order by ora
      `.execute(db)
      assert.deepEqual(rows, [
        { tipo: 'peggiora', adesso: 0, prima: 0, beni: { acqua: 1 }, beni_prima: {}, spesa_con_notizie: 1, inviato: false },
        { tipo: 'migliora', adesso: 0, prima: 0, beni: {}, beni_prima: { acqua: 1 }, spesa_con_notizie: 1, inviato: true },
      ])
      await app.fotografaProvince() // la fotografia di quest'ora c'è già: niente di nuovo
      assert.equal(napoli().length, 1)

      // Il feed dice la stessa cosa del messaggio, con le stesse parole.
      const feed = (await app.inject({ url: '/api/province/NA/avvisi.rss' })).body
      assert.match(feed, /<description>Provincia di Napoli: in miglioramento #Napoli\nCarburante: nessun comune senza; alle \d\d:00 nessuno\.\nSpesa \(comuni confermati\): acqua in nessun comune \(prima 1\)\.\n/)
      assert.equal(feed.split('in miglioramento #Napoli').length - 1, 1) // un solo «migliora»
    } finally {
      await sql`delete from andamento`.execute(db)
      await sql`delete from avvisi`.execute(db)
      await sql`delete from segnalazioni where punto_id = ${negozio}`.execute(db)
      await sql`delete from punti where id in (${distributore}, ${negozio})`.execute(db)
    }
  })

  test('il feed legge gli avvisi di prima della spesa come prima, e quelli con la spesa nel formato nuovo', async () => {
    await sql`delete from avvisi`.execute(db)
    try {
      // Il primo è salvato come prima della migrazione 013: senza beni. Il secondo ha la spesa ma è di prima del dato sui negozi
      // (014: spesa_con_notizie null); il terzo e il quarto lo hanno, con e senza notizie dai negozi.
      await sql`
        insert into avvisi (provincia, ora, tipo, adesso, prima, ora_prima, beni, beni_prima, spesa_con_notizie) values
          ('SA', now() - interval '3 days', 'peggiora', 3, 1, date_trunc('hour', now()) - interval '3 days 6 hours', null, null, null),
          ('SA', now() - interval '2 days', 'peggiora', 2, 1, date_trunc('hour', now()) - interval '2 days 6 hours', '{}', '{}', null),
          ('SA', now() - interval '1 day', 'migliora', 0, 3, date_trunc('hour', now()) - interval '2 days', '{}', '{"acqua": 2}', 4),
          ('SA', now() - interval '12 hours', 'peggiora', 2, 0, date_trunc('hour', now()) - interval '1 day', '{}', '{}', 0)
      `.execute(db)
      const feed = (await app.inject({ url: '/api/province/SA/avvisi.rss' })).body
      assert.match(feed, /<description>Provincia di Salerno: in peggioramento #Salerno\n3 comuni senza carburante confermati, alle \d\d:00 era 1\.\nSituazione aggiornata: https:\/\/scorty.it\/province\/SA\?da=rss<\/description>/)
      assert.match(feed, /<description>Provincia di Salerno: in miglioramento #Salerno\nCarburante: nessun comune senza; alle \d\d:00 erano 3\.\nSpesa \(comuni confermati\): acqua in nessun comune \(prima 2\)\./)
      // Con la spesa ma senza il dato sui negozi resta la frase di prima; con zero negozi con notizie lo dice.
      assert.match(feed, /<description>Provincia di Salerno: in peggioramento #Salerno\nCarburante: 2 comuni senza, confermati; alle \d\d:00 era 1\.\nSpesa: nessun comune senza beni\.\n/)
      assert.match(feed, /<description>Provincia di Salerno: in peggioramento #Salerno\nCarburante: 2 comuni senza, confermati; alle \d\d:00 nessuno\.\nSpesa: nessuna notizia dai negozi\.\n/)
    } finally {
      await sql`delete from avvisi`.execute(db)
    }
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
