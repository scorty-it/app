import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filtroValido, mondoIniziale, passaggioMondo } from './mondo.ts'

test('mondoIniziale: il link vince sulla scelta salvata, poi il salvato, poi il carburante', () => {
  assert.equal(mondoIniziale('?mondo=spesa', 'carburante'), 'spesa')
  assert.equal(mondoIniziale('?mondo=carburante', 'spesa'), 'carburante')
  assert.equal(mondoIniziale('', 'spesa'), 'spesa')
  assert.equal(mondoIniziale('?mondo=xyz', null), 'carburante')
  assert.equal(mondoIniziale('?mondo=xyz', 'spesa'), 'spesa')
  assert.equal(mondoIniziale('', null), 'carburante')
  assert.equal(mondoIniziale('', 'boh'), 'carburante')
})

test('filtroValido: il filtro resta solo se appartiene al mondo', () => {
  assert.equal(filtroValido('gpl', 'spesa'), null)
  assert.equal(filtroValido('latte', 'spesa'), 'latte')
  assert.equal(filtroValido('latte', 'carburante'), null)
  assert.equal(filtroValido('gpl', 'carburante'), 'gpl')
  assert.equal(filtroValido(null, 'spesa'), null)
})

test('passaggioMondo: il mondo della scelta e il prodotto della frase', () => {
  // «latte vomero» già in Spesa: resta in Spesa, ma si filtra Latte
  assert.deepEqual(passaggioMondo('spesa', 'negozio', 'latte'), { mondo: 'spesa', filtro: 'latte' })
  // da Carburante passa a Spesa e filtra Latte
  assert.deepEqual(passaggioMondo('carburante', 'negozio', 'latte'), { mondo: 'spesa', filtro: 'latte' })
  // un prodotto dell'altro mondo non vale
  assert.deepEqual(passaggioMondo('carburante', 'negozio', 'gpl'), { mondo: 'spesa', filtro: null })
  // un recente distributore aperto in Spesa riporta a Carburante
  assert.deepEqual(passaggioMondo('spesa', 'distributore', null), { mondo: 'carburante', filtro: null })
  // niente da cambiare
  assert.equal(passaggioMondo('spesa', 'negozio', null), null)
  assert.equal(passaggioMondo('carburante', 'distributore', null), null)
})
