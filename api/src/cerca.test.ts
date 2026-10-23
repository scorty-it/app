// La ricerca nel database gira solo su un database che finisce con "_test" (lo svuota).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { sql } from 'kysely'
import { centrato, cercaComuni, cercaDistributori, daPhoton, interpreta, urlPhoton } from './cerca.ts'
import { db, pool } from './db.ts'
import { migra } from './migra.ts'

test('interpreta: cosa si cerca, dove, e se è un indirizzo', () => {
  assert.deepEqual(interpreta("Cava De' Tirreni – Località").parole, ['cava', 'de', 'tirreni', 'localita'])
  assert.deepEqual(interpreta('benzinaio al Vomero'), { mondo: 'carburante', parole: ['vomero'], testo: 'vomero', prodotto: null, indirizzo: false })
  assert.deepEqual(interpreta('GPL Napoli'), { mondo: 'carburante', parole: ['napoli'], testo: 'napoli', prodotto: 'gpl', indirizzo: false })
  assert.equal(interpreta('diesel').prodotto, 'gasolio')
  assert.equal(interpreta('via Toledo 256, Napoli').indirizzo, true)
  assert.equal(interpreta('corso Umberto').indirizzo, true)
  assert.equal(interpreta('eni salerno').indirizzo, false)
  assert.equal(interpreta('q8 cava').indirizzo, false)
  const luogo = { nome: 'Ospedale Cardarelli', dettaglio: 'Via Antonio Cardarelli 9, Napoli', lat: 0, lon: 0, zoom: 17 }
  assert.equal(centrato(luogo, interpreta('ospedale cardarelli')), true)
  assert.equal(centrato(luogo, interpreta('ospedaletto')), false)
  assert.equal(centrato({ ...luogo, nome: 'Parcheggio Q8 Bar', dettaglio: "Via Venticinque Luglio, Cava de' Tirreni" }, interpreta('q8 cava')), false)
  assert.deepEqual(interpreta('stazione centrale palermo').parole, ['stazione', 'centrale', 'palermo'])
})

test('interpreta: la spesa e i suoi beni', () => {
  const vista = (q: string) => { const { mondo, prodotto, parole, indirizzo } = interpreta(q); return { mondo, prodotto, parole, indirizzo } }
  assert.deepEqual(vista('latte vomero'), { mondo: 'spesa', prodotto: 'latte', parole: ['vomero'], indirizzo: false })
  assert.deepEqual(vista('supermercato salerno'), { mondo: 'spesa', prodotto: null, parole: ['salerno'], indirizzo: false })
  assert.deepEqual(vista('gpl napoli'), { mondo: 'carburante', prodotto: 'gpl', parole: ['napoli'], indirizzo: false })
  assert.equal(interpreta('benzina verde bari').prodotto, 'benzina') // «verde» resta benzina
  assert.equal(interpreta('benzina verde bari').mondo, 'carburante')
  assert.equal(interpreta('verdura salerno').prodotto, 'frutta_verdura')
  assert.deepEqual(vista('frutta e verdura'), { mondo: 'spesa', prodotto: 'frutta_verdura', parole: [], indirizzo: false })
  assert.equal(interpreta('pannolini').prodotto, 'neonati')
  assert.equal(interpreta('omogeneizzati').prodotto, 'neonati')
  assert.equal(interpreta('pasta napoli').prodotto, 'pasta_riso')
  assert.equal(interpreta('pesce').prodotto, 'carne_pesce')
  assert.equal(interpreta('alimentari al vomero').mondo, 'spesa')
  assert.deepEqual(vista('via toledo 256 napoli'), { mondo: null, prodotto: null, parole: ['via', 'toledo', '256', 'napoli'], indirizzo: true })
})

test('Photon: nomi, indirizzi e niente distributori', () => {
  const luogo = (properties: object) => daPhoton({ geometry: { coordinates: [14.2, 40.8] }, properties })
  assert.deepEqual(luogo({ name: 'Ospedale Cardarelli', street: 'Via Antonio Cardarelli', housenumber: '9', city: 'Napoli', type: 'house' }),
    { nome: 'Ospedale Cardarelli', dettaglio: 'Via Antonio Cardarelli 9, Napoli', lat: 40.8, lon: 14.2, zoom: 17 })
  assert.equal(luogo({ street: 'Via Toledo', housenumber: '256', city: 'Napoli', type: 'house' })?.nome, 'Via Toledo 256')
  assert.equal(luogo({ name: 'Q8', osm_value: 'fuel' }), null)
})

