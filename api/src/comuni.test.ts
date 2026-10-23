import assert from 'node:assert/strict'
import { test } from 'node:test'
import { comuneUfficiale, comuniIgnoti, regioneDi } from './comuni.ts'

test('la regione di una provincia, dall’elenco ISTAT', () => {
  assert.equal(regioneDi('SA'), 'Campania')
  assert.equal(regioneDi('BT'), 'Puglia')
  assert.equal(regioneDi('ZZ'), null)
})

test('comune ufficiale: un comune fuso diventa quello di oggi', () => {
  assert.equal(comuneUfficiale('Rossano', 'CS'), 'Corigliano-Rossano')
  assert.equal(comuneUfficiale('Corigliano Calabro', 'CS'), 'Corigliano-Rossano')
  assert.equal(comuneUfficiale('PRESICCE', 'LE'), 'Presicce-Acquarica')
  assert.equal(comuneUfficiale('Capaccio', 'SA'), 'Capaccio Paestum') // cambiato nome nel 2016
})

test('comune ufficiale: scritto come lo scrive l’ISTAT', () => {
  assert.equal(comuneUfficiale("Pomigliano D'Arco", 'NA'), "Pomigliano d'Arco")
  assert.equal(comuneUfficiale('Trentola-Ducenta', 'CE'), 'Trentola Ducenta')
  assert.equal(comuneUfficiale("Canicatti'", 'AG'), 'Canicattì')
  assert.equal(comuneUfficiale('Montebello Ionico', 'RC'), 'Montebello Jonico') // «j» vale «i»
})

test('comune ufficiale: conta la provincia; se non si riconosce, niente', () => {
  assert.equal(comuneUfficiale("Corigliano D'Otranto", 'LE'), "Corigliano d'Otranto")
  assert.equal(comuneUfficiale('Rossano', 'LE'), null)
  assert.equal(comuneUfficiale('Paperopoli', 'NA'), null)
  assert.equal(comuneUfficiale('Napoli', null), null)
  assert.equal(comuneUfficiale(null, 'NA'), null)
})

test('comuni non riconosciuti, una volta sola ciascuno, per il log dell’import', () => {
  assert.deepEqual(comuniIgnoti([
    { comune: 'Paperopoli', provincia: 'NA' }, { comune: 'Paperopoli', provincia: 'NA' }, { comune: 'Napoli', provincia: 'NA' },
    { comune: null, provincia: null }, { comune: 'Topolinia', provincia: 'SA' },
  ]), ['Paperopoli (NA)', 'Topolinia (SA)'])
})
