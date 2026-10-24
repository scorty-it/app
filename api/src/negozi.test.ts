import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { QUERY_NEGOZI, daOsmNegozio } from './negozi.ts'
import { BENI } from './prodotti.ts'

const nodo = (tags: Record<string, string>) => ({ type: 'node', id: 1, lat: 40.85, lon: 14.27, tags })

describe('negozi da OpenStreetMap', () => {
  test('la richiesta esclude i minimarket dei distributori (amenity=fuel)', () => {
    assert.ok(QUERY_NEGOZI.includes('["amenity"!="fuel"]'))
  })

  test('supermercato con marchio e senza nome: il nome è il marchio', () => {
    const n = daOsmNegozio(nodo({ shop: 'supermarket', brand: 'Conad' }))
    assert.equal(n?.nome, 'Conad')
    assert.equal(n?.marchio, null)
    assert.deepEqual(n?.prodotti, BENI)
    assert.equal(n?.id_fonte, 'node/1')
  })

  test('senza nome né marchio il nome dipende dal tipo di negozio', () => {
    assert.equal(daOsmNegozio(nodo({ shop: 'convenience' }))?.nome, 'Alimentari')
    assert.equal(daOsmNegozio(nodo({ shop: 'supermarket' }))?.nome, 'Supermercato')
  })

  test('senza indirizzo il campo è null; con indirizzo si compone la via. Comune e provincia non si leggono da OSM: li dà il confine', () => {
    const n = daOsmNegozio(nodo({ shop: 'supermarket' }))
    assert.deepEqual([n?.indirizzo, n?.comune, n?.provincia], [null, null, null])
    const c = daOsmNegozio(nodo({ shop: 'supermarket', name: 'Sole', brand: 'Conad', 'addr:street': 'Via Roma', 'addr:housenumber': '5', 'addr:city': 'Eboli', 'addr:province': 'SA' }))
    assert.deepEqual([c?.nome, c?.marchio, c?.indirizzo, c?.comune, c?.provincia], ['Sole', 'Conad', 'Via Roma 5', null, null])
  })

  test('un negozio dismesso si scarta', () => {
    assert.equal(daOsmNegozio(nodo({ shop: 'supermarket', disused: 'yes' })), null)
  })

  test('un way usa il centro', () => {
    const n = daOsmNegozio({ type: 'way', id: 7, center: { lat: 41, lon: 15 }, tags: { shop: 'supermarket' } })
    assert.deepEqual([n?.id_fonte, n?.lat, n?.lon], ['way/7', 41, 15])
  })
})
