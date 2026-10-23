// Disegno sulla Canvas condiviso da immagine e PDF del bollettino: carattere, colori, simboli ✓ – ✕, indicatore, logo.
// Colori sempre chiari, anche col tema scuro: sono prodotti da far girare.

export const FONT = '"Figtree Variable", system-ui, sans-serif'
export const NERO = '#16181d'
export const GRIGIO = '#5f6470'
export const BORDO = '#e6e7eb'
export const AMBRA = '#b45309' // «da confermare»
// Più scuri di quelli della mappa: sul bianco il simbolo deve leggersi anche stampato.
export const SIMBOLI = { verde: '#16a34a', giallo: '#d97706', rosso: '#dc2626' } as const
const ICONE = { verde: 'M5 12.5l4.5 4.5L19 7.5', giallo: 'M6 12h12', rosso: 'M7 7l10 10M17 7L7 17' } as const
// Gli archi dell'indicatore come nel logo (Marchio.tsx): colore, da gradi, a gradi.
const ARCHI: [string, number, number][] = [['#ef4444', 198, 228], ['#f59e0b', 255, 285], ['#22c55e', 312, 342]]

export type Ctx = CanvasRenderingContext2D
export type ColoreSimbolo = keyof typeof SIMBOLI

export function scrivi(ctx: Ctx, testo: string, x: number, y: number, px: number, peso: number, colore: string, allinea: CanvasTextAlign = 'left') {
  ctx.font = `${peso} ${px}px ${FONT}`
  ctx.fillStyle = colore
  ctx.textAlign = allinea
  ctx.fillText(testo, x, y)
}

export const misuratore = (ctx: Ctx, peso: number) => (testo: string, px: number) => {
  ctx.font = `${peso} ${px}px ${FONT}`
  return ctx.measureText(testo).width
}

export function simbolo(ctx: Ctx, colore: ColoreSimbolo, cx: number, cy: number, r: number) {
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, 2 * Math.PI)
  ctx.fillStyle = SIMBOLI[colore]
  ctx.fill()
  ctx.save()
  const s = (r * 1.15) / 12 // l'icona occupa un quadrato di 24 unità
  ctx.translate(cx - 12 * s, cy - 12 * s)
  ctx.scale(s, s)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(new Path2D(ICONE[colore]))
  ctx.restore()
}

// L'indicatore del logo: la lancetta va dal rosso (tutto finito) al verde (tutto disponibile); senza dati resta dritta e sbiadita.
export function indicatore(ctx: Ctx, x: number, y: number, larghezza: number, valore: number | null) {
  const s = larghezza / 48
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.lineCap = 'round'
  for (const [colore, da, a] of ARCHI) {
    ctx.beginPath()
    ctx.arc(24, 26, 16, (da * Math.PI) / 180, (a * Math.PI) / 180)
    ctx.strokeStyle = colore
    ctx.lineWidth = 5
    ctx.stroke()
  }
  ctx.translate(24, 26)
  ctx.rotate((((valore ?? 0.5) - 0.5) * 130 * Math.PI) / 180)
  ctx.globalAlpha = valore == null ? 0.5 : 1
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, -12.5)
  ctx.strokeStyle = NERO
  ctx.lineWidth = 3.6
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.arc(0, 0, 3.8, 0, 2 * Math.PI)
  ctx.fillStyle = NERO
  ctx.fill()
  ctx.restore()
}

// Angoli arrotondati disegnati a mano: roundRect manca su iOS 15. Senza riempimento traccia solo il bordo.
export function riquadro(ctx: Ctx, x: number, y: number, l: number, a: number, raggio: number, riempimento: string | null, bordo?: { colore: string; spessore: number }) {
  ctx.beginPath()
  ctx.moveTo(x + raggio, y)
  ctx.arcTo(x + l, y, x + l, y + a, raggio)
  ctx.arcTo(x + l, y + a, x, y + a, raggio)
  ctx.arcTo(x, y + a, x, y, raggio)
  ctx.arcTo(x, y, x + l, y, raggio)
  ctx.closePath()
  if (riempimento) {
    ctx.fillStyle = riempimento
    ctx.fill()
  }
  if (bordo) {
    ctx.strokeStyle = bordo.colore
    ctx.lineWidth = bordo.spessore
    ctx.stroke()
  }
}

export async function caricaLogo() {
  const img = new Image()
  img.src = '/scorty-logo.png'
  await img.decode()
  return img
}

export const caricaCaratteri = () => Promise.all([500, 600, 700, 800].map((peso) => document.fonts.load(`${peso} 40px ${FONT}`)))

// Una tela bianca: una JPEG senza sfondo verrebbe nera.
export function nuovaTela(larghezza: number, altezza: number) {
  const tela = document.createElement('canvas')
  tela.width = larghezza
  tela.height = altezza
  const ctx = tela.getContext('2d')!
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, larghezza, altezza)
  return { tela, ctx }
}

export const comeBlob = (tela: HTMLCanvasElement, tipo: 'image/png' | 'image/jpeg', qualita?: number) =>
  new Promise<Blob>((risolvi, rifiuta) => tela.toBlob((blob) => (blob ? risolvi(blob) : rifiuta(new Error('Immagine non creata'))), tipo, qualita))
