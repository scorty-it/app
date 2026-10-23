import assert from 'node:assert/strict'
import { test } from 'node:test'
import { correzione, formato, matriceQr } from './qr.ts'

test('QR: codici di correzione Reed-Solomon (esempio «HELLO WORLD», versione 1-M)', () => {
  const dati = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
  assert.deepEqual(correzione(dati, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
})

test('QR: informazioni di formato per la correzione M, come nella tabella della norma', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((m) => formato(m).toString(2).padStart(15, '0')), [
    '101010000010010', '101000100100101', '101111001111100', '101101101001011',
    '100010111111001', '100000011001110', '100111110010111', '100101010100000',
  ])
})

// Generata da un codificatore indipendente con le stesse impostazioni (versione 3, correzione M): ha scelto la maschera 6.
const SALERNO = [
  '#######.#....###..#...#######',
  '#.....#.#.##.###..###.#.....#',
  '#.###.#.##...##.....#.#.###.#',
  '#.###.#...###.##.#....#.###.#',
  '#.###.#.#.#.##.#..##..#.###.#',
  '#.....#...#.###.....#.#.....#',
  '#######.#.#.#.#.#.#.#.#######',
  '..........##..#...#..........',
  '#..######.#.######...#..#.###',
  '....##.#.##...#...##.#.##.##.',
  '.###..#######.#...#.#..#..#..',
  '...##...##.#..##.#.#..####..#',
  '##....#.##.#.##....#..#.....#',
  '.#.#.#.#.##.#.....#..########',
  '.####.#.#.###.##...#.#.#..#.#',
  '#.#....##.#.###.#...####..#.#',
  '.##...#.##.##..#..#..#.#.#...',
  '##.###.....##.....###...#.##.',
  '####.####.#..##.#..#.....#..#',
  '###..#..##.###.##.....#.###..',
  '##..#.####.###......########.',
  '........##.#.#..#...#...##...',
  '#######.##.###.##.###.#.##...',
  '#.....#.####.#..##..#...#..##',
  '#.###.#.#...##.###.#######...',
  '#.###.#.###..##.#.####.....#.',
  '#.###.#...#.##..#.#..#.##.###',
  '#.....#..##....#...#...#.##.#',
  '#######.#..#..#..####..###...',
]

test('QR: la matrice del link di una provincia, modulo per modulo, con la maschera migliore', () => {
  const m = matriceQr('https://scorty.it/province/SA')!
  assert.deepEqual(m.map((r) => r.map((x) => (x ? '#' : '.')).join('')), SALERNO)
})

test('QR: fino a 42 byte; oltre, niente QR', () => {
  assert.equal(matriceQr('x'.repeat(42))?.length, 29)
  assert.equal(matriceQr('x'.repeat(43)), null)
  assert.equal(matriceQr('è'.repeat(22)), null) // 44 byte in UTF-8
})
