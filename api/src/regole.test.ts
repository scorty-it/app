// Regole anti-abuso contro un PostgreSQL vero. Cancella tutto: parte solo su un database che finisce con "_test".
// Uso: PGDATABASE=scorty_test PGHOST=127.0.0.1 PGUSER=… PGPASSWORD=… npm test
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { after, before, describe, test } from 'node:test'
import { sql } from 'kysely'
import { AZIONI_ORA, A_DISTANZA_ORA, coloreDi, comeCsv, costruisciApp } from './app.ts'
import { db, pool } from './db.ts'
import { salvaImpianti } from './distributori.ts'
import { BIT, firmaToken, zeriIniziali } from './firme.ts'
import { MAX_FONTI_AL_GIORNO } from './fonti.ts'
import { migra } from './migra.ts'
import { pulisci } from './pulizia.ts'

const attivo = process.env.PGDATABASE?.endsWith('_test') ?? false
const ADMIN = 'a'.repeat(16)
const app = costruisciApp({ segreto: 's'.repeat(32), passwordAdmin: ADMIN })
app.log.level = 'silent'

// Due distributori: uno a Napoli, uno a Bari (circa 260 km).
const NAPOLI = { lat: 40.85, lon: 14.27 }
const BARI = { lat: 41.12, lon: 16.87 }
const vicino = (p: { lat: number; lon: number }, metri: number) => ({ lat: p.lat + metri / 111_320, lon: p.lon })
let napoli = 0
let bari = 0

async function nuovoDispositivo() {
  const s = (await app.inject({ url: '/api/sfida' })).json()
  let nonce = 0
  while (zeriIniziali(createHash('sha256').update(s.sfida + nonce).digest()) < BIT) nonce++
  const r = await app.inject({ method: 'POST', url: '/api/dispositivo', payload: { sfida: s.sfida, firma: s.firma, nonce } })
  return r.json().token as string
}

