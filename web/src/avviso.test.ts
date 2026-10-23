import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fermoVicino, puntiDaAvvisare, type Campione } from './avviso.ts'
import type { Punto } from './tipi.ts'

const ORA = 1_000_000_000
const distributore = (id: number, lat: number, lon: number): Punto => ({ id, tipo: 'distributore', nome: `D${id}`, marchio: null, indirizzo: null, comune: null, lat, lon, prodotti: ['benzina'] })
const Q8 = distributore(1, 40.85, 14.27)
const ENI = distributore(2, 40.8507, 14.27) // circa 80 m più a nord
// Una posizione ogni 10 secondi negli ultimi `secondi`, spostata di `metri` verso nord a ogni passo
const campioni = (lat: number, secondi: number, metri = 0): Campione[] =>
  Array.from({ length: secondi / 10 + 1 }, (_, i) => ({ pos: { lat: lat + (i * metri) / 111_320, lon: 14.27 }, t: ORA - secondi * 1000 + i * 10_000 }))

test('fermo da più di un minuto a 50 m da un distributore: avviso', () => {
  assert.equal(fermoVicino(campioni(40.85045, 70), [Q8], ORA)?.id, 1)
})

test('fermo da troppo poco: niente avviso', () => {
  assert.equal(fermoVicino(campioni(40.85045, 30), [Q8], ORA), null)
})

test('in movimento, per esempio in coda che scorre o di passaggio: niente avviso', () => {
  assert.equal(fermoVicino(campioni(40.8496, 70, 15), [Q8], ORA), null)
})

test('fermo ma lontano dal distributore: niente avviso', () => {
  assert.equal(fermoVicino(campioni(40.853, 70), [Q8], ORA), null)
})

test('con due distributori vicini si sceglie il più vicino', () => {
  assert.equal(fermoVicino(campioni(40.8505, 70), [Q8, ENI], ORA)?.id, 2)
})

const negozio = (id: number, lat: number, lon: number): Punto => ({ ...distributore(id, lat, lon), tipo: 'negozio', nome: `N${id}`, prodotti: ['acqua', 'latte'] })

test('senza «Ci vado» si avvisano solo i distributori', () => {
  assert.deepEqual(puntiDaAvvisare([Q8], null), [Q8])
})

test('con un «Ci vado» a un negozio, il negozio entra tra i punti da avvisare', () => {
  const coop = negozio(10, 40.85, 14.27)
  assert.deepEqual(puntiDaAvvisare([Q8], coop).map((p) => p.id), [1, 10])
})

test('il «Ci vado» a un distributore già in elenco non lo duplica', () => {
  assert.deepEqual(puntiDaAvvisare([Q8], Q8).map((p) => p.id), [1])
})

test('fermo vicino a un negozio senza «Ci vado»: niente avviso, un alimentari sotto casa non conta', () => {
  assert.equal(fermoVicino(campioni(40.85045, 70), puntiDaAvvisare([], null), ORA), null)
})

test('fermo vicino al negozio dove hai detto «Ci vado»: avviso', () => {
  const coop = negozio(10, 40.85, 14.27)
  assert.equal(fermoVicino(campioni(40.85045, 70), puntiDaAvvisare([], coop), ORA)?.id, 10)
})
