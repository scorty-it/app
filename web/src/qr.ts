// QR code per il link del bollettino (bollettino-pdf.ts), senza librerie: solo quello che serve a un link corto.
// Modalità byte, versione 3 (29×29 moduli), correzione M (regge circa il 15% di danni), un solo blocco Reed-Solomon.
// Norma ISO/IEC 18004; la maschera si sceglie con le sue penalità, contate come nel codificatore di riferimento di Nayuki.
// ponytail: al massimo 42 byte, oltre niente QR (il PDF ha comunque il link scritto). Per testi più lunghi servono
// versioni più grandi, con più blocchi da intrecciare.

type Matrice = boolean[][] // [riga][colonna], vero = nero

const LATO = 29
const DATI = 44 // codici di dati della versione 3-M
const CORREZIONE = 26

// Aritmetica in GF(256) con il polinomio 0x11d della norma.
const ESP: number[] = []
const LOG: number[] = []
for (let i = 0, x = 1; i < 255; i++, x = x & 0x80 ? (x << 1) ^ 0x11d : x << 1) (ESP[i] = x), (LOG[x] = i)
const per = (a: number, b: number) => (a && b ? ESP[(LOG[a] + LOG[b]) % 255] : 0)

// I codici di correzione: il resto della divisione dei dati per il generatore (x − α⁰)(x − α¹)…(x − αⁿ⁻¹).
export function correzione(dati: number[], n: number) {
  let g = [1]
  for (let i = 0; i < n; i++) g = [...g, 0].map((c, j) => c ^ (j ? per(g[j - 1], ESP[i]) : 0))
  const resto = [...dati, ...Array<number>(n).fill(0)]
  for (let i = 0; i < dati.length; i++) {
    const c = resto[i]
    for (let j = 1; j <= n; j++) resto[i + j] ^= per(g[j], c)
  }
  return resto.slice(dati.length)
}

// 15 bit: correzione M (00) e maschera, 10 bit di controllo BCH, il tutto mescolato con 101010000010010.
export function formato(maschera: number) {
  let resto = maschera << 10
  for (let i = 14; i >= 10; i--) if (resto & (1 << i)) resto ^= 0x537 << (i - 10)
  return ((maschera << 10) | resto) ^ 0x5412
}

const MASCHERE: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

