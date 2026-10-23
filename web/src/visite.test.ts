import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MiaSegnalazione, Punto } from './tipi.ts'
import { ciVadoSuperstite, raggruppa } from './visite.ts'

const punto = (id: number): Punto => ({ id, tipo: 'distributore', nome: `D${id}`, marchio: null, indirizzo: null, comune: null, lat: 40, lon: 14, prodotti: ['benzina', 'gasolio'] })
const alle = (minuti: number) => new Date(Date.UTC(2026, 9, 22, 10, minuti)).toISOString()
let id = 1
const mia = (p: number, prodotto: 'benzina' | 'gasolio', stato: 'disponibile' | 'esaurito', minuti: number): MiaSegnalazione => ({
  id: id++, punto: punto(p), prodotto, stato, creata_il: alle(minuti), visto_il: alle(minuti), a_distanza: false, viste: minuti,
})

test('stesso distributore entro un’ora: una visita; più tardi o altrove: visite diverse', () => {
  const v = raggruppa([mia(1, 'benzina', 'disponibile', 0), mia(1, 'gasolio', 'esaurito', 10), mia(1, 'benzina', 'esaurito', 90), mia(2, 'benzina', 'disponibile', 5)], [])
  assert.equal(v.length, 3)
  const prima = v.find((x) => x.punto.id === 1 && x.perProdotto.size === 2)!
  assert.equal(prima.perProdotto.get('gasolio')?.stato, 'esaurito')
  assert.equal(prima.viste, 10)
  assert.equal(v[0].creata_il, alle(90)) // la più recente in cima
})

test('la coda va alla visita in cui cade, e conta la più recente', () => {
  const v = raggruppa([mia(1, 'benzina', 'disponibile', 0)], [
    { punto_id: 1, livello: 'lunga', creata_il: alle(20) },
    { punto_id: 1, livello: 'breve', creata_il: alle(5) },
    { punto_id: 1, livello: 'nessuna', creata_il: alle(200) }, // un'altra visita, più tardi
  ])
  assert.equal(v[0].coda, 'lunga')
})

const ciVado = (p: number) => ({ punto: punto(p), prodotti: [], creato_il: alle(0) })

test('una segnalazione al punto del «Ci vado» lo chiude, come fa il server', () => {
  assert.equal(ciVadoSuperstite(ciVado(1), 1), null)
})

test('una segnalazione altrove lascia il «Ci vado» com\'è', () => {
  const c = ciVado(1)
  assert.equal(ciVadoSuperstite(c, 2), c)
  assert.equal(ciVadoSuperstite(null, 2), null)
})