test('Photon riceve il testo e una zona di circa 10 km, non la posizione', () => {
  const url = urlPhoton('via toledo', { lat: 40.845678, lon: 14.251234 })
  assert.equal(url.searchParams.get('q'), 'via toledo')
  assert.equal(url.searchParams.get('lat'), '40.8')
  assert.equal(url.searchParams.get('lon'), '14.3')
})

const attivo = process.env.PGDATABASE?.endsWith('_test') ?? false
const NAPOLI = { lat: 40.85, lon: 14.27 }

describe('ricerca nel database', { skip: !attivo && 'serve PGDATABASE che finisca con _test' }, () => {
  before(async () => {
    await migra(pool)
    await sql`truncate punti, dispositivi, segnalazioni, voti, code, viste, anomalie, correzioni restart identity cascade`.execute(db)
    const punto = (nome: string, marchio: string | null, indirizzo: string, comune: string, lat: number, lon: number) => sql`
      insert into punti (nome, marchio, indirizzo, comune, provincia, geom, prodotti, fonte, id_fonte)
      values (${nome}, ${marchio}, ${indirizzo}, ${comune}, 'NA', ST_MakePoint(${lon}, ${lat})::geography, '{benzina}', 'test', ${nome + comune})`.execute(db)
    await punto('Eni', null, 'Via Domitiana', 'Pozzuoli', 40.82, 14.12)
    await punto('Energas', null, 'Via Marina', 'Napoli', 40.84, 14.27)
    await punto('Q8', null, 'Corso Umberto', "Cava De' Tirreni", 40.70, 14.70)
    await punto('Eni', null, 'Viale Europa', 'Bari', 41.10, 16.87)
  })
  after(() => db.destroy())

  const nomi = async (q: string) => (await cercaDistributori(interpreta(q), NAPOLI, 'distributore')).map((r) => `${r.punto.nome} ${r.punto.comune}`)
  const comuni = async (q: string) => (await cercaComuni(interpreta(q), NAPOLI)).map((c) => c.nome)

  test('errori di battitura e parole combinate', async () => {
    assert.deepEqual(await nomi('pozzoli'), ['Eni Pozzuoli'])
    assert.deepEqual(await nomi('eni pozzuoli'), ['Eni Pozzuoli'])
    assert.deepEqual(await nomi('cava de tirreni'), ["Q8 Cava De' Tirreni"])
  })

  test('i marchi corti non si confondono e i più vicini vengono prima', async () => {
    assert.deepEqual(await nomi('eni'), ['Eni Pozzuoli', 'Eni Bari'])
    assert.deepEqual(await nomi('q8'), ["Q8 Cava De' Tirreni"])
  })

  test('comuni mentre si scrive, dentro una frase, e niente somiglianze a caso', async () => {
    assert.equal((await comuni('pozz'))[0], 'Pozzuoli')
    assert.equal((await comuni('pozzoli'))[0], 'Pozzuoli')
    assert.equal((await comuni('eni pozzuoli'))[0], 'Pozzuoli')
    assert.equal((await comuni('napli'))[0], 'Napoli')
    assert.equal((await comuni('q8 cava'))[0], "Cava De' Tirreni")
    assert.deepEqual(await comuni('via marina 12 napoli'), ['Napoli'])
    assert.deepEqual(await comuni('ospedale cardarelli'), [])
    assert.deepEqual(await comuni('via cava 3 napoli'), ['Napoli']) // indirizzo: conta solo il comune scritto per intero, non Cava De' Tirreni
  })

  test('parole d’intento e carburanti', async () => {
    assert.deepEqual(await nomi('benzinaio pozzuoli'), ['Eni Pozzuoli'])
    assert.equal((await nomi('benzinaio')).length, 4) // solo l'intento: i più vicini
    assert.equal((await nomi('benzinaio'))[0], 'Energas Napoli')
    assert.deepEqual(await nomi('gpl napoli'), []) // a Napoli c'è solo benzina
  })
})