// Senza la maschera indicata si prova ogni maschera e si tiene quella con meno penalità.
export function matriceQr(testo: string, maschera?: number): Matrice | null {
  const byte = new TextEncoder().encode(testo)
  if (byte.length > 42) return null
  // Modalità byte (0100), lunghezza su 8 bit, i byte, fino a 4 zeri di chiusura, poi 0xec e 0x11 alternati.
  const bit: number[] = []
  const metti = (valore: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bit.push((valore >>> i) & 1)
  }
  metti(0b0100, 4)
  metti(byte.length, 8)
  byte.forEach((b) => metti(b, 8))
  metti(0, Math.min(4, DATI * 8 - bit.length))
  metti(0, (8 - (bit.length % 8)) % 8)
  const dati: number[] = []
  for (let i = 0; i < bit.length; i += 8) dati.push(parseInt(bit.slice(i, i + 8).join(''), 2))
  for (let i = 0; dati.length < DATI; i++) dati.push(i % 2 ? 0x11 : 0xec)
  const codici = [...dati, ...correzione(dati, CORREZIONE)]

  const m: Matrice = Array.from({ length: LATO }, () => Array<boolean>(LATO).fill(false))
  const fisso: Matrice = Array.from({ length: LATO }, () => Array<boolean>(LATO).fill(false))
  const fissa = (x: number, y: number, nero: boolean) => ((m[y][x] = nero), (fisso[y][x] = true))
  // Motivi fissi: le linee di temporizzazione, i tre riquadri d'angolo con il bordo bianco, l'allineamento in (22, 22).
  for (let i = 0; i < LATO; i++) fissa(6, i, i % 2 === 0), fissa(i, 6, i % 2 === 0)
  for (const [cx, cy] of [[3, 3], [LATO - 4, 3], [3, LATO - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        if (cx + dx >= 0 && cx + dx < LATO && cy + dy >= 0 && cy + dy < LATO) fissa(cx + dx, cy + dy, d !== 2 && d !== 4)
      }
    }
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fissa(22 + dx, 22 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  // Il formato, due copie: attorno al riquadro in alto a sinistra e divisa tra gli altri due.
  const scriviFormato = (k: number) => {
    const f = formato(k)
    const b = (i: number) => ((f >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) fissa(8, i, b(i))
    fissa(8, 7, b(6))
    fissa(8, 8, b(7))
    fissa(7, 8, b(8))
    for (let i = 9; i < 15; i++) fissa(14 - i, 8, b(i))
    for (let i = 0; i < 8; i++) fissa(LATO - 1 - i, 8, b(i))
    for (let i = 8; i < 15; i++) fissa(8, LATO - 15 + i, b(i))
    fissa(8, LATO - 8, true) // sempre nero
  }
  scriviFormato(0) // per ora serve solo a segnare quelle caselle come fisse

  // I codici a zigzag, due colonne alla volta da destra, saltando la temporizzazione verticale (colonna 6).
  let n = 0
  for (let destra = LATO - 1; destra >= 1; destra -= 2) {
    if (destra === 6) destra = 5
    const sale = ((destra + 1) & 2) === 0
    for (let v = 0; v < LATO; v++) {
      for (let j = 0; j < 2; j++) {
        const x = destra - j
        const y = sale ? LATO - 1 - v : v
        if (!fisso[y][x] && n < codici.length * 8) (m[y][x] = ((codici[n >>> 3] >>> (7 - (n & 7))) & 1) === 1), n++
      }
    }
  }

  const applica = (k: number) => {
    for (let y = 0; y < LATO; y++) for (let x = 0; x < LATO; x++) if (!fisso[y][x] && MASCHERE[k](x, y)) m[y][x] = !m[y][x]
  }
  let scelta = maschera ?? 0
  if (maschera === undefined) {
    const prove = MASCHERE.map((_, k) => {
      applica(k)
      scriviFormato(k)
      const p = penalita(m)
      applica(k) // la maschera si toglie rifacendola
      return p
    })
    scelta = prove.indexOf(Math.min(...prove))
  }
  applica(scelta)
  scriviFormato(scelta)
  return m
}

// File lunghe dello stesso colore, motivi che sembrano riquadri d'angolo (1:1:3:1:1), blocchi 2×2, squilibrio tra
// nero e bianco. Fuori dalla matrice è tutto bianco.
function penalita(m: Matrice) {
  let p = 0
  for (const fila of [...m, ...m[0].map((_, x) => m.map((r) => r[x]))]) {
    const storia = [0, 0, 0, 0, 0, 0, 0] // lunghezze delle ultime file di colore, la più recente per prima
    const aggiungi = (n: number) => {
      storia.pop()
      storia.unshift(storia[0] ? n : n + LATO)
    }
    const riquadri = () => {
      const n = storia[1]
      const centro = n > 0 && storia[2] === n && storia[3] === n * 3 && storia[4] === n && storia[5] === n
      return (centro && storia[0] >= n * 4 && storia[6] >= n ? 1 : 0) + (centro && storia[6] >= n * 4 && storia[0] >= n ? 1 : 0)
    }
    let colore = false
    let lunga = 0
    for (const nero of fila) {
      if (nero === colore) {
        lunga++
        p += lunga === 5 ? 3 : lunga > 5 ? 1 : 0
      } else {
        aggiungi(lunga)
        if (!colore) p += riquadri() * 40
        colore = nero
        lunga = 1
      }
    }
    if (colore) aggiungi(lunga), (lunga = 0)
    aggiungi(lunga + LATO)
    p += riquadri() * 40
  }
  for (let y = 0; y < LATO - 1; y++) {
    for (let x = 0; x < LATO - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3
  }
  const neri = m.flat().filter(Boolean).length
  return p + (Math.ceil(Math.abs(neri * 20 - LATO * LATO * 10) / (LATO * LATO)) - 1) * 10
}
