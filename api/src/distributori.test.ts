// Le conversioni girano sempre; il salvataggio solo su un database che finisce con "_test" (lo svuota).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { sql } from 'kysely'
import { db, pool } from './db.ts'
import { daMimit, daOsm, dividiIndirizzo, maiuscoleIniziali, marchioLeggibile, prezziMimit, salvaImpianti, type Impianto } from './distributori.ts'
import { migra } from './migra.ts'

test('Ministero: marchio, nome, indirizzo, comune e provincia', () => {
  const p = daMimit({
    id: 52966, name: 'Elle2Bi di Barbato Salvatore', brand: 'Api-Ip', address: " LOCALITA' CUGNO DELLE BRECCE NC 85100 - POTENZA PZ",
    location: { lat: 40.69, lng: 15.84 }, fuels: [{ fuelId: 1 }, { fuelId: 1 }, { fuelId: 2 }, { fuelId: 4 }],
  })!
  assert.equal(p.nome, 'IP')
  assert.equal(p.marchio, null)
  assert.equal(p.indirizzo, "Localita' Cugno delle Brecce")
  assert.equal(p.comune, 'Potenza')
  assert.equal(p.provincia, 'PZ')
  assert.deepEqual(p.prodotti, ['benzina', 'gasolio', 'gpl'])
  assert.equal(p.id_fonte, '52966')
  // Pompa bianca: il nome è quello del gestore
  const bianca = daMimit({ id: 1, name: 'UNOIL META', brand: 'PompeBianche', address: 'Corso Italia 150 80062 - META NA', location: { lat: 40.6, lng: 14.4 }, fuels: [{ fuelId: 2 }] })!
  assert.equal(bianca.nome, 'Unoil Meta')
  assert.equal(bianca.marchio, 'Pompa bianca')
  assert.equal(daMimit({ id: 2, name: 'x', brand: 'Q8', address: null, location: null, fuels: [{ fuelId: 1 }] }), null)
})

test('prezzi del Ministero: il più basso per carburante e modalità, senza valori assurdi', () => {
  assert.deepEqual(prezziMimit([
    { fuelId: 2, price: 1.899, isSelf: true }, { fuelId: 2, price: 1.959, isSelf: true }, // gasolio e gasolio "premium"
    { fuelId: 2, price: 2.099, isSelf: false }, { fuelId: 1, price: 0, isSelf: true }, { fuelId: 4, price: 0.799, isSelf: false },
    { fuelId: 323, price: 1.5, isSelf: true }, // carburante che non mostriamo
  ]), [
    { prodotto: 'gasolio', self: true, prezzo: 1.899 },
    { prodotto: 'gasolio', self: false, prezzo: 2.099 },
    { prodotto: 'gpl', self: false, prezzo: 0.799 },
  ])
})

test('nomi leggibili', () => {
  assert.equal(marchioLeggibile('AgipEni'), 'Eni')
  assert.equal(marchioLeggibile('ItalianaCarburanti'), 'Italiana Carburanti')
  assert.equal(marchioLeggibile('Q8'), 'Q8')
  assert.equal(marchioLeggibile('GBPetroli'), 'GB Petroli')
  assert.equal(marchioLeggibile('GT-FUEL'), 'GT-FUEL')
  assert.equal(maiuscoleIniziali('SANTA MARIA CAPUA VETERE'), 'Santa Maria Capua Vetere')
  assert.equal(maiuscoleIniziali('TRENTOLA-DUCENTA'), 'Trentola-Ducenta')
  assert.equal(maiuscoleIniziali('MARANO DI NAPOLI'), 'Marano di Napoli')
  assert.equal(maiuscoleIniziali('SS 18 KM 4'), 'SS 18 Km 4')
  assert.deepEqual(dividiIndirizzo('VIA G. LA PIRA SNC 81100 - CASERTA CE'), { indirizzo: 'Via G. La Pira', comune: 'Caserta', provincia: 'CE' })
  assert.deepEqual(dividiIndirizzo('VIA IRNO 212, 84135 - - SALERNO SA'), { indirizzo: 'Via Irno 212', comune: 'Salerno', provincia: 'SA' })
  assert.deepEqual(dividiIndirizzo('indirizzo strano'), { indirizzo: 'Indirizzo Strano', comune: null, provincia: null })
})

test('comuni con il trattino nel nome: si divide sull’ultimo « - », non su ogni trattino', () => {
  assert.deepEqual(dividiIndirizzo('VIA NAZIONALE 12 87064 - CORIGLIANO-ROSSANO CS'), { indirizzo: 'Via Nazionale 12', comune: 'Corigliano-Rossano', provincia: 'CS' })
  assert.deepEqual(dividiIndirizzo('VIA LUNGOMARE 5 98035 - GIARDINI-NAXOS ME'), { indirizzo: 'Via Lungomare 5', comune: 'Giardini-Naxos', provincia: 'ME' })
  assert.deepEqual(dividiIndirizzo('CORSO ITALIA 150 80062-META NA'), { indirizzo: 'Corso Italia 150', comune: 'Meta', provincia: 'NA' }) // senza spazi intorno
})

