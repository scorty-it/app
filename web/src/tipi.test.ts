import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BENI, NOME_PRODOTTO, PRODOTTI, nomeInFrase } from './tipi.ts'

test('nomi dei beni nelle frasi: «Senza neonati» si legge «senza bambini», quindi «prodotti per neonati»', () => {
  assert.equal(nomeInFrase('neonati'), 'prodotti per neonati')
  assert.equal(NOME_PRODOTTO.neonati, 'Neonati') // l'etichetta corta resta per i pulsanti e le righe del widget
})

test('nomi nelle frasi: minuscolo, con il GPL in maiuscolo', () => {
  assert.equal(nomeInFrase('gpl'), 'GPL')
  assert.deepEqual(
    [...PRODOTTI, ...BENI].filter((p) => p !== 'neonati').map(nomeInFrase),
    ['benzina', 'gasolio', 'GPL', 'metano', 'acqua', 'latte', 'pane', 'frutta e verdura', 'pasta e riso', 'carne e pesce'],
  )
})