const invia = (token: string, url: string, payload: object) =>
  app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${token}` } })
const segnala = (token: string, punto_id: number, pos: object, altro: object = {}) =>
  invia(token, '/api/segnalazioni', { punto_id, prodotto: 'gasolio', stato: 'disponibile', ...pos, ...altro })

describe('regole anti-abuso', { skip: !attivo && 'serve PGDATABASE che finisca con _test' }, () => {
  before(async () => {
    await migra(pool)
    await sql`truncate punti, dispositivi, segnalazioni, voti, code, viste, anomalie, correzioni, ci_vado restart identity cascade`.execute(db)
    const punto = (nome: string, p: { lat: number; lon: number }) => sql<{ id: number }>`
      insert into punti (nome, geom, prodotti, fonte, id_fonte)
      values (${nome}, ST_MakePoint(${p.lon}, ${p.lat})::geography, '{benzina,gasolio}', 'test', ${nome}) returning id`.execute(db)
    napoli = (await punto('Napoli', NAPOLI)).rows[0].id
    bari = (await punto('Bari', BARI)).rows[0].id
  })
  after(async () => {
    await app.close()
    await db.destroy()
  })

  test('un negozio ha solo beni, un distributore solo carburanti', async () => {
    const nuovo = (tipo: string, prodotti: string, id: string) => sql`
      insert into punti (nome, tipo, geom, prodotti, fonte, id_fonte)
      values (${id}, ${tipo}, ST_MakePoint(14.27, 40.85)::geography, ${prodotti}::text[], 'test-schema', ${id})`.execute(db)
    try {
      await nuovo('negozio', '{acqua,latte}', 'negozio-ok')
      await assert.rejects(nuovo('negozio', '{benzina}', 'negozio-carburante'))
      await assert.rejects(nuovo('distributore', '{latte}', 'distributore-bene'))
    } finally {
      await sql`delete from punti where fonte = 'test-schema'`.execute(db)
    }
  })

  test('salvare i negozi non spegne i distributori', async () => {
    const negozio = { id_fonte: 'node/1', nome: 'Conad', marchio: null, indirizzo: null, comune: null, provincia: null, lat: 40.85, lon: 14.27, prodotti: ['acqua' as const, 'pane' as const] }
    try {
      await salvaImpianti([negozio], 'osm-negozi', 'negozio')
      const { rows } = await sql<{ nome: string; tipo: string; attivo: boolean }>`
        select nome, tipo, attivo from punti where id in (${napoli}, ${bari}) or fonte = 'osm-negozi' order by id`.execute(db)
      assert.deepEqual(rows.map((r) => [r.nome, r.tipo, r.attivo]), [['Napoli', 'distributore', true], ['Bari', 'distributore', true], ['Conad', 'negozio', true]])
    } finally {
      await sql`delete from punti where fonte = 'osm-negozi'`.execute(db)
    }
  })

  test('il dispositivo si ottiene solo risolvendo la sfida, e una sfida vale una volta', async () => {
    const s = (await app.inject({ url: '/api/sfida' })).json()
    const sbagliato = [...Array(50).keys()].find((n) => zeriIniziali(createHash('sha256').update(s.sfida + n).digest()) < BIT)
    assert.equal((await app.inject({ method: 'POST', url: '/api/dispositivo', payload: { ...s, bit: undefined, nonce: sbagliato } })).statusCode, 400)
    let nonce = 0
    while (zeriIniziali(createHash('sha256').update(s.sfida + nonce).digest()) < BIT) nonce++
    const corpo = { sfida: s.sfida, firma: s.firma, nonce }
    assert.equal((await app.inject({ method: 'POST', url: '/api/dispositivo', payload: corpo })).statusCode, 200)
    assert.equal((await app.inject({ method: 'POST', url: '/api/dispositivo', payload: corpo })).statusCode, 400)
  })

  test('senza un token valido non si segnala', async () => {
    assert.equal((await segnala('falso', napoli, vicino(NAPOLI, 50))).statusCode, 401)
  })

  test('entro 300 m si segnala sul posto, entro 30 km a distanza, oltre no', async () => {
    const t = await nuovoDispositivo()
    const qui = await segnala(t, napoli, vicino(NAPOLI, 100))
    assert.equal(qui.statusCode, 200)
    const g = qui.json().stato.prodotti[0]
    assert.equal(g.affidabilita, 'da_confermare')
    assert.equal(g.a_distanza, false)

    const t2 = await nuovoDispositivo()
    const lontano = await segnala(t2, bari, vicino(BARI, 5000), { minuti_fa: 40 })
    assert.equal(lontano.statusCode, 200)
    assert.equal(lontano.json().stato.prodotti[0].a_distanza, true)

    assert.equal((await segnala(t2, napoli, vicino(NAPOLI, 100_000))).statusCode, 403)
    const fuori = await db.selectFrom('anomalie').selectAll().where('tipo', '=', 'fuori_raggio').execute()
    assert.equal(fuori.length, 1)
  })

  test('niente autoconferma; la conferma di un altro rende affidabile; le smentite rendono incerto', async () => {
    const [a, b, c, d] = await Promise.all([nuovoDispositivo(), nuovoDispositivo(), nuovoDispositivo(), nuovoDispositivo()])
    await sql`truncate segnalazioni, voti, code restart identity cascade`.execute(db)
    const { segnalazione_id } = (await segnala(a, napoli, vicino(NAPOLI, 10))).json()
    const vota = (t: string, conferma: boolean) => invia(t, '/api/voti', { segnalazione_id, conferma, ...vicino(NAPOLI, 20) })

    assert.equal((await vota(a, true)).statusCode, 403)
    assert.equal((await vota(b, true)).json().stato.prodotti[0].affidabilita, 'affidabile')
    // Le conferme si danno solo sul posto
    assert.equal((await invia(c, '/api/voti', { segnalazione_id, conferma: true, ...vicino(NAPOLI, 2000) })).statusCode, 403)

    await segnala(c, napoli, vicino(NAPOLI, 10), { stato: 'esaurito' })
    const s = (await vota(d, false)).json().stato.prodotti[0]
    assert.equal(s.stato, 'disponibile')
    assert.equal(s.affidabilita, 'incerto')
  })

  test('al massimo 10 azioni all’ora per telefono e 3 a distanza', async () => {
    const t = await nuovoDispositivo()
    for (let i = 0; i < AZIONI_ORA; i++) {
      assert.equal((await invia(t, '/api/code', { punto_id: napoli, livello: 'breve', ...vicino(NAPOLI, 10) })).statusCode, 200)
    }
    assert.equal((await invia(t, '/api/code', { punto_id: napoli, livello: 'breve', ...vicino(NAPOLI, 10) })).statusCode, 429)

    const r = await nuovoDispositivo()
    for (let i = 0; i < A_DISTANZA_ORA; i++) assert.equal((await segnala(r, napoli, vicino(NAPOLI, 3000))).statusCode, 200)
    assert.equal((await segnala(r, napoli, vicino(NAPOLI, 3000))).statusCode, 429)
  })

  describe('la visita al negozio', () => {
    const BENI = ['acqua', 'latte', 'pane', 'frutta_verdura', 'pasta_riso', 'carne_pesce', 'neonati']
    const risposte = (n = 7) => BENI.slice(0, n).map((prodotto) => ({ prodotto, stato: 'disponibile' }))
    const visita = (token: string, punto_id: number, pos: object, altro: object = {}) => invia(token, '/api/visite', { punto_id, ...pos, ...altro })
    let negozio = 0
    before(async () => {
      await sql`truncate segnalazioni, voti, code, viste, anomalie, ci_vado restart identity cascade`.execute(db)
      negozio = (await sql<{ id: number }>`
        insert into punti (nome, tipo, geom, prodotti, fonte, id_fonte)
        values ('Spesa', 'negozio', ST_MakePoint(${NAPOLI.lon}, ${vicino(NAPOLI, 100).lat})::geography, ${'{' + BENI.join(',') + '}'}::text[], 'test-visite', 'spesa')
        returning id`.execute(db)).rows[0].id
    })
    after(async () => {
      await sql`truncate segnalazioni, voti, code, viste, anomalie, ci_vado restart identity cascade`.execute(db)
      await sql`delete from punti where fonte = 'test-visite'`.execute(db)
    })
    const qui = () => vicino(NAPOLI, 100)

    test('una visita al negozio vale un\'azione', async () => {
      const t = await nuovoDispositivo()
      const prima = await visita(t, negozio, qui(), { risposte: risposte(6), coda: 'breve' })
      assert.equal(prima.statusCode, 200)
      assert.equal(prima.json().segnalazioni.length, 6)
      assert.equal(prima.json().stato.tipo, 'negozio')
      const { rows: righe } = await sql<{ visita: string }>`select distinct visita from segnalazioni union select visita from code`.execute(db)
      assert.equal(righe.length, 1) // tutte le righe hanno la stessa visita
      assert.ok(righe[0].visita)

      // Il «Ci vado» aperto su questo negozio si chiude con la visita; quello di un altro telefono no.
      const { rows: [{ dispositivo_id: telefono }] } = await sql<{ dispositivo_id: string }>`select dispositivo_id from segnalazioni limit 1`.execute(db)
      const { rows: [{ id: altro }] } = await sql<{ id: string }>`insert into dispositivi default values returning id`.execute(db)
      await sql`insert into ci_vado (dispositivo_id, punto_id, prodotti) values (${telefono}, ${negozio}, '{latte}'), (${altro}, ${negozio}, '{latte}')`.execute(db)

      // Completare la visita con un'altra categoria non consuma un'azione.
      const { segnalazioni: [primo] } = prima.json()
      assert.equal((await invia(t, `/api/segnalazioni/${primo}/aggiungi`, { prodotto: 'neonati', stato: 'scarso' })).statusCode, 200)
      assert.equal((await invia(t, `/api/segnalazioni/${primo}/aggiungi`, { prodotto: 'gasolio', stato: 'scarso' })).statusCode, 400)

      // Correggere uno stato e aggiungere la coda alla visita corretta non costano azioni.
      const corretta = await invia(t, `/api/segnalazioni/${primo}/correggi`, { stato: 'esaurito' })
      assert.equal(corretta.statusCode, 200)
      assert.equal((await invia(t, `/api/segnalazioni/${corretta.json().segnalazione_id}/coda`, { livello: 'lunga' })).statusCode, 200)

      for (let i = 1; i < AZIONI_ORA; i++) assert.equal((await visita(t, negozio, qui(), { risposte: risposte(), coda: 'lunga' })).statusCode, 200)
      assert.equal((await visita(t, negozio, qui(), { risposte: risposte(), coda: 'lunga' })).statusCode, 429)

      const aperti = await sql<{ dispositivo_id: string; chiuso_il: Date | null }>`select dispositivo_id, chiuso_il from ci_vado`.execute(db)
      assert.deepEqual(aperti.rows.map((r) => [r.dispositivo_id === telefono, r.chiuso_il !== null]).sort(), [[false, false], [true, true]])
    })

    test('a distanza la visita conta una volta e senza coda', async () => {
      const t = await nuovoDispositivo()
      const lontano = vicino(NAPOLI, 3000)
      assert.equal((await visita(t, negozio, lontano, { risposte: risposte(2), coda: 'breve' })).statusCode, 403)
      for (let i = 0; i < A_DISTANZA_ORA; i++) {
        const r = await visita(t, negozio, lontano, { risposte: risposte(), minuti_fa: 20 })
        assert.equal(r.statusCode, 200)
      }
      assert.equal((await visita(t, negozio, lontano, { risposte: risposte() })).statusCode, 429)
      const { rows: [{ n }] } = await sql<{ n: number }>`select count(*)::int as n from segnalazioni where a_distanza and dispositivo_id = (select dispositivo_id from segnalazioni order by id desc limit 1)`.execute(db)
      assert.equal(n, 7 * A_DISTANZA_ORA)
    })

    test('la visita è solo per i negozi, e va fatta bene', async () => {
      const t = await nuovoDispositivo()
      assert.equal((await visita(t, napoli, vicino(NAPOLI, 10), { risposte: [{ prodotto: 'acqua', stato: 'disponibile' }] })).statusCode, 400)
      const carburante = await segnala(t, negozio, qui()) // gasolio in un negozio
      assert.equal(carburante.statusCode, 400)
      assert.match(carburante.json().message, /si usa la visita/)
      assert.equal((await visita(t, negozio, qui(), { risposte: [...risposte(1), ...risposte(1)] })).statusCode, 400) // categoria ripetuta
      assert.equal((await visita(t, negozio, qui(), { risposte: [] })).statusCode, 400) // niente
      assert.equal((await visita(t, negozio, qui())).statusCode, 400)
      assert.equal((await visita(t, negozio, qui(), { risposte: [{ prodotto: 'gasolio', stato: 'disponibile' }] })).statusCode, 400) // non è un bene
      assert.equal((await visita(t, negozio, qui(), { risposte: [...risposte(), ...risposte(1)] })).statusCode, 400) // più di 7
      assert.equal((await visita(t, negozio, qui(), { coda: 'nessuna' })).statusCode, 200) // la sola coda basta
    })
  })

  describe('«Ci vado»', () => {
    const BENI = ['acqua', 'latte', 'pane', 'frutta_verdura', 'pasta_riso', 'carne_pesce', 'neonati']
    const SEDE = vicino(NAPOLI, 2000) // dove stanno i punti di questo gruppo: da qui si è sul posto
    let negozio = 0
    let altroNegozio = 0
    let pompa = 0
    const nuovoPunto = async (nome: string, tipo: string, prodotti: string[]) => (await sql<{ id: number }>`
      insert into punti (nome, tipo, geom, prodotti, fonte, id_fonte)
      values (${nome}, ${tipo}, ST_MakePoint(${SEDE.lon}, ${SEDE.lat})::geography, ${'{' + prodotti.join(',') + '}'}::text[], 'test-civado', ${nome})
      returning id`.execute(db)).rows[0].id
    const pulisciGruppo = () => sql`truncate segnalazioni, voti, code, viste, anomalie, ci_vado restart identity cascade`.execute(db)
    before(async () => {
      await pulisciGruppo()
      negozio = await nuovoPunto('Civado 1', 'negozio', BENI)
      altroNegozio = await nuovoPunto('Civado 2', 'negozio', BENI)
      pompa = await nuovoPunto('Civado pompa', 'distributore', ['benzina', 'gasolio'])
    })
    after(async () => {
      await pulisciGruppo()
      await sql`delete from punti where fonte = 'test-civado'`.execute(db)
    })
    const civado = (token: string, punto_id: number, prodotti: string[], pos: object = SEDE) => invia(token, '/api/ci-vado', { punto_id, prodotti, ...pos })
    type Letto = { arrivi: number; arrivi_per: Record<string, number>; stima: { potrebbe_finire: string[] }; prodotti: { prodotto: string; stato: string; affidabilita: string }[] }
    const statoDi = async (id: number) => ((await app.inject({ url: `/api/vicini?lat=${SEDE.lat}&lon=${SEDE.lon}&n=50&tipo=negozio` })).json() as { punto: { id: number }; stato: Letto | null }[])
      .find((x) => x.punto.id === id)?.stato
    // I telefoni si creano direttamente: via API sono 30 all'ora per rete, e il resto della suite ne usa già parecchi.
    const telefonoInDb = async () => (await sql<{ id: string }>`insert into dispositivi default values returning id`.execute(db)).rows[0].id
    const telefono = async () => firmaToken('s'.repeat(32), await telefonoInDb())
    const aperti = () => sql<{ n: number }>`select count(*)::int as n from ci_vado where chiuso_il is null`.execute(db).then((r) => r.rows[0].n)

    test('un negozio vuole da 1 a 7 beni distinti, un distributore nessuno', async () => {
      const t = await telefono()
      assert.equal((await civado(t, negozio, [])).statusCode, 400)
      assert.equal((await civado(t, negozio, ['latte', 'latte'])).statusCode, 400)
      assert.equal((await civado(t, pompa, ['gasolio'])).statusCode, 400)
      const r = await civado(t, pompa, [])
      assert.equal(r.statusCode, 200)
      assert.equal(r.json().stato.arrivi, 1)
      assert.equal((await civado(t, negozio, BENI)).statusCode, 200)
    })

    test('il «Ci vado» si fa entro 30 km, non oltre', async () => {
      await pulisciGruppo()
      const t = await telefono()
      assert.equal((await civado(t, negozio, ['latte'], vicino(SEDE, 31_000))).statusCode, 403)
      const { rows: [{ n }] } = await sql<{ n: number }>`select count(*)::int as n from anomalie`.execute(db)
      assert.equal(n, 0) // da lontano non è sospetto e non lascia tracce
      assert.equal((await civado(t, negozio, ['latte'], vicino(SEDE, 5_000))).statusCode, 200)
    })

    test('uno per telefono: un nuovo «Ci vado» chiude il precedente; annulla chiude e restituisce lo stato', async () => {
      await pulisciGruppo()
      const t = await telefono()
      assert.equal((await civado(t, negozio, ['latte', 'pane'])).json().stato.arrivi, 1)
      const secondo = await civado(t, altroNegozio, ['acqua'])
      assert.equal(secondo.statusCode, 200)
      assert.deepEqual([secondo.json().stato.arrivi, secondo.json().stato.arrivi_per], [1, { acqua: 1 }])
      assert.equal((await statoDi(negozio))?.arrivi ?? 0, 0)
      const mie = (await app.inject({ url: '/api/mie', headers: { authorization: `Bearer ${t}` } })).json()
      assert.deepEqual([mie.ci_vado.punto.id, mie.ci_vado.prodotti], [altroNegozio, ['acqua']])
      assert.ok(mie.ci_vado.creato_il)

      const annulla = await invia(t, '/api/ci-vado/annulla', {})
      assert.equal(annulla.statusCode, 200)
      assert.equal(annulla.json().stato.arrivi, 0)
      assert.equal((await app.inject({ url: '/api/mie', headers: { authorization: `Bearer ${t}` } })).json().ci_vado, null)
      assert.equal((await invia(t, '/api/ci-vado/annulla', {})).json().stato, null) // niente da annullare
    })

    test('al massimo 3 «Ci vado» all\'ora: il quarto dà 429 e finisce tra le anomalie', async () => {
      await pulisciGruppo()
      const t = await telefono()
      for (const p of [negozio, altroNegozio, negozio]) assert.equal((await civado(t, p, ['latte'])).statusCode, 200)
      assert.equal((await civado(t, altroNegozio, ['latte'])).statusCode, 429)
      const { rows } = await sql<{ dettagli: { ci_vado?: boolean } }>`select dettagli from anomalie where tipo = 'limite_superato'`.execute(db)
      assert.deepEqual(rows.map((r) => r.dettagli.ci_vado), [true])
      assert.deepEqual(rows.map((r) => Object.keys(r.dettagli)), [['ci_vado']]) // nessun punto_id: l'intenzione non resta 30 giorni
    })

    test('il 409 chiama i beni col nome italiano', async () => {
      await pulisciGruppo()
      const finito = { risposte: [{ prodotto: 'frutta_verdura', stato: 'esaurito' }], ...SEDE }
      for (let i = 0; i < 2; i++) assert.equal((await invia(await telefono(), '/api/visite', { punto_id: negozio, ...finito })).statusCode, 200)
      const r = await civado(await telefono(), negozio, ['frutta_verdura'])
      assert.equal(r.statusCode, 409)
      assert.match(r.json().message, /frutta e verdura/)
    })

    test('chi apre la scheda e dice «Ci vado» conta una volta sola, col peso del «Ci vado»', async () => {
      await pulisciGruppo()
      const [chiVa, chiGuarda] = [await telefonoInDb(), await telefonoInDb()]
      await sql`insert into viste (punto_id, dispositivo_id) values (${negozio}, ${chiVa}), (${negozio}, ${chiGuarda})`.execute(db)
      await sql`insert into ci_vado (dispositivo_id, punto_id, prodotti) values (${chiVa}, ${negozio}, '{latte}')`.execute(db)
      const s = (await statoDi(negozio)) as unknown as { interesse: number; arrivi: number }
      assert.deepEqual([s.arrivi, s.interesse], [1, 1]) // solo chi guarda è interesse
    })

    test('il «Ci vado» sta fuori dal budget delle segnalazioni, e viceversa', async () => {
      await pulisciGruppo()
      const t = await telefono()
      for (let i = 0; i < AZIONI_ORA; i++) assert.equal((await invia(t, '/api/code', { punto_id: pompa, livello: 'breve', ...SEDE })).statusCode, 200)
      assert.equal((await invia(t, '/api/code', { punto_id: pompa, livello: 'breve', ...SEDE })).statusCode, 429)
      assert.equal((await civado(t, negozio, ['latte'])).statusCode, 200)
      const u = await telefono()
      for (const p of [negozio, altroNegozio, negozio]) assert.equal((await civado(u, p, ['latte'])).statusCode, 200)
      assert.equal((await invia(u, '/api/code', { punto_id: pompa, livello: 'breve', ...SEDE })).statusCode, 200)
    })

    test('un bene su un distributore è rifiutato dalla regola del server, non dallo schema', async () => {
      const r = await civado(await telefono(), pompa, ['latte'])
      assert.equal(r.statusCode, 400)
      assert.match(r.json().message, /distributore/)
    })

    test('bloccare un telefono ricalcola e manda il punto del suo «Ci vado»', async () => {
      await pulisciGruppo()
      const t = await telefono()
      assert.equal((await civado(t, negozio, ['latte'])).statusCode, 200)
      const { rows: [{ dispositivo_id }] } = await sql<{ dispositivo_id: string }>`select dispositivo_id from ci_vado`.execute(db)
      await app.listen({ port: 0, host: '127.0.0.1' })
      const { port } = app.server.address() as { port: number }
      const ricevuti: string[] = []
      const richiesta = http.get({ port, host: '127.0.0.1', path: '/api/eventi' }, (res) => res.on('data', (c) => ricevuti.push(String(c))))
      try {
        await new Promise((r) => setTimeout(r, 200)) // il tempo di registrarsi
        const r = await app.inject({ method: 'POST', url: `/api/admin/dispositivi/${dispositivo_id}`, payload: { bloccato: true }, headers: { authorization: `Bearer ${ADMIN}` } })
        assert.equal(r.statusCode, 200)
        await new Promise((r) => setTimeout(r, 200)) // il tempo di arrivare
        const arrivato = ricevuti.join('').split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)) as { punto_id: number; arrivi: number })
        assert.deepEqual(arrivato.filter((s) => s.punto_id === negozio).map((s) => s.arrivi), [0])
      } finally {
        richiesta.destroy()
      }
    })

    test('confermare o smentire una segnalazione in un punto chiude il «Ci vado» lì', async () => {
      await pulisciGruppo()
      const [autore, votante] = [await telefono(), await telefono()]
      const { segnalazione_id } = (await invia(autore, '/api/segnalazioni', { punto_id: pompa, prodotto: 'gasolio', stato: 'disponibile', ...SEDE })).json()
      assert.equal((await civado(votante, pompa, [])).statusCode, 200)
      assert.equal(await aperti(), 1)
      assert.equal((await invia(votante, '/api/voti', { segnalazione_id, conferma: true, ...SEDE })).statusCode, 200)
      assert.equal(await aperti(), 0)
    })

    test('non si va a prendere un bene che là è finito, a meno che la notizia sia contesa', async () => {
      await pulisciGruppo()
      const [a, b] = [await telefono(), await telefono()]
      const finito = { risposte: [{ prodotto: 'latte', stato: 'esaurito' }], ...SEDE }
      assert.equal((await invia(a, '/api/visite', { punto_id: negozio, ...finito })).statusCode, 200)
      assert.equal((await invia(b, '/api/visite', { punto_id: negozio, ...finito })).statusCode, 200)
      const t = await telefono()
      const r = await civado(t, negozio, ['latte', 'pane'])
      assert.equal(r.statusCode, 409)
      assert.match(r.json().message, /latte/)
      assert.equal(await aperti(), 0)
      assert.equal((await civado(t, negozio, ['pane'])).statusCode, 200)

      // Un telefono dice finito, un altro (prima) disponibile: vince il finito ma è incerto, e andarci si può.
      const [c, d] = [await telefonoInDb(), await telefonoInDb()]
      await sql`insert into segnalazioni (punto_id, prodotto, stato, dispositivo_id, visto_il) values
        (${altroNegozio}, 'latte', 'esaurito', ${c}, now()), (${altroNegozio}, 'latte', 'disponibile', ${d}, now() - interval '1 hour')`.execute(db)
      const [latte] = (await statoDi(altroNegozio))!.prodotti
      assert.deepEqual([latte.stato, latte.affidabilita], ['esaurito', 'incerto'])
      assert.equal((await civado(await telefono(), altroNegozio, ['latte'])).statusCode, 200)
    })

    test('un telefono bloccato non conta negli arrivi; dopo 61 minuti non conta più nessuno, e il telefono può rifare', async () => {
      await pulisciGruppo()
      const [t, bloccato] = [await telefono(), await telefono()]
      assert.equal((await civado(t, negozio, ['latte'])).statusCode, 200)
      assert.equal((await civado(bloccato, negozio, ['latte'])).json().stato.arrivi, 2)
      await sql`update dispositivi set bloccato = true where id = (select dispositivo_id from ci_vado order by id desc limit 1)`.execute(db)
      assert.equal((await statoDi(negozio))?.arrivi, 1)

      await sql`update ci_vado set creato_il = now() - interval '61 minutes'`.execute(db)
      assert.equal((await statoDi(negozio))?.arrivi ?? 0, 0)
      const diNuovo = await civado(t, negozio, ['latte']) // quello scaduto è ancora aperto: si chiude da sé
      assert.equal(diNuovo.statusCode, 200)
      assert.equal(diNuovo.json().stato.arrivi, 1)
    })

    test('una segnalazione o una coda al distributore chiude il «Ci vado» lì', async () => {
      await pulisciGruppo()
      const [a, b] = [await telefono(), await telefono()]
      for (const t of [a, b]) assert.equal((await civado(t, pompa, [])).statusCode, 200)
      assert.equal(await aperti(), 2)
      assert.equal((await invia(a, '/api/segnalazioni', { punto_id: pompa, prodotto: 'gasolio', stato: 'disponibile', ...SEDE })).statusCode, 200)
      assert.equal(await aperti(), 1)
      assert.equal((await invia(b, '/api/code', { punto_id: pompa, livello: 'breve', ...SEDE })).statusCode, 200)
      assert.equal(await aperti(), 0)
    })

    test('con 10 «Ci vado» sul latte il negozio «potrebbe finire» il latte', async () => {
      await pulisciGruppo()
      for (let i = 0; i < 10; i++) {
        await sql`insert into ci_vado (dispositivo_id, punto_id, prodotti) values (${await telefonoInDb()}, ${negozio}, '{latte}')`.execute(db)
      }
      const s = await statoDi(negozio)
      assert.equal(s?.arrivi, 10)
      assert.deepEqual(s?.arrivi_per, { latte: 10 })
      assert.deepEqual(s?.stima.potrebbe_finire, ['latte'])
    })

    test('lo schema: nessun carburante nei «Ci vado» e uno solo aperto per telefono', async () => {
      await pulisciGruppo()
      const d = await telefonoInDb()
      await assert.rejects(sql`insert into ci_vado (dispositivo_id, punto_id, prodotti) values (${d}, ${negozio}, '{gasolio}')`.execute(db), { code: '23514' })
      await sql`insert into ci_vado (dispositivo_id, punto_id, prodotti) values (${d}, ${negozio}, '{latte}')`.execute(db)
      await assert.rejects(sql`insert into ci_vado (dispositivo_id, punto_id, prodotti) values (${d}, ${altroNegozio}, '{latte}')`.execute(db), { code: '23505' })
    })

    test('dopo 24 ore i «Ci vado» si cancellano', async () => {
      await pulisciGruppo()
      const [vecchio, recente] = [await telefonoInDb(), await telefonoInDb()]
      await sql`insert into ci_vado (dispositivo_id, punto_id, prodotti, creato_il) values (${vecchio}, ${negozio}, '{latte}', now() - interval '25 hours')`.execute(db)
      await sql`insert into ci_vado (dispositivo_id, punto_id, prodotti) values (${recente}, ${negozio}, '{latte}')`.execute(db)
      await pulisci()
      const { rows } = await sql<{ dispositivo_id: string }>`select dispositivo_id from ci_vado`.execute(db)
      assert.deepEqual(rows.map((r) => r.dispositivo_id), [recente])
    })
  })

  test('lo stesso telefono a Napoli e poi subito a Bari finisce tra le anomalie', async () => {
    const t = await nuovoDispositivo()
    await segnala(t, napoli, vicino(NAPOLI, 10))
    assert.equal((await segnala(t, bari, vicino(BARI, 10))).statusCode, 200)
    const v = await db.selectFrom('anomalie').selectAll().where('tipo', '=', 'velocita_impossibile').execute()
    assert.equal(v.length, 1)
  })

  test('un telefono bloccato non conta più, neanche per quello che ha già segnalato', async () => {
    await sql`truncate segnalazioni, voti, code restart identity cascade`.execute(db)
    const t = await nuovoDispositivo()
    await segnala(t, bari, vicino(BARI, 10), { stato: 'esaurito' })
    const statoBari = async () => (await app.inject({ url: `/api/vicini?lat=${BARI.lat}&lon=${BARI.lon}&n=1` })).json()[0].stato
    assert.equal((await statoBari()).prodotti[0].stato, 'esaurito')
    await sql`update dispositivi set bloccato = true where id = (select dispositivo_id from segnalazioni order by id desc limit 1)`.execute(db)
    assert.equal(await statoBari(), null)
  })

  test('i voti e le aperture di telefoni bloccati non spostano la fiducia, l’interesse né i dati aperti', async () => {
    await sql`truncate segnalazioni, voti, code, viste restart identity cascade`.execute(db)
    const [onesto, complice] = await Promise.all([nuovoDispositivo(), nuovoDispositivo()])
    const { segnalazione_id } = (await segnala(onesto, bari, vicino(BARI, 10))).json()
    // Cinque telefoni, poi bloccati, avevano smentito la segnalazione onesta e aperto la scheda
    await sql`
      with bloccati as (insert into dispositivi (bloccato) select true from generate_series(1, 5) returning id),
        smentite as (insert into voti (segnalazione_id, dispositivo_id, conferma) select ${segnalazione_id}, id, false from bloccati)
      insert into viste (punto_id, dispositivo_id) select ${bari}, id from bloccati
    `.execute(db)
    const s = (await segnala(complice, bari, vicino(BARI, 10), { stato: 'esaurito' })).json().stato
    assert.equal(s.prodotti[0].affidabilita, 'incerto') // una persona contro una: con le smentite dei bloccati vinceva «esaurito»
    assert.equal(s.interesse, 0)
    const csv = (await app.inject({ url: '/api/export/segnalazioni.csv' })).body
    assert.match(csv, new RegExp(`\\r\\n${segnalazione_id},.*,0,0,distributore\\r\\n`)) // né conferme né smentite
  })

  test('le segnalazioni valgono 24 ore: una di 10 ore fa conta ancora, una di 25 no', async () => {
    await sql`truncate segnalazioni, voti, code restart identity cascade`.execute(db)
    const t = await nuovoDispositivo()
    const { segnalazione_id } = (await segnala(t, bari, vicino(BARI, 10), { stato: 'esaurito' })).json()
    const statoBari = async () => (await app.inject({ url: `/api/vicini?lat=${BARI.lat}&lon=${BARI.lon}&n=1` })).json()[0].stato
    const invecchia = (ore: number) =>
      sql`update segnalazioni set visto_il = now() - make_interval(hours => ${ore}), creata_il = now() - make_interval(hours => ${ore}) where id = ${segnalazione_id}`.execute(db)
    await invecchia(10)
    assert.equal((await statoBari())?.prodotti[0]?.stato, 'esaurito')
    await invecchia(25)
    assert.equal(await statoBari(), null)
  })

  test('moderazione: serve la password; una segnalazione nascosta smette di contare', async () => {
    await sql`truncate segnalazioni, voti, code restart identity cascade`.execute(db)
    const t = await nuovoDispositivo()
    const { segnalazione_id } = (await segnala(t, bari, vicino(BARI, 10), { stato: 'esaurito' })).json()
    const comeAdmin = (url: string, password = ADMIN, payload?: object) =>
      app.inject({ method: payload ? 'POST' : 'GET', url, payload, headers: { authorization: `Bearer ${password}` } })

    assert.equal((await app.inject({ url: '/api/admin/riepilogo' })).statusCode, 401)
    assert.equal((await comeAdmin('/api/admin/riepilogo', 'sbagliata-sbagliata')).statusCode, 401)
    assert.equal((await comeAdmin('/api/admin/riepilogo')).json().segnalazioni_24h, 1)
    assert.equal((await comeAdmin('/api/admin/segnalazioni')).json()[0].id, segnalazione_id)

    const csv = async () => (await app.inject({ url: '/api/export/segnalazioni.csv' })).body
    assert.match(await csv(), /^id,punto_id,distributore,comune,lat,lon,prodotto,stato,visto_il,a_distanza,conferme,smentite,tipo\r\n1,/)
    assert.doesNotMatch(await csv(), /[0-9a-f]{8}-[0-9a-f]{4}-/) // nessun identificativo di telefono

    assert.equal((await comeAdmin(`/api/admin/segnalazioni/${segnalazione_id}`, ADMIN, { nascosta: true })).statusCode, 200)
    const statoBari = (await app.inject({ url: `/api/vicini?lat=${BARI.lat}&lon=${BARI.lon}&n=1` })).json()[0].stato
    assert.equal(statoBari, null)
    assert.equal(await csv(), '')
    const geo = (await app.inject({ url: '/api/export/segnalazioni.geojson' })).json()
    assert.equal(geo.type, 'FeatureCollection')
    assert.equal(geo.features.length, 0)
  })

  test('statistiche: visite contate, visitatori unici, e di notte l’elenco dei telefoni diventa un numero', async () => {
    await sql`truncate statistiche, presenze`.execute(db)
    const t = await nuovoDispositivo()
    await invia(t, '/api/visita', { installata: false })
    await invia(t, '/api/visita', { installata: true })
    await app.inject({ method: 'POST', url: '/api/visita', payload: { installata: false } }) // senza identificativo
    const comeAdmin = (url: string) => app.inject({ url, headers: { authorization: `Bearer ${ADMIN}` } })
    const oggi = (await comeAdmin('/api/admin/statistiche')).json()
    assert.equal(oggi.giorni.length, 30)
    const ultimo = oggi.giorni[29]
    assert.equal(ultimo.visite, 3)
    assert.equal(ultimo.visite_app, 1)
    assert.equal(ultimo.visitatori, 1)
    // Per contare i telefoni diversi si tiene un'impronta del giorno, mai l'identificativo del telefono
    const { rows: presenze } = await sql<{ riga: string }>`select row_to_json(p)::text as riga from presenze p`.execute(db)
    assert.equal(presenze.length, 1)
    assert.doesNotMatch(presenze[0].riga, /[0-9a-f]{8}-[0-9a-f]{4}-/)

    // Un telefono visto ieri: la pulizia lo conta e cancella la riga
    await sql`insert into presenze (giorno, impronta) values ((now() at time zone 'Europe/Rome')::date - 1, 'impronta-di-ieri')`.execute(db)
    await pulisci()
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from presenze where giorno < (now() at time zone 'Europe/Rome')::date`.execute(db)
    assert.equal(rows[0].n, 0)
    assert.equal((await comeAdmin('/api/admin/statistiche')).json().giorni[28].visitatori, 1)
    assert.equal((await app.inject({ url: '/api/admin/statistiche' })).statusCode, 401)
  })

  test('statistiche: da quale link si arriva (?da=), con un tetto alle etichette nuove del giorno', async () => {
    await sql`truncate statistiche`.execute(db)
    const visita = (da?: string) => app.inject({ method: 'POST', url: '/api/visita', payload: { installata: false, ...(da !== undefined && { da }) } })
    const statistiche = async () => (await app.inject({ url: '/api/admin/statistiche', headers: { authorization: `Bearer ${ADMIN}` } })).json()
    await visita('whatsapp')
    await visita('whatsapp')
    await visita('facebook')
    await visita() // senza etichetta: solo la visita
    assert.equal((await visita('x'.repeat(65))).statusCode, 400) // l'app ne manda al massimo 64
    let s = await statistiche()
    assert.deepEqual(s.fonti, [{ fonte: 'whatsapp', visite: 2 }, { fonte: 'facebook', visite: 1 }])
    assert.equal(s.giorni[29].visite, 4)

    // Il giorno ha già tutte le etichette che può avere: una nuova non apre una riga, una già vista si conta ancora
    await sql`
      insert into statistiche (giorno, chiave, valore)
      select (now() at time zone 'Europe/Rome')::date, 'fonte:riempitivo-' || i, 1 from generate_series(1, ${MAX_FONTI_AL_GIORNO - 2}::int) i
    `.execute(db)
    await visita('telegram')
    await visita('whatsapp')
    s = await statistiche()
    assert.equal(s.fonti.find((f: { fonte: string }) => f.fonte === 'telegram'), undefined)
    assert.deepEqual(s.fonti[0], { fonte: 'whatsapp', visite: 3 })
    assert.equal(s.giorni[29].visite, 6) // la visita si conta comunque
  })

  test('per un’ora si completa e si corregge la propria visita, anche lontano', async () => {
    await sql`truncate segnalazioni, voti, code restart identity cascade`.execute(db)
    const [t, altro, lontano] = await Promise.all([nuovoDispositivo(), nuovoDispositivo(), nuovoDispositivo()])
    const { segnalazione_id: prima } = (await segnala(t, napoli, vicino(NAPOLI, 10))).json() // gasolio disponibile
    await invia(altro, '/api/voti', { segnalazione_id: prima, conferma: true, ...vicino(NAPOLI, 10) })
    const azione = (chi: string, id: number, cosa: string, corpo: object = {}) => invia(chi, `/api/segnalazioni/${id}/${cosa}`, corpo)

    // Correggere: la conferma dell'altro era per "disponibile" e resta sua, non passa al nuovo stato
    const corretta = await azione(t, prima, 'correggi', { stato: 'esaurito' })
    assert.equal(corretta.statusCode, 200)
    const gasolio = corretta.json().stato.prodotti.find((p: { prodotto: string }) => p.prodotto === 'gasolio')
    assert.equal(gasolio.affidabilita, 'incerto') // t dice esaurito, l'altro disponibile
    assert.equal(gasolio.persone, 1)
    const ora = corretta.json().segnalazione_id
    assert.equal((await azione(altro, ora, 'correggi', { stato: 'disponibile' })).statusCode, 404) // solo le proprie

    // Aggiungere il carburante dimenticato, non due volte, non uno che il distributore non ha
    assert.equal((await azione(t, ora, 'aggiungi', { prodotto: 'benzina', stato: 'esaurito' })).statusCode, 200)
    assert.equal((await azione(t, ora, 'aggiungi', { prodotto: 'benzina', stato: 'scarso' })).statusCode, 409)
    assert.equal((await azione(t, ora, 'aggiungi', { prodotto: 'metano', stato: 'scarso' })).statusCode, 400)

    // La coda solo se eri sul posto
    assert.equal((await azione(t, ora, 'coda', { livello: 'lunga' })).json().stato.coda.livello, 'lunga')
    const { segnalazione_id: remota } = (await segnala(lontano, napoli, vicino(NAPOLI, 3000))).json()
    assert.equal((await azione(lontano, remota, 'coda', { livello: 'breve' })).statusCode, 403)

    const mie = (await app.inject({ url: '/api/mie', headers: { authorization: `Bearer ${t}` } })).json()
    assert.equal(mie.segnalazioni.length, 2) // gasolio corretto e benzina; la vecchia ritirata non c'è
    assert.equal(mie.code.length, 1)

    // Annullare la visita toglie carburanti e coda
    const annullata = (await azione(t, ora, 'annulla')).json().stato
    assert.equal(annullata.prodotti.some((p: { prodotto: string }) => p.prodotto === 'benzina'), false)
    assert.equal(annullata.coda, null)

    // Dopo un'ora non si corregge più, ma si può ancora annullare (entro 4 ore)
    const { segnalazione_id: vecchia } = (await segnala(t, napoli, vicino(NAPOLI, 10), { prodotto: 'benzina' })).json()
    await sql`update segnalazioni set creata_il = creata_il - interval '2 hours', visto_il = visto_il - interval '2 hours' where id = ${vecchia}`.execute(db)
    assert.equal((await azione(t, vecchia, 'correggi', { stato: 'scarso' })).statusCode, 403)
    assert.equal((await azione(t, vecchia, 'annulla')).statusCode, 200)
  })

  test('correggere o annullare la propria segnalazione non cancella i voti degli altri', async () => {
    await sql`truncate segnalazioni, voti, code restart identity cascade`.execute(db)
    const [a, b, c] = await Promise.all([nuovoDispositivo(), nuovoDispositivo(), nuovoDispositivo()])
    const { segnalazione_id } = (await segnala(a, napoli, vicino(NAPOLI, 10))).json() // gasolio disponibile
    for (const t of [b, c]) await invia(t, '/api/voti', { segnalazione_id, conferma: true, ...vicino(NAPOLI, 10) })
    type Prodotti = { stato: { prodotti: { prodotto: string; stato: string; persone: number }[] } }
    const gasolio = (r: { json(): Prodotti }) => r.json().stato.prodotti.find((p) => p.prodotto === 'gasolio')!

    // Un telefono da solo, correggendosi, non ribalta quello che due persone sul posto hanno confermato
    const corretta = await invia(a, `/api/segnalazioni/${segnalazione_id}/correggi`, { stato: 'esaurito' })
    assert.equal(gasolio(corretta).stato, 'disponibile')
    assert.equal(gasolio(corretta).persone, 2)

    const annullata = await invia(a, `/api/segnalazioni/${corretta.json().segnalazione_id}/annulla`, {})
    assert.equal(gasolio(annullata).stato, 'disponibile')
    assert.equal(gasolio(annullata).persone, 2)
  })

  test('la ricerca capisce la spesa: il negozio si trova con «supermercato», il distributore no', async () => {
    const lettura = costruisciApp({ segreto: 's'.repeat(32), passwordAdmin: ADMIN })
    lettura.log.level = 'silent'
    const beni = '{acqua,latte,pane,frutta_verdura,pasta_riso,carne_pesce,neonati}'
    try {
      await sql`insert into punti (nome, tipo, comune, geom, prodotti, fonte, id_fonte)
        values ('Zenzero', 'negozio', 'Napoli', ST_MakePoint(${NAPOLI.lon}, ${NAPOLI.lat})::geography, ${beni}::text[], 'test-cerca', 'zenzero')`.execute(db)
      type Risposta = { distributori: { punto: { nome: string } }[]; tipo: string; prodotto: string | null; luoghi: { distributori?: number }[] }
      const cerca = async (q: string, tipo = '') => (await lettura.inject({ url: `/api/cerca?q=${encodeURIComponent(q)}&lat=${NAPOLI.lat}&lon=${NAPOLI.lon}${tipo}` })).json() as Risposta
      const senza = await cerca('zenzero')
      assert.deepEqual(senza.distributori.map((t) => t.punto.nome), [])
      assert.equal(senza.tipo, 'distributore')
      // Senza `tipo` (app vecchia) niente negozi, anche se la frase parla di spesa.
      for (const q of ['supermercato zenzero', 'latte zenzero']) {
        const vecchia = await cerca(q)
        assert.deepEqual(vecchia.distributori.map((t) => t.punto.nome), [])
        assert.equal(vecchia.tipo, 'distributore')
        const nuova = await cerca(q, '&tipo=distributore')
        assert.deepEqual(nuova.distributori.map((t) => t.punto.nome), ['Zenzero'])
        assert.equal(nuova.tipo, 'negozio')
      }
      // Il bene vale quanto la parola d'intento, e il mondo della frase vince sul parametro.
      assert.equal((await cerca('latte zenzero', '&tipo=distributore')).tipo, 'negozio')
      assert.equal((await cerca('latte zenzero', '&tipo=negozio')).prodotto, 'latte')
      assert.equal((await cerca('benzinaio', '&tipo=negozio')).tipo, 'distributore')
      // Aperta la spesa, una frase senza intento cerca tra i negozi.
      assert.deepEqual((await cerca('zenzero', '&tipo=negozio')).distributori.map((t) => t.punto.nome), ['Zenzero'])
      // I comuni sono quelli dei distributori: un comune con soli negozi non compare con «0 distributori».
      await sql`update punti set comune = 'Gragnano' where fonte = 'test-cerca'`.execute(db)
      assert.deepEqual((await cerca('gragnano')).luoghi.filter((l) => l.distributori != null), [])
    } finally {
      await lettura.close()
      await sql`delete from punti where fonte = 'test-cerca'`.execute(db)
    }
  })

  test('ogni punto che l’API manda all’app porta il suo tipo (vicini, cerca, le tue segnalazioni, «Ci vado»)', async () => {
    const lettura = costruisciApp({ segreto: 's'.repeat(32), passwordAdmin: ADMIN })
    lettura.log.level = 'silent'
    try {
      const nuovo = async (nome: string, tipo: string, prodotti: string) => (await sql<{ id: number }>`
        insert into punti (nome, tipo, comune, geom, prodotti, fonte, id_fonte)
        values (${nome}, ${tipo}, 'Napoli', ST_MakePoint(${NAPOLI.lon}, ${NAPOLI.lat})::geography, ${prodotti}::text[], 'test-tipo', ${nome})
        returning id`.execute(db)).rows[0].id
      const negozio = await nuovo('Tipo negozio', 'negozio', '{latte}')
      const pompa = await nuovo('Tipo pompa', 'distributore', '{gasolio}')
      const tipoDi = (righe: { punto: { id: number; tipo: string } }[]) => Object.fromEntries(righe.map((r) => [r.punto.id, r.punto.tipo]))
      const vicini = (tipo: string) => lettura.inject({ url: `/api/vicini?lat=${NAPOLI.lat}&lon=${NAPOLI.lon}&n=150&tipo=${tipo}` })
      assert.equal(tipoDi((await vicini('negozio')).json())[negozio], 'negozio')
      assert.equal(tipoDi((await vicini('distributore')).json())[pompa], 'distributore')
      const cerca = (q: string, tipo: string) => lettura.inject({ url: `/api/cerca?q=${encodeURIComponent(q)}&lat=${NAPOLI.lat}&lon=${NAPOLI.lon}&tipo=${tipo}` })
      assert.equal(tipoDi((await cerca('tipo negozio', 'negozio')).json().distributori)[negozio], 'negozio')
      assert.equal(tipoDi((await cerca('tipo pompa', 'distributore')).json().distributori)[pompa], 'distributore')
      // Le tue segnalazioni e il tuo «Ci vado»: telefono vero, sul posto.
      const t = firmaToken('s'.repeat(32), (await sql<{ id: string }>`insert into dispositivi default values returning id`.execute(db)).rows[0].id)
      assert.equal((await segnala(t, pompa, NAPOLI)).statusCode, 200)
      assert.equal((await invia(t, '/api/ci-vado', { punto_id: negozio, prodotti: ['latte'], ...NAPOLI })).statusCode, 200)
      const mie = (await lettura.inject({ url: '/api/mie', headers: { authorization: `Bearer ${t}` } })).json()
      assert.equal(mie.segnalazioni[0].punto.tipo, 'distributore')
      assert.equal(mie.ci_vado.punto.tipo, 'negozio')
      // Anche la moderazione sa dire «negozio»: le correzioni e le segnalazioni portano il tipo.
      const admin = (url: string) => lettura.inject({ url, headers: { authorization: `Bearer ${ADMIN}` } })
      assert.equal((await admin('/api/admin/segnalazioni')).json()[0].tipo, 'distributore')
    } finally {
      await lettura.close()
      await sql`truncate segnalazioni, voti, code, viste, anomalie, ci_vado restart identity cascade`.execute(db)
      await sql`delete from punti where fonte = 'test-tipo'`.execute(db)
    }
  })

  test('la moderazione delle correzioni distingue il tipo della richiesta dal tipo del punto', async () => {
    const { rows: [{ id: negozio }] } = await sql<{ id: number }>`
      insert into punti (nome, tipo, geom, prodotti, fonte, id_fonte)
      values ('Negozio corretto', 'negozio', ST_MakePoint(${NAPOLI.lon}, ${NAPOLI.lat})::geography, '{acqua,latte}', 'test-correzioni', 'n')
      returning id`.execute(db)
    try {
      const r = await app.inject({
        method: 'POST', url: '/api/correzioni',
        payload: { punto_id: negozio, tipo: 'gestore', marchio: null, messaggio: '', contatto: 'gestore@example.com' },
      })
      assert.equal(r.statusCode, 200)
      const righe = (await app.inject({ url: '/api/admin/correzioni', headers: { authorization: `Bearer ${ADMIN}` } })).json()
      const riga = righe.find((c: { punto_id: number }) => c.punto_id === negozio)
      // «Sono il gestore» deve restare riconoscibile: il tipo del punto non deve prenderne il posto.
      assert.equal(riga.tipo, 'gestore')
      assert.equal(riga.punto_tipo, 'negozio')
    } finally {
      await sql`delete from correzioni where punto_id = ${negozio}`.execute(db)
      await sql`delete from punti where fonte = 'test-correzioni'`.execute(db)
    }
  })

  test('/api/vicini accetta i beni solo per i negozi e i carburanti solo per i distributori', async () => {
    const lettura = costruisciApp({ segreto: 's'.repeat(32), passwordAdmin: ADMIN })
    lettura.log.level = 'silent'
    const beni = '{acqua,latte}'
    try {
      await sql`insert into punti (nome, tipo, geom, prodotti, fonte, id_fonte)
        values ('Solo latte', 'negozio', ST_MakePoint(${NAPOLI.lon}, ${NAPOLI.lat})::geography, ${beni}::text[], 'test-vicini', 'a'),
               ('Solo pane', 'negozio', ST_MakePoint(${NAPOLI.lon}, ${NAPOLI.lat})::geography, '{pane}'::text[], 'test-vicini', 'b')`.execute(db)
      const vicini = (query: string) => lettura.inject({ url: `/api/vicini?lat=${NAPOLI.lat}&lon=${NAPOLI.lon}&${query}` })
      const buono = await vicini('tipo=negozio&prodotto=latte')
      assert.equal(buono.statusCode, 200)
      assert.deepEqual((buono.json() as { punto: { nome: string } }[]).map((x) => x.punto.nome), ['Solo latte'])
      assert.equal((await vicini('tipo=distributore&prodotto=gpl')).statusCode, 200)
      assert.equal((await vicini('tipo=distributore&prodotto=latte')).statusCode, 400)
      assert.equal((await vicini('tipo=negozio&prodotto=gpl')).statusCode, 400)
      assert.equal((await vicini('prodotto=latte')).statusCode, 400) // senza tipo vale distributore
      assert.equal((await vicini('tipo=negozio&prodotto=oro')).statusCode, 400)
    } finally {
      await lettura.close()
      await sql`delete from punti where fonte = 'test-vicini'`.execute(db)
    }
  })

  test('le letture distinguono il tipo: il negozio è solo di ?tipo=negozio, le province contano i distributori come prima e la spesa a parte', async () => {
    await sql`truncate segnalazioni, voti, code, viste restart identity cascade`.execute(db)
    // Un'app nuova: la sua cache non conosce i test precedenti.
    const lettura = costruisciApp({ segreto: 's'.repeat(32), passwordAdmin: ADMIN })
    lettura.log.level = 'silent'
    const beni = '{acqua,latte,pane,frutta_verdura,pasta_riso,carne_pesce,neonati}'
    try {
      const { rows: [{ id: negozio }] } = await sql<{ id: number }>`
        insert into punti (nome, tipo, provincia, geom, prodotti, fonte, id_fonte)
        values ('Negozio', 'negozio', 'NA', ST_MakePoint(${NAPOLI.lon}, ${vicino(NAPOLI, 100).lat})::geography, ${beni}::text[], 'test-tipo', 'negozio') returning id`.execute(db)
      await sql`update punti set provincia = 'NA' where id = ${napoli}`.execute(db)
      const { rows: [{ id: telefono }] } = await sql<{ id: string }>`insert into dispositivi default values returning id`.execute(db)
      await sql`insert into segnalazioni (punto_id, prodotto, stato, dispositivo_id) values (${negozio}, 'acqua', 'esaurito', ${telefono})`.execute(db)
      const nomi = (r: { json(): unknown }) => (r.json() as { punto: { nome: string } }[]).map((x) => x.punto.nome)
      const vicini = (tipo = '') => lettura.inject({ url: `/api/vicini?lat=${NAPOLI.lat}&lon=${NAPOLI.lon}&n=150${tipo}` })

      assert.deepEqual(nomi(await vicini()), ['Napoli', 'Bari'])
      assert.deepEqual(nomi(await vicini('&tipo=distributore')), ['Napoli', 'Bari'])
      const soloNegozio = await vicini('&tipo=negozio')
      assert.deepEqual(nomi(soloNegozio), ['Negozio'])
      const [{ stato }] = soloNegozio.json() as { stato: { tipo: string; prodotti: { prodotto: string }[] } }[]
      assert.equal(stato.tipo, 'negozio')
      assert.deepEqual(stato.prodotti.map((p) => p.prodotto), ['acqua'])

      type Mappa = { punti: [number, number, number, number][]; stati: { punto_id: number; tipo: string }[] }
      const distributori = (await lettura.inject({ url: '/api/mappa' })).json() as Mappa
      assert.ok(!distributori.punti.some((p) => p[0] === negozio))
      assert.deepEqual(distributori.stati, [])
      const negozi = (await lettura.inject({ url: '/api/mappa?tipo=negozio' })).json() as Mappa
      assert.deepEqual(negozi.punti.map((p) => p[0]), [negozio])
      assert.equal(negozi.punti[0][3], 0b1111111 << 4) // i sette beni, dopo i quattro carburanti
      assert.deepEqual(negozi.stati.map((s) => [s.punto_id, s.tipo]), [[negozio, 'negozio']])

      // Province e bollettino: la segnalazione del negozio non sposta i distributori né i colori; la spesa è a parte.
      type Provincia = { provincia: string; distributori: number; verde: number; giallo: number; rosso: number; spesa: { negozi: number; con_notizie: number; comuni_senza: number } }
      const province = (await lettura.inject({ url: '/api/province' })).json() as Provincia[]
      assert.deepEqual(province.filter((p) => p.provincia === 'NA').map((p) => [p.distributori, p.verde, p.giallo, p.rosso]), [[1, 0, 0, 0]])
      // Un negozio con una notizia, ma senza comune: conta nei totali, non tra i comuni senza.
      assert.deepEqual(province.find((p) => p.provincia === 'NA')?.spesa, { negozi: 1, con_notizie: 1, comuni_senza: 0 })
      const bollettino = (await lettura.inject({ url: '/api/province/NA' })).json() as { distributori: number; rosso: number; spesa: { negozi: number } }
      assert.deepEqual([bollettino.distributori, bollettino.rosso, bollettino.spesa.negozi], [1, 0, 1])

      // Pannello: i distributori sono solo i distributori. Esportazione: la riga dice di che tipo è.
      const riepilogo = (await lettura.inject({ url: '/api/admin/riepilogo', headers: { authorization: `Bearer ${ADMIN}` } })).json()
      assert.equal(riepilogo.distributori, 2)
      const aperti = (await lettura.inject({ url: '/api/export/segnalazioni.geojson' })).json() as { features: { properties: { punto_id: number; tipo: string } }[] }
      assert.deepEqual(aperti.features.map((f) => [f.properties.punto_id, f.properties.tipo]), [[negozio, 'negozio']])
    } finally {
      await lettura.close()
      await sql`truncate segnalazioni restart identity cascade`.execute(db)
      await sql`delete from punti where fonte = 'test-tipo'`.execute(db)
      await sql`update punti set provincia = null where id = ${napoli}`.execute(db)
    }
  })

  test('il bollettino della provincia porta la spesa e tiene i campi di prima', async () => {
    await sql`truncate segnalazioni, voti, code, viste restart identity cascade`.execute(db)
    const lettura = costruisciApp({ segreto: 's'.repeat(32), passwordAdmin: ADMIN })
    lettura.log.level = 'silent'
    try {
      // Napoli ha un distributore (senza notizie), un negozio con l'acqua finita per due telefoni e un secondo negozio
      // dove il pane è contestato (uno dice finito, l'altro disponibile): «incerto», quindi nessuna notizia.
      await sql`update punti set provincia = 'NA', comune = 'Napoli' where id = ${napoli}`.execute(db)
      const { rows: [{ id: negozio }] } = await sql<{ id: number }>`
        insert into punti (nome, tipo, comune, provincia, geom, prodotti, fonte, id_fonte)
        values ('Spesa Napoli', 'negozio', 'Napoli', 'NA', ST_MakePoint(${NAPOLI.lon}, ${vicino(NAPOLI, 100).lat})::geography, '{acqua,pane}', 'test-spesa-prov', 'spesa-napoli') returning id`.execute(db)
      for (let i = 0; i < 2; i++) {
        const { rows: [{ id: telefono }] } = await sql<{ id: string }>`insert into dispositivi default values returning id`.execute(db)
        await sql`insert into segnalazioni (punto_id, prodotto, stato, dispositivo_id) values (${negozio}, 'acqua', 'esaurito', ${telefono})`.execute(db)
      }
      const { rows: [{ id: contestato }] } = await sql<{ id: number }>`
        insert into punti (nome, tipo, comune, provincia, geom, prodotti, fonte, id_fonte)
        values ('Spesa Napoli 2', 'negozio', 'Napoli', 'NA', ST_MakePoint(${NAPOLI.lon}, ${vicino(NAPOLI, 200).lat})::geography, '{acqua,pane}', 'test-spesa-prov', 'spesa-napoli-2') returning id`.execute(db)
      for (const [stato, ore] of [['disponibile', 1], ['esaurito', 0]]) { // il finito è più recente: vincerebbe da solo
        const { rows: [{ id: telefono }] } = await sql<{ id: string }>`insert into dispositivi default values returning id`.execute(db)
        await sql`insert into segnalazioni (punto_id, prodotto, stato, dispositivo_id, visto_il)
          values (${contestato}, 'pane', ${stato}, ${telefono}, now() - make_interval(hours => ${ore}))`.execute(db)
      }

      const r = await lettura.inject({ url: '/api/province/NA' })
      assert.equal(r.statusCode, 200)
      const b = r.json()
      // I campi di prima restano, con lo stesso significato; si aggiunge soltanto la spesa.
      for (const campo of ['provincia', 'aggiornato_il', 'distributori', 'verde', 'giallo', 'rosso', 'lat', 'lon', 'comuni', 'andamento', 'spesa']) {
        assert.ok(campo in b, `manca il campo ${campo}`)
      }
      assert.deepEqual([b.provincia, b.distributori, b.verde, b.giallo, b.rosso], ['NA', 1, 0, 0, 0]) // il negozio non è un distributore
      assert.deepEqual(b.comuni.map((c: { comune: string; gruppo: string }) => [c.comune, c.gruppo]), [['Napoli', 'senza_notizie']])
      assert.deepEqual(b.spesa.beni[0], { bene: 'acqua', comuni: [{ comune: 'Napoli', confermato: true }] })
      assert.deepEqual([b.spesa.negozi, b.spesa.con_notizie, b.spesa.beni.length], [2, 1, 1]) // il pane contestato non fa «senza pane»
      assert.doesNotMatch(r.body, /[0-9a-f]{8}-[0-9a-f]{4}-/) // nessun identificativo di telefono

      // L'elenco porta lo stesso conto dei comuni senza, senza i nomi.
      const province = (await lettura.inject({ url: '/api/province' })).json() as { provincia: string; spesa: object }[]
      assert.deepEqual(province.find((p) => p.provincia === 'NA')?.spesa, { negozi: 2, con_notizie: 1, comuni_senza: 1 })
    } finally {
      await lettura.close()
      await sql`truncate segnalazioni restart identity cascade`.execute(db)
      await sql`delete from punti where fonte = 'test-spesa-prov'`.execute(db)
      await sql`update punti set provincia = null, comune = null where id = ${napoli}`.execute(db)
    }
  })

  test('i vicini arrivano dal più vicino', async () => {
    const r = (await app.inject({ url: `/api/vicini?lat=${NAPOLI.lat}&lon=${NAPOLI.lon}&n=2` })).json()
    assert.deepEqual(r.map((x: { punto: { nome: string } }) => x.punto.nome), ['Napoli', 'Bari'])
  })

  test('i vicini si possono limitare alla zona inquadrata', async () => {
    const zona = `ovest=${NAPOLI.lon - 0.2}&sud=${NAPOLI.lat - 0.2}&est=${NAPOLI.lon + 0.2}&nord=${NAPOLI.lat + 0.2}`
    const r = (await app.inject({ url: `/api/vicini?lat=${NAPOLI.lat}&lon=${NAPOLI.lon}&n=150&${zona}` })).json()
    assert.deepEqual(r.map((x: { punto: { nome: string } }) => x.punto.nome), ['Napoli'])
  })

  test('mappa da lontano: tutti i distributori compatti, gli stati solo di quelli con notizie', async () => {
    await sql`truncate segnalazioni, voti, code, viste restart identity cascade`.execute(db)
    const t = await nuovoDispositivo()
    await segnala(t, napoli, vicino(NAPOLI, 10))
    const r = await app.inject({ url: '/api/mappa' })
    assert.equal(r.statusCode, 200)
    const { punti, stati } = r.json() as { punti: [number, number, number, number][]; stati: { punto_id: number }[] }
    // [id, lat, lon, carburanti]: benzina e gasolio = 1 | 2
    assert.deepEqual(punti.find((p) => p[0] === napoli), [napoli, NAPOLI.lat, NAPOLI.lon, 3])
    assert.ok(punti.some((p) => p[0] === bari))
    assert.deepEqual(stati.map((s) => s.punto_id), [napoli])
    assert.doesNotMatch(r.body, /[0-9a-f]{8}-[0-9a-f]{4}-/) // nessun identificativo di telefono
  })

  test('mappa: chi arriva mentre si calcola aspetta lo stesso calcolo', async () => {
    // Una richiesta sola contro cinque insieme, ognuna su un'app nuova (cache vuota): connessioni prese dal pool
    // e risposte diverse (calcolato_il cambia a ogni calcolo).
    const insieme = async (richieste: number) => {
      const nuova = costruisciApp({ segreto: 's'.repeat(32) })
      nuova.log.level = 'silent'
      let connessioni = 0
      const conta = () => connessioni++
      pool.on('acquire', conta)
      const risposte = await Promise.all(Array.from({ length: richieste }, () => nuova.inject({ url: '/api/mappa' })))
      pool.off('acquire', conta)
      await nuova.close()
      assert.ok(risposte.every((r) => r.statusCode === 200))
      return { connessioni, diverse: new Set(risposte.map((r) => r.body)).size }
    }
    const una = await insieme(1)
    const cinque = await insieme(5)
    assert.equal(cinque.connessioni, una.connessioni)
    assert.equal(cinque.diverse, 1)
  })

  // In fondo: aggiunge distributori che gli altri test non si aspettano.
  test('bollettino della provincia: comuni per gruppo, sigla sconosciuta e sigla non valida', async () => {
    await sql`truncate segnalazioni, voti, code, viste restart identity cascade`.execute(db)
    const EBOLI = { lat: 40.617, lon: 15.056 }
    const SARNO = { lat: 40.81, lon: 14.62 }
    const inserisci = (nome: string, comune: string, p: { lat: number; lon: number }) => sql<{ id: number }>`
      insert into punti (nome, comune, provincia, geom, prodotti, fonte, id_fonte)
      values (${nome}, ${comune}, 'SA', ST_MakePoint(${p.lon}, ${p.lat})::geography, '{benzina,gasolio}', 'test', ${nome}) returning id`.execute(db)
    const eboli = (await inserisci('Eboli 1', 'Eboli', EBOLI)).rows[0].id
    await inserisci('Sarno 1', 'Sarno', SARNO)
    await segnala(await nuovoDispositivo(), eboli, vicino(EBOLI, 50), { stato: 'esaurito' })

    const r = await app.inject({ url: '/api/province/SA' })
    assert.equal(r.statusCode, 200)
    assert.equal(r.headers['cache-control'], 'public, max-age=60')
    const b = r.json()
    assert.deepEqual([b.provincia, b.distributori, b.verde, b.giallo, b.rosso], ['SA', 2, 0, 0, 1])
    assert.deepEqual(b.comuni.map((c: { comune: string; gruppo: string; confermato: boolean }) => [c.comune, c.gruppo, c.confermato]),
      [['Eboli', 'senza_carburante', false], ['Sarno', 'senza_notizie', false]])
    assert.ok(b.comuni[0].ultima)
    assert.doesNotMatch(r.body, /[0-9a-f]{8}-[0-9a-f]{4}-/) // nessun identificativo di telefono
    assert.equal((await app.inject({ url: '/api/province/ZZ' })).statusCode, 404)
    assert.equal((await app.inject({ url: '/api/province/sa' })).statusCode, 400)
  })
})

test('CSV: virgole, virgolette e a capo tra virgolette', () => {
  assert.equal(comeCsv([{ a: 'Q8, Via Roma', b: 'il "Grande"', c: null }]), 'a,b,c\r\n"Q8, Via Roma","il ""Grande""",\r\n')
})

test('colore di un distributore come sulla mappa', () => {
  const p = (stato: string, affidabilita = 'affidabile') => ({ stato, affidabilita }) as never
  const s = (...prodotti: never[]) => ({ punto_id: 1, tipo: 'distributore' as const, prodotti, coda: null, interesse: 0, calcolato_il: 0, arrivi: 0, arrivi_per: {}, stima: { coda_in_aumento: false, potrebbe_finire: [] } })
  assert.equal(coloreDi(undefined), null)
  assert.equal(coloreDi(s(p('disponibile'), p('disponibile'))), 'verde')
  assert.equal(coloreDi(s(p('esaurito'))), 'rosso')
  assert.equal(coloreDi(s(p('disponibile'), p('esaurito'))), 'giallo')
  assert.equal(coloreDi(s(p('esaurito', 'incerto'))), null)
})
