// Un file PDF con una pagina per ogni immagine JPEG, scritto a mano: il formato per sole immagini è poche righe,
// e così il bollettino si scarica come file vero su telefono e computer senza una libreria (CLAUDE.md).
// ponytail: il testo è dentro l'immagine, quindi non si seleziona; per il testo da copiare c'è il pulsante «Testo».

export interface PaginaJpeg {
  jpeg: Uint8Array
  larghezza: number // pixel dell'immagine
  altezza: number
}

const A4: [number, number] = [595.28, 841.89] // punti tipografici
const byte = (s: string) => new TextEncoder().encode(s)
// Titolo in UTF-16 con il BOM: accenti e lineette senza problemi di codifica.
const utf16 = (s: string) => 'FEFF' + [...Array(s.length).keys()].map((i) => s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')).join('')

export function pdfDaJpeg(pagine: PaginaJpeg[], titolo: string, [l, a] = A4): Uint8Array {
  const pezzi: Uint8Array[] = []
  const inizi: number[] = [] // dove comincia ogni oggetto: serve alla tabella xref
  let lunghezza = 0
  const aggiungi = (p: string | Uint8Array) => {
    const b = typeof p === 'string' ? byte(p) : p
    pezzi.push(b)
    lunghezza += b.length
  }
  const oggetto = (n: number, ...corpo: (string | Uint8Array)[]) => {
    inizi[n] = lunghezza
    aggiungi(`${n} 0 obj\n`)
    corpo.forEach(aggiungi)
    aggiungi('\nendobj\n')
  }

  aggiungi('%PDF-1.4\n%âãÏÓ\n') // il commento con byte alti dice ai programmi che il file è binario
  // 1 catalogo, 2 elenco delle pagine, 3 informazioni; poi, per ogni pagina: pagina, immagine, disegno.
  oggetto(1, '<< /Type /Catalog /Pages 2 0 R >>')
  oggetto(2, `<< /Type /Pages /Kids [${pagine.map((_, i) => `${4 + i * 3} 0 R`).join(' ')}] /Count ${pagine.length} >>`)
  oggetto(3, `<< /Title <${utf16(titolo)}> /Producer (Scorty) >>`)
  pagine.forEach((p, i) => {
    const n = 4 + i * 3
    oggetto(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${l} ${a}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`)
    oggetto(
      n + 1,
      `<< /Type /XObject /Subtype /Image /Width ${p.larghezza} /Height ${p.altezza} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    )
    const disegno = `q ${l} 0 0 ${a} 0 0 cm /Im0 Do Q` // l'immagine occupa tutta la pagina
    oggetto(n + 2, `<< /Length ${disegno.length} >>\nstream\n${disegno}\nendstream`)
  })

  const xref = lunghezza
  const totale = 4 + pagine.length * 3
  aggiungi(`xref\n0 ${totale}\n0000000000 65535 f \n${inizi.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`)
  aggiungi(`trailer\n<< /Size ${totale} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const pdf = new Uint8Array(lunghezza)
  let i = 0
  for (const p of pezzi) pdf.set(p, (i += p.length) - p.length)
  return pdf
}
