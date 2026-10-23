import assert from 'node:assert/strict'
import { test } from 'node:test'
import { barreAndamento, conGrafico, fraseAndamento } from './andamento.ts'
import type { BollettinoProvincia, ComuneBollettino } from './dati.ts'

const ADESSO = '2026-10-22T15:40:00Z' // le 17:40 in Italia
const ORA = Date.parse('2026-10-22T15:00:00Z') // l'ora piena in corso

// Un bollettino con `adesso` comuni senza carburante e le fotografie di `ore` ore fa: [ore fa, comuni senza carburante].
function bollettino(adesso: number, fotografie?: [number, number][]): BollettinoProvincia {
  const comune = (i: number): ComuneBollettino => ({
    comune: `C${i}`, distributori: 1, verde: 0, giallo: 0, rosso: 1, ultima: null, lat: 40, lon: 14, gruppo: 'senza_carburante', confermato: false,
  })
  return {
    provincia: 'SA', aggiornato_il: ADESSO, distributori: 10, verde: 0, giallo: 0, rosso: adesso, lat: 40, lon: 14,
    comuni: Array.from({ length: adesso }, (_, i) => comune(i)),
    andamento: fotografie?.map(([oreFa, n]) => ({
      ora: new Date(ORA - oreFa * 3_600_000).toISOString(), comuni_senza: n, comuni_senza_confermati: 0, con_notizie: n, verde: 0, giallo: 0, rosso: n,
    })),
  }
}

test('andamento: 24 barre, una per ora; l’ultima è adesso, un’ora senza fotografia resta vuota', () => {
  const barre = barreAndamento(bollettino(4, [[23, 1], [2, 3], [0, 9]]))
  assert.equal(barre.length, 24)
  assert.deepEqual(barre.map((b) => b.comuni).slice(-3), [3, null, 4]) // la fotografia di quest'ora la sostituisce adesso
  assert.equal(barre[0].comuni, 1)
  assert.equal(barre[0].ora, '2026-10-21T16:00:00.000Z')
})

test('andamento: adesso contro 6 ore prima', () => {
  assert.equal(fraseAndamento(bollettino(4, [[6, 1]])), 'In peggioramento: 4 comuni senza carburante, alle 11:00 era 1')
  assert.equal(fraseAndamento(bollettino(2, [[6, 0]])), 'In peggioramento: 2 comuni senza carburante, alle 11:00 nessuno')
  assert.equal(fraseAndamento(bollettino(3, [[6, 3]])), 'Stabile: 3 comuni senza carburante, come alle 11:00')
  assert.equal(fraseAndamento(bollettino(0, [[6, 2]])), 'In miglioramento: nessun comune senza carburante, alle 11:00 erano 2')
})

test('andamento: se manca la fotografia di 6 ore fa vale quella prima', () => {
  assert.equal(fraseAndamento(bollettino(1, [[7, 4], [3, 2]])), 'In miglioramento: 1 comune senza carburante, alle 10:00 erano 4')
})

test('andamento: con meno di 6 ore di storia niente frase, ma il grafico sì', () => {
  const b = bollettino(3, [[2, 1]])
  assert.equal(fraseAndamento(b), null)
  assert.equal(conGrafico(b), true)
})

test('andamento: mai un comune senza carburante, solo la frase', () => {
  const giorno = bollettino(0, [[23, 0], [6, 0]])
  assert.equal(fraseAndamento(giorno), 'Nessun comune senza carburante nelle ultime 24 ore')
  assert.equal(conGrafico(giorno), false)
  // Storia più corta di un giorno: si dice da quando.
  assert.equal(fraseAndamento(bollettino(0, [[10, 0], [6, 0]])), 'Nessun comune senza carburante dalle 07:00')
})

test('andamento: senza fotografie (server non ancora aggiornato) niente frase e niente grafico', () => {
  assert.equal(fraseAndamento(bollettino(2)), null)
  assert.equal(conGrafico(bollettino(2)), false)
  assert.equal(conGrafico(bollettino(2, [])), false)
})
