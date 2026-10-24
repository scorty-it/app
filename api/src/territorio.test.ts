// Confini dei comuni e comune dei negozi contro un PostgreSQL vero. Cancella tutto: parte solo su un database che finisce con "_test".
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { sql } from 'kysely'
import type { FileConfini } from './confini.ts'
import { db, pool } from './db.ts'
import { salvaImpianti, type Impianto } from './distributori.ts'
import { migra } from './migra.ts'
import { BENI } from './prodotti.ts'
import { assegnaComuniNegozi, caricaConfini } from './territorio.ts'

const attivo = process.env.PGDATABASE?.endsWith('_test') ?? false

type Punto = [number, number]
const quadrato = (x0: number, y0: number, x1: number, y1: number): Punto[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]

// Coordinate UTM 32N in metri, come nel file vero: due quadrati di 10 km affiancati e, dentro Alfa, un buco di 2 km
// che è il comune Gamma. Il buco ha lo stesso verso del bordo esterno: i confini veri non rispettano nessuna convenzione.
const BUCO = quadrato(943_000, 4_543_000, 945_000, 4_545_000)
const finti: FileConfini = {
  fonte: 'prova',
  versione: 'prova',
  srid: 32632,
  comuni: [
    { codice: '000001', comune: 'Alfa', provincia: 'NA', anelli: [quadrato(940_000, 4_540_000, 950_000, 4_550_000), BUCO] },
    { codice: '000002', comune: 'Beta', provincia: 'SA', anelli: [quadrato(950_000, 4_540_000, 960_000, 4_550_000)] },
    { codice: '000003', comune: 'Gamma', provincia: 'NA', anelli: [BUCO] },
  ],
}
const centroAlfa: Punto = [946_500, 4_546_500]
const centroBeta: Punto = [955_000, 4_545_000]
const BetaA50m: Punto = [950_050, 4_545_000] // in Beta, a 50 m dal confine con Alfa
const centroGamma: Punto = [944_000, 4_544_000]
const fuoriDaTutti: Punto = [970_000, 4_545_000]

// Le posizioni dei negozi si danno in gradi, ricavate dai metri dal database stesso: lo stesso calcolo del caricamento dei confini.
async function latLonDi([x, y]: Punto): Promise<[number, number]> {
  const { rows: [r] } = await sql<{ lat: number; lon: number }>`
    select ST_Y(g) as lat, ST_X(g) as lon from (select ST_Transform(ST_SetSRID(ST_MakePoint(${x}, ${y}), 32632), 4326) as g) t
  `.execute(db)
  return [r.lat, r.lon]
}

const negozioOsm = (id: string, [lat, lon]: [number, number]): Impianto => ({
  id_fonte: id, nome: `Negozio ${id}`, marchio: null, indirizzo: null, comune: null, provincia: null, lat, lon, prodotti: BENI,
})

// { a: [comune, provincia] }: la chiave è l'ultima parte di id_fonte («node/a» → a), solo i negozi attivi.
async function comuniDeiNegozi() {
  const { rows } = await sql<{ id_fonte: string; comune: string | null; provincia: string | null }>`
    select id_fonte, comune, provincia from punti where tipo = 'negozio' and attivo order by id_fonte
  `.execute(db)
  return Object.fromEntries(rows.map((r) => [r.id_fonte.split('/').at(-1)!, [r.comune, r.provincia]]))
}

const quanti = async () => (await sql<{ n: number }>`select count(*)::int as n from confini_comuni`.execute(db)).rows[0].n

