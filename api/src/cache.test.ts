import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inCache } from './cache.ts'

test('chi arriva durante il calcolo aspetta lo stesso risultato: si calcola una volta sola', async () => {
  let calcoli = 0
  const cache = inCache<number>(60_000)
  const calcola = async () => (await new Promise((r) => setTimeout(r, 10)), ++calcoli)
  assert.deepEqual(await Promise.all([cache('SA', calcola), cache('SA', calcola), cache('SA', calcola)]), [1, 1, 1])
  assert.equal(calcoli, 1)
})

test('dopo il tempo indicato si ricalcola; chiavi diverse non si mescolano', async () => {
  let ora = 0
  let calcoli = 0
  const cache = inCache<number>(60_000, () => ora)
  const calcola = async () => ++calcoli
  assert.equal(await cache('SA', calcola), 1)
  ora = 59_999
  assert.equal(await cache('SA', calcola), 1)
  ora = 60_001
  assert.equal(await cache('SA', calcola), 2)
  assert.equal(await cache('NA', calcola), 3)
})

test('un errore non resta in cache', async () => {
  const cache = inCache<number>(60_000)
  await assert.rejects(cache('ZZ', async () => { throw new Error('no') }))
  assert.equal(await cache('ZZ', async () => 7), 7)
})
