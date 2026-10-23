import assert from 'node:assert/strict'
import { test } from 'node:test'
import { corpoVisita } from './visita.ts'

test('senza scelte e senza coda non c’è niente da inviare', () => {
  assert.equal(corpoVisita({}, null), null)
})

test('una sola categoria, senza coda', () => {
  assert.deepEqual(corpoVisita({ latte: 'scarso' }, null), { risposte: [{ prodotto: 'latte', stato: 'scarso' }] })
})

test('solo la coda: risposte vuote', () => {
  assert.deepEqual(corpoVisita({}, 'breve'), { risposte: [], coda: 'breve' })
})

test('le risposte seguono l’ordine delle categorie, non quello delle scelte', () => {
  const corpo = corpoVisita({ neonati: 'esaurito', pane: 'disponibile', acqua: 'scarso' }, 'lunga')
  assert.deepEqual(corpo, {
    risposte: [
      { prodotto: 'acqua', stato: 'scarso' },
      { prodotto: 'pane', stato: 'disponibile' },
      { prodotto: 'neonati', stato: 'esaurito' },
    ],
    coda: 'lunga',
  })
})
