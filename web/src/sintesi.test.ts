import assert from 'node:assert/strict'
import { test } from 'node:test'
import { anello, breve, categoria, geojson, riepilogo, vende, type PuntoMappa } from './sintesi.ts'
import { TUTTI_I_PRODOTTI, type StatoProdotto, type StatoPunto } from './tipi.ts'

const ORA = Date.parse('2026-10-22T12:00:00Z')
const riga = (r: Partial<StatoProdotto>): StatoProdotto => ({
  prodotto: 'gasolio', stato: 'disponibile', affidabilita: 'affidabile', persone: 2, smentite: 0,
  ultimo: new Date(ORA - 600_000).toISOString(), segnalazione_id: 1, ...r,
})
const stato = (punto_id: number, prodotti: StatoProdotto[]): StatoPunto => ({ punto_id, prodotti, tipo: 'distributore', coda: null, interesse: 0, arrivi: 0, arrivi_per: {}, stima: { coda_in_aumento: false, potrebbe_finire: [] }, calcolato_il: ORA })

// Benzina e gasolio = 1 | 2; con GPL anche 4.
const punti: PuntoMappa[] = [[1, 40.85, 14.27, 3], [2, 40.86, 14.28, 7], [3, 41.12, 16.87, 3], [4, 40.9, 14.3, 3]]
const stati = new Map([
  [1, stato(1, [riga({})])],
  [2, stato(2, [riga({ prodotto: 'gpl', stato: 'esaurito' })])],
  [3, stato(3, [riga({ stato: 'scarso' })])],
  [4, stato(4, [riga({ affidabilita: 'incerto' })])],
])

test('la maschera dei carburanti segue l’ordine di PRODOTTI', () => {
  assert.equal(vende(3, 'benzina'), true)
  assert.equal(vende(3, 'gasolio'), true)
  assert.equal(vende(3, 'gpl'), false)
  assert.equal(vende(7, 'gpl'), true)
  assert.equal(vende(7, 'metano'), false)
})

test('la maschera copre anche i beni della spesa, dopo i carburanti', () => {
  assert.equal(vende(1 << 5, 'latte'), true)
  assert.equal(vende(1 << 5, 'acqua'), false)
  assert.equal(vende(1 << 10, 'neonati'), true)
  assert.deepEqual(TUTTI_I_PRODOTTI, ['benzina', 'gasolio', 'gpl', 'metano', 'acqua', 'latte', 'pane', 'frutta_verdura', 'pasta_riso', 'carne_pesce', 'neonati'])
})

test('categoria: niente notizie, colori del filtro, contrastanti', () => {
  assert.equal(categoria(undefined, null, ORA), null)
  assert.equal(categoria(stato(9, []), null, ORA), null)
  assert.equal(categoria(stati.get(1), null, ORA), 'verde')
  assert.equal(categoria(stati.get(3), null, ORA), 'giallo')
  assert.equal(categoria(stati.get(2), 'gpl', ORA), 'rosso')
  assert.equal(categoria(stati.get(2), 'gasolio', ORA), null) // nessuna notizia sul gasolio
  assert.equal(categoria(stati.get(4), null, ORA), 'incerto')
})

test('geojson: un punto per distributore, solo quelli che vendono il carburante filtrato', () => {
  const tutti = geojson(punti, stati, null, ORA)
  assert.equal(tutti.features.length, 4)
  assert.deepEqual(tutti.features[0].geometry.coordinates, [14.27, 40.85]) // lon, lat
  assert.deepEqual(tutti.features[0].properties, { id: 1, v: 1, g: 0, r: 0, i: 0 })
  assert.deepEqual(tutti.features[3].properties, { id: 4, v: 0, g: 0, r: 0, i: 1 })

  const gpl = geojson(punti, stati, 'gpl', ORA)
  assert.deepEqual(gpl.features.map((f) => f.properties), [{ id: 2, v: 0, g: 0, r: 1, i: 0 }])
})

test('riepilogo: conta solo i distributori dentro la zona visibile', () => {
  const napoli: [number, number, number, number] = [14.0, 40.7, 14.5, 41.0] // ovest, sud, est, nord
  // Senza filtro il 2 è rosso, come il suo spillo: ha il GPL finito.
  assert.deepEqual(riepilogo(punti, stati, null, napoli, ORA), { distributori: 3, verde: 1, giallo: 0, rosso: 1, incerto: 1 })
  assert.deepEqual(riepilogo(punti, stati, 'gpl', napoli, ORA), { distributori: 1, verde: 0, giallo: 0, rosso: 1, incerto: 0 })
})

test('numeri brevi per la barra: le migliaia con una cifra decimale', () => {
  assert.equal(breve(7), '7')
  assert.equal(breve(999), '999')
  assert.equal(breve(1234), '1,2k')
  assert.equal(breve(6047), '6k')
})

test('anello: settori proporzionali, vuoto senza notizie', () => {
  assert.equal(anello({ v: 0, g: 0, r: 0, i: 0 }), null)
  assert.equal(anello({ v: 2, g: 0, r: 0, i: 0 }), 'conic-gradient(#16a34a 0% 100%)')
  assert.equal(anello({ v: 1, g: 1, r: 2, i: 0 }), 'conic-gradient(#16a34a 0% 25%, #d97706 25% 50%, #dc2626 50% 100%)')
})