describe('confini dei comuni e comune dei negozi', { skip: !attivo && 'serve PGDATABASE che finisca con _test' }, () => {
  let negozi: Impianto[]
  before(async () => {
    await migra(pool)
    await sql`truncate punti restart identity cascade`.execute(db)
    await sql`delete from confini_comuni`.execute(db)
    // I negozi arrivano prima dei confini: senza confini non hanno né comune né provincia.
    negozi = await Promise.all([
      negozioOsm('node/a', await latLonDi(centroAlfa)),
      negozioOsm('node/b', await latLonDi(BetaA50m)),
      negozioOsm('node/c', await latLonDi(centroGamma)),
      negozioOsm('node/d', await latLonDi(fuoriDaTutti)),
    ])
    await salvaImpianti(negozi, 'osm-negozi', 'negozio')
  })
  // Le altre suite non devono trovare né confini finti né i negozi di prova.
  after(async () => {
    await sql`delete from confini_comuni`.execute(db)
    await sql`truncate punti restart identity cascade`.execute(db)
    await db.destroy()
  })

  test('il negozio prende il comune in cui cade, anche a 50 m dal confine e dentro un buco di un altro comune', async () => {
    assert.deepEqual(await comuniDeiNegozi(), { a: [null, null], b: [null, null], c: [null, null], d: [null, null] })
    assert.equal(await caricaConfini(finti), 3)
    // a: centro di Alfa; b: in Beta a 50 m dal confine con Alfa; c: dentro Gamma (buco di Alfa); d: fuori da tutti
    assert.deepEqual(await comuniDeiNegozi(), { a: ['Alfa', 'NA'], b: ['Beta', 'SA'], c: ['Gamma', 'NA'], d: [null, null] })
  })

  test('il buco di Alfa è un buco davvero, qualunque verso abbiano gli anelli', async () => {
    const { rows } = await sql<{ codice: string; metri: number }>`
      select codice, round(ST_Area(ST_Transform(geom, 32632)))::int as metri from confini_comuni order by codice
    `.execute(db)
    // 10 km × 10 km meno 2 km × 2 km. I confini sono andati in gradi e tornati in metri: un margine di 1 su mille per gli arrotondamenti.
    assert.ok(Math.abs(rows[0].metri - 96_000_000) < 96_000, `Alfa: ${rows[0].metri} m²`)
    assert.ok(Math.abs(rows[1].metri - 100_000_000) < 100_000, `Beta: ${rows[1].metri} m²`)
    assert.ok(Math.abs(rows[2].metri - 4_000_000) < 4_000, `Gamma: ${rows[2].metri} m²`)
  })

  test('i distributori tengono il comune del Ministero', async () => {
    const [lat, lon] = await latLonDi(centroBeta)
    await salvaImpianti([{ id_fonte: 'd1', nome: 'Distributore', marchio: null, indirizzo: null, comune: 'Ministero', provincia: 'SA', lat, lon, prodotti: ['gasolio'] }], 'mimit')
    // Il distributore cade in Beta, ma il comune resta quello del Ministero; i negozi si riassegnano di nuovo, uguali.
    assert.equal(await assegnaComuniNegozi(db), 3)
    const { rows } = await sql<{ comune: string; provincia: string }>`select comune, provincia from punti where tipo = 'distributore'`.execute(db)
    assert.deepEqual(rows, [{ comune: 'Ministero', provincia: 'SA' }])
    assert.deepEqual((await comuniDeiNegozi()).b, ['Beta', 'SA'])
  })

  test('stessa versione: non ricarica; versione nuova: sostituisce e riassegna', async () => {
    assert.equal(await caricaConfini(finti), 0)
    const beta = (c: { comune: string }) => c.comune === 'Beta'
    assert.equal(await caricaConfini({ ...finti, versione: 'nuova', comuni: finti.comuni.map((c) => beta(c) ? { ...c, comune: 'Beta Nuova' } : c) }), 3)
    assert.deepEqual((await comuniDeiNegozi()).b, ['Beta Nuova', 'SA'])
    assert.equal(await quanti(), 3)
  })

  test('stessa versione ma un numero diverso di comuni: ricarica, e il negozio senza più confine torna senza comune', async () => {
    assert.equal(await caricaConfini({ ...finti, versione: 'nuova', comuni: finti.comuni.slice(0, 1) }), 1)
    assert.equal(await quanti(), 1)
    // Con il solo Alfa (e il suo buco) restano senza comune b (Beta) e c (Gamma).
    assert.deepEqual(await comuniDeiNegozi(), { a: ['Alfa', 'NA'], b: [null, null], c: [null, null], d: [null, null] })
  })

  test('un confine che non si può ricostruire annulla il caricamento: quelli di prima restano', async () => {
    const rotto: FileConfini = { ...finti, versione: 'rotta', comuni: [...finti.comuni, { codice: '000009', comune: 'Rotto', provincia: 'NA', anelli: [[[0, 0], [1000, 0], [1000, 1000]]] }] }
    await assert.rejects(() => caricaConfini(rotto))
    assert.equal(await quanti(), 1)
    assert.deepEqual((await sql<{ versione: string }>`select distinct versione from confini_comuni`.execute(db)).rows, [{ versione: 'nuova' }])
    assert.deepEqual((await comuniDeiNegozi()).a, ['Alfa', 'NA'])
  })

  test('un anello che tocca se stesso in un punto (come Bronte e Sannicandro di Bari nel file vero) è un’area con il suo buco', async () => {
    // Un solo anello che passa tre volte dal primo punto: il perimetro e, dentro, un triangolo di 0,42 km² che lo tocca in quel punto.
    const [x, y] = [965_000, 4_540_000]
    const delta = { codice: '000004', comune: 'Delta', provincia: 'SA', anelli: [[[x, y], [x + 1000, y + 400], [x + 400, y + 1000], [x, y], [x + 2000, y], [x + 2000, y + 2000], [x, y + 2000], [x, y]] as Punto[]] }
    assert.equal(await caricaConfini({ ...finti, versione: 'pizzico', comuni: [delta] }), 1)
    const { rows: [r] } = await sql<{ metri: number; nel_buco: boolean; nel_resto: boolean }>`
      select round(ST_Area(ST_Transform(geom, 32632)))::int as metri,
        ST_Covers(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${x + 500}, ${y + 400}), 32632), 4326)) as nel_buco,
        ST_Covers(geom, ST_Transform(ST_SetSRID(ST_MakePoint(${x + 1500}, ${y + 1500}), 32632), 4326)) as nel_resto
      from confini_comuni
    `.execute(db)
    assert.deepEqual(r, { metri: 4_000_000 - 420_000, nel_buco: false, nel_resto: true })
  })

  test('l’importazione dei negozi assegna il comune nella stessa transazione', async () => {
    assert.equal(await caricaConfini(finti), 3)
    // L'importazione passa tutti i negozi della fonte: con meno della metà dei punti attivi verrebbe scartata.
    const nuovo = negozioOsm('node/1', await latLonDi(centroBeta))
    await salvaImpianti([...negozi, nuovo], 'osm-negozi', 'negozio')
    assert.deepEqual(await comuniDeiNegozi(), { 1: ['Beta', 'SA'], a: ['Alfa', 'NA'], b: ['Beta', 'SA'], c: ['Gamma', 'NA'], d: [null, null] })
  })

  test('il file vero: 1.733 comuni di 27 province, tutti con un’area valida', async () => {
    assert.equal(await caricaConfini(), 1733)
    const { rows: [r] } = await sql<{ validi: number; vuoti: number; province: number }>`
      select count(*) filter (where ST_IsValid(geom))::int as validi, count(*) filter (where ST_IsEmpty(geom))::int as vuoti,
        count(distinct provincia)::int as province
      from confini_comuni
    `.execute(db)
    assert.deepEqual(r, { validi: 1733, vuoti: 0, province: 27 })
    assert.equal(await caricaConfini(), 0) // stessa versione, stesso numero: già carico
  })
})