test('il comune è quello ufficiale di oggi, dal Ministero e da OpenStreetMap', () => {
  assert.equal(dividiIndirizzo('VIA NAZIONALE SNC 87064 - ROSSANO CS').comune, 'Corigliano-Rossano')
  assert.equal(dividiIndirizzo("VIA ROMA 1 80038 - POMIGLIANO D'ARCO NA").comune, "Pomigliano d'Arco")
  assert.equal(dividiIndirizzo('VIA ROMA 1 80100 - PAPEROPOLI NA').comune, 'Paperopoli') // sconosciuto: com'è scritto
  const osm = (tags: Record<string, string>) => daOsm({ type: 'node', id: 3, lat: 39.6, lon: 16.5, tags })!.comune
  assert.equal(osm({ 'addr:city': 'Rossano', 'addr:province': 'CS' }), 'Corigliano-Rossano')
  assert.equal(osm({ 'addr:city': 'Rossano' }), 'Rossano')
})

test('OpenStreetMap: prodotti, nome e marchio', () => {
  const p = daOsm({ type: 'node', id: 7, lat: 40.8, lon: 14.2, tags: { amenity: 'fuel', brand: 'Q8', 'fuel:lpg': 'yes', 'addr:street': 'Via Roma', 'addr:housenumber': '3' } })!
  assert.deepEqual(p.prodotti, ['benzina', 'gasolio', 'gpl'])
  assert.equal(p.nome, 'Q8')
  assert.equal(p.marchio, null) // uguale al nome: non si ripete
  assert.equal(p.indirizzo, 'Via Roma 3')
  assert.equal(p.id_fonte, 'node/7')
  // Le aree hanno il centro al posto delle coordinate
  assert.deepEqual(daOsm({ type: 'way', id: 9, center: { lat: 41, lon: 16 }, tags: { name: 'Stazione Sud', operator: 'Eni', 'fuel:diesel': 'no' } })?.prodotti, ['benzina'])
  assert.equal(daOsm({ type: 'node', id: 1, lat: 40, lon: 14, tags: { 'fuel:octane_95': 'no', 'fuel:diesel': 'no' } }), null)
  assert.equal(daOsm({ type: 'node', id: 2, lat: 40, lon: 14, tags: { disused: 'yes' } }), null)
})

const attivo = process.env.PGDATABASE?.endsWith('_test') ?? false
const impianto = (n: number): Impianto => ({
  id_fonte: `node/${n}`, nome: `D${n}`, marchio: null, indirizzo: null, comune: null, provincia: null, lat: 40 + n / 1000, lon: 14, prodotti: ['benzina'],
})

describe('salvataggio dei distributori', { skip: !attivo && 'serve PGDATABASE che finisca con _test' }, () => {
  before(async () => {
    await migra(pool)
    await sql`truncate punti, dispositivi, segnalazioni, voti, code, viste, anomalie, correzioni restart identity cascade`.execute(db)
  })
  after(() => db.destroy())

  const attivi = async (fonte: string) =>
    (await db.selectFrom('punti').select('id_fonte').where('fonte', '=', fonte).where('attivo', '=', true).orderBy('id_fonte').execute()).map((p) => p.id_fonte)

  test('aggiorna, disattiva gli spariti e sostituisce quelli della demo', async () => {
    await sql`insert into punti (nome, geom, prodotti, fonte, id_fonte) values ('demo', ST_MakePoint(14, 40)::geography, '{benzina}', 'osm-demo', '0')`.execute(db)
    assert.deepEqual(await salvaImpianti([1, 2, 3].map(impianto), 'osm'), { fonte: 'osm', importati: 3, disattivati: 0 })
    assert.deepEqual(await attivi('osm-demo'), [])
    assert.deepEqual(await salvaImpianti([1, 2, 4].map(impianto), 'osm'), { fonte: 'osm', importati: 3, disattivati: 1 })
    assert.deepEqual(await attivi('osm'), ['node/1', 'node/2', 'node/4'])
  })

  test('una risposta troppo corta viene scartata senza toccare niente', async () => {
    await assert.rejects(salvaImpianti([impianto(1)], 'osm'), /importazione scartata/)
    assert.deepEqual(await attivi('osm'), ['node/1', 'node/2', 'node/4'])
  })

  test('i prezzi si salvano e a ogni aggiornamento si sostituiscono', async () => {
    const conPrezzi = (n: number, prezzo: number): Impianto => ({ ...impianto(n), prezzi: [{ prodotto: 'benzina', self: true, prezzo }], prezzi_il: '2026-10-22T07:30:00+02:00' })
    await salvaImpianti([conPrezzi(7, 1.799), conPrezzi(8, 1.819)], 'mimit')
    await salvaImpianti([conPrezzi(7, 1.759), conPrezzi(8, 1.819)], 'mimit')
    const { rows } = await sql<{ id_fonte: string; prezzo: number; il: Date }>`
      select p.id_fonte, z.prezzo::float8 as prezzo, p.prezzi_comunicati_il as il from prezzi z join punti p on p.id = z.punto_id order by p.id_fonte
    `.execute(db)
    assert.deepEqual(rows.map((r) => [r.id_fonte, r.prezzo]), [['node/7', 1.759], ['node/8', 1.819]])
    assert.equal(rows[0].il.toISOString(), '2026-10-22T05:30:00.000Z')
  })

  test('i dati del Ministero sostituiscono quelli di OpenStreetMap', async () => {
    await salvaImpianti([5, 6].map(impianto), 'mimit')
    assert.deepEqual(await attivi('osm'), [])
    assert.deepEqual(await attivi('mimit'), ['node/5', 'node/6'])
  })
})
