import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confiniCoperti, leggiDbf, leggiShp } from './confini.ts'

type Anello = [number, number][]

// Un .dbf minimo: intestazione di 32 byte, un descrittore da 32 byte per campo, 0x0D, poi i record
// (un byte di cancellazione e i campi a larghezza fissa, riempiti di spazi: la larghezza è in byte, non in lettere).
function dbf(campi: [string, number][], righe: string[][]) {
  const lunghezzaRecord = 1 + campi.reduce((n, [, larghezza]) => n + larghezza, 0)
  const lunghezzaTesta = 32 + 32 * campi.length + 1
  const dati = new Uint8Array(lunghezzaTesta + righe.length * lunghezzaRecord)
  const vista = new DataView(dati.buffer)
  dati[0] = 0x03
  vista.setUint32(4, righe.length, true)
  vista.setUint16(8, lunghezzaTesta, true)
  vista.setUint16(10, lunghezzaRecord, true)
  campi.forEach(([nome, larghezza], i) => {
    dati.set(new TextEncoder().encode(nome), 32 + 32 * i)
    dati[32 + 32 * i + 11] = 'C'.charCodeAt(0)
    dati[32 + 32 * i + 16] = larghezza
  })
  dati[lunghezzaTesta - 1] = 0x0d
  righe.forEach((riga, r) => {
    let p = lunghezzaTesta + r * lunghezzaRecord
    dati[p++] = 0x20
    campi.forEach(([, larghezza], i) => {
      const campo = new Uint8Array(larghezza).fill(0x20)
      campo.set(new TextEncoder().encode(riga[i]))
      dati.set(campo, p)
      p += larghezza
    })
  })
  return dati
}

// Uno .shp minimo di soli poligoni (tipo 5): intestazione di 100 byte, poi per ogni record l'intestazione
// big-endian (numero, lunghezza in parole da 16 bit) e il contenuto little-endian.
function shp(record: Anello[][]) {
  const contenuti = record.map((anelli) => {
    const punti = anelli.flat()
    const c = new Uint8Array(44 + 4 * anelli.length + 16 * punti.length)
    const v = new DataView(c.buffer)
    v.setInt32(0, 5, true)
    v.setInt32(36, anelli.length, true)
    v.setInt32(40, punti.length, true)
    let inizio = 0
    anelli.forEach((anello, i) => {
      v.setInt32(44 + 4 * i, inizio, true)
      inizio += anello.length
    })
    punti.forEach(([x, y], i) => {
      v.setFloat64(44 + 4 * anelli.length + 16 * i, x, true)
      v.setFloat64(52 + 4 * anelli.length + 16 * i, y, true)
    })
    return c
  })
  const dati = new Uint8Array(100 + contenuti.reduce((n, c) => n + 8 + c.length, 0))
  const vista = new DataView(dati.buffer)
  vista.setInt32(0, 9994)
  vista.setInt32(24, dati.length / 2)
  vista.setInt32(28, 1000, true)
  vista.setInt32(32, 5, true)
  let p = 100
  contenuti.forEach((c, i) => {
    vista.setInt32(p, i + 1)
    vista.setInt32(p + 4, c.length / 2)
    dati.set(c, p + 8)
    p += 8 + c.length
  })
  return dati
}

test('confini: il dbf si legge per nome di campo, in UTF-8 e senza spazi', () => {
  const righe = leggiDbf(dbf([['COMUNE', 20], ['SIGLA', 2]], [['Agliè', 'TO'], ['Cava de\' Tirreni', 'SA']]))
  assert.deepEqual(righe, [{ COMUNE: 'Agliè', SIGLA: 'TO' }, { COMUNE: 'Cava de\' Tirreni', SIGLA: 'SA' }])
})
test('confini: lo shp dà gli anelli di ogni poligono', () => {
  const esterno: [number, number][] = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]
  const buco: [number, number][] = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]
  assert.deepEqual(leggiShp(shp([[esterno, buco]])), [[esterno, buco]])
})
test('confini: solo le regioni coperte, con la sigla della provincia e i metri interi', () => {
  const comuni = [{ COD_REG: '15', COD_UTS: '63', PRO_COM_T: '063049', COMUNE: 'Napoli' }, { COD_REG: '1', COD_UTS: '201', PRO_COM_T: '001001', COMUNE: 'Agliè' }]
  const province = [{ COD_UTS: '63', SIGLA: 'NA' }, { COD_UTS: '201', SIGLA: 'TO' }]
  const forme: [number, number][][][] = [[[[1.4, 2.6], [3, 4], [1.4, 2.6]]], [[[0, 0], [1, 1], [0, 0]]]]
  assert.deepEqual(confiniCoperti(comuni, province, forme, ['15']),
    [{ codice: '063049', comune: 'Napoli', provincia: 'NA', anelli: [[[1, 3], [3, 4], [1, 3]]] }])
})

// I file scaricati sono dati non fidati: se non tornano i conti ci si ferma, senza leggere oltre la fine.
test('confini: un dbf o uno shp troncati fanno fermare la lettura', () => {
  const file = dbf([['COMUNE', 20]], [['Agliè'], ['Napoli']])
  assert.throws(() => leggiDbf(file.slice(0, file.length - 5)), /dbf/)
  const forma = shp([[[[0, 0], [0, 10], [10, 10], [0, 0]]]])
  assert.throws(() => leggiShp(forma.slice(0, forma.length - 8)), /shp/)
})
test('confini: comuni e forme non allineati, o provincia sconosciuta, fanno fermare la lettura', () => {
  const comuni = [{ COD_REG: '15', COD_UTS: '63', PRO_COM_T: '063049', COMUNE: 'Napoli' }]
  const forme: [number, number][][][] = [[[[0, 0], [1, 1], [0, 0]]]]
  assert.throws(() => confiniCoperti(comuni, [{ COD_UTS: '63', SIGLA: 'NA' }], [], ['15']), /forme/)
  assert.throws(() => confiniCoperti(comuni, [{ COD_UTS: '201', SIGLA: 'TO' }], forme, ['15']), /provincia/)
})
