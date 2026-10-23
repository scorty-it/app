import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pdfDaJpeg } from './pdf.ts'

// Non serve una JPEG vera: il PDF la copia così com'è, e il lettore la decodifica.
const finta = (n: number, byte: number) => new Uint8Array(n).fill(byte)
const testo = (u8: Uint8Array) => Buffer.from(u8).toString('latin1')

test('un PDF valido: intestazione, una pagina A4 per immagine, fine file', () => {
  const pdf = testo(pdfDaJpeg([{ jpeg: finta(10, 0xff), larghezza: 1488, altezza: 2105 }, { jpeg: finta(7, 0xd8), larghezza: 1488, altezza: 2105 }], 'Bollettino'))
  assert.ok(pdf.startsWith('%PDF-1.4\n'))
  assert.ok(pdf.endsWith('%%EOF\n'))
  assert.match(pdf, /\/Type \/Pages \/Kids \[4 0 R 7 0 R\] \/Count 2/)
  assert.equal(pdf.match(/\/MediaBox \[0 0 595\.28 841\.89\]/g)?.length, 2)
  assert.match(pdf, /\/Width 1488 \/Height 2105 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 10 >>\nstream\n\xff{10}\nendstream/)
})

test('la tabella xref punta all’inizio di ogni oggetto e startxref alla tabella', () => {
  const pdf = testo(pdfDaJpeg([{ jpeg: finta(5, 1), larghezza: 2, altezza: 3 }], 'x'))
  const xref = pdf.indexOf('\nxref\n') + 1 // non quello dentro «startxref»
  assert.equal(Number(pdf.match(/startxref\n(\d+)\n/)![1]), xref)
  const voci = pdf.slice(xref).split('\n').slice(3).filter((r) => / n $/.test(r))
  assert.equal(voci.length, 6) // catalogo, pagine, informazioni, pagina, immagine, disegno
  voci.forEach((r, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj\n`, Number(r.slice(0, 10)))))
  assert.ok(voci.every((r) => r.length + 1 === 20)) // ogni voce è lunga esattamente 20 byte
})

test('il titolo del documento con accenti e lineette (UTF-16)', () => {
  const pdf = testo(pdfDaJpeg([{ jpeg: finta(1, 0), larghezza: 1, altezza: 1 }], 'Città – SA'))
  assert.match(pdf, /\/Title <FEFF004300690074007400E000202013002000530041>/)
})
