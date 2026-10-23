import { CHIARI, COLORI, TINTE, type Aspetto } from './aspetto.ts'

// Spilli in SVG: stessa forma per ogni stato, cambiano colore e simbolo
// (✓ disponibile, – scarso o parziale, ✕ finito, ? incerto), così si distinguono anche senza colori.
// Pieno con sfumatura = confermato; chiaro con bordo tratteggiato = da confermare.
// Senza dati recenti c'è solo un pallino grigio: si vede, ma non fa rumore.

// goccia = distributore, quadrato = negozio.
export type Forma = 'goccia' | 'quadrato'
type SpecIcona = Pick<Aspetto, 'colore' | 'incerto' | 'pieno' | 'affollato'> & { forma: Forma }

export const nomeIcona = (s: SpecIcona) => `${s.forma}:${s.colore}:${+s.incerto}:${+s.pieno}:${+s.affollato}`

// Gli spilli si ancorano con la punta, il pallino con il centro.
export const ePerno = (s: Pick<SpecIcona, 'colore' | 'incerto'>) => s.colore !== 'grigio' || s.incerto

export const LATO_PALLINO = 18
export const [LARGHEZZA, ALTEZZA] = [40, 50]
const [CX, CY, R, PUNTA] = [20, 19, 15, 46] // centro e raggio della testa, punta dello spillo

const punto = (r: number, gradi: number) => {
  const a = (gradi * Math.PI) / 180
  return `${(CX + r * Math.cos(a)).toFixed(2)} ${(CY + r * Math.sin(a)).toFixed(2)}`
}
const b = (Math.acos(R / (PUNTA - CY)) * 180) / Math.PI
const GOCCIA = `M${CX} ${PUNTA}L${punto(R, 90 + b)}A${R} ${R} 0 1 1 ${punto(R, 90 - b)}Z`

// Testa quadrata arrotondata (lato 28, centrata su CX CY) con la stessa punta in basso.
const QUADRATO = `M${CX} ${PUNTA}L${CX + 6} ${CY + 14}H${CX + 9}a5 5 0 0 0 5-5V${CY - 9}a5 5 0 0 0-5-5H${CX - 9}a5 5 0 0 0-5 5V${CY + 9}a5 5 0 0 0 5 5H${CX - 6}Z`

const SIMBOLI = {
  verde: `<path d="M${CX - 5} ${CY + 0.5}l3.6 3.6 6.6-7.2"/>`,
  giallo: `<path d="M${CX - 5} ${CY}h10"/>`,
  rosso: `<path d="M${CX - 4.2} ${CY - 4.2}l8.4 8.4m0-8.4-8.4 8.4"/>`,
  grigio: `<path d="M${CX - 3.2} ${CY - 3}a3.3 3.3 0 1 1 4.6 3c-1 .5-1.4 1.1-1.4 2.2"/><circle cx="${CX}" cy="${CY + 5.6}" r=".4"/>`,
}

// Coda lunga o coda in aumento: distintivo scuro con un'auto, come il traffico sulle mappe.
const TRAFFICO = `<g transform="translate(33 8)">
  <circle r="7.5" fill="#16181d" stroke="#fff" stroke-width="2"/>
  <path fill="#fff" d="M-4.3 1.6v-1.4l1-2.6c.2-.5.6-.8 1.1-.8h4.4c.5 0 .9.3 1.1.8l1 2.6v1.4z"/>
  <circle cx="-2.4" cy="2.2" r="1.1" fill="#fff"/><circle cx="2.4" cy="2.2" r="1.1" fill="#fff"/>
</g>`

// Sul quadrato il distintivo è una persona (testa e spalle): in coda al negozio c'è gente.
const AFFOLLAMENTO = `<g transform="translate(33 8)">
  <circle r="7.5" fill="#16181d" stroke="#fff" stroke-width="2"/>
  <circle cy="-2.4" r="1.9" fill="#fff"/>
  <path fill="#fff" d="M-4 4.2c0-2.3 1.8-3.6 4-3.6s4 1.3 4 3.6z"/>
</g>`

export function svgIcona(s: SpecIcona) {
  const colore = COLORI[s.colore]
  if (!ePerno(s)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LATO_PALLINO} ${LATO_PALLINO}">
      <defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="${CHIARI.grigio}"/><stop offset="1" stop-color="${colore}"/></linearGradient></defs>
      <circle cx="9" cy="9" r="6.2" fill="url(#g)" stroke="#fff" stroke-width="2.4"/>
    </svg>`
  }
  const forma = s.forma === 'quadrato' ? QUADRATO : GOCCIA
  const corpo = s.pieno
    ? `<path d="${forma}" fill="url(#g)" stroke="#fff" stroke-width="2.5"/>
       <ellipse cx="11.5" cy="10.5" rx="3.6" ry="2" transform="rotate(-38 11.5 10.5)" fill="#fff" opacity=".45"/>`
    : `<path d="${forma}" fill="${TINTE[s.colore]}" stroke="${colore}" stroke-width="2.6" stroke-dasharray="4.4 3" stroke-linecap="round"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LARGHEZZA} ${ALTEZZA}">
    <defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="${CHIARI[s.colore]}"/><stop offset="1" stop-color="${colore}"/></linearGradient></defs>
    ${corpo}
    <circle cx="${CX}" cy="${CY}" r="10.2" fill="#fff"/>
    <g fill="none" stroke="${colore}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">${SIMBOLI[s.incerto ? 'grigio' : s.colore]}</g>
    ${s.affollato ? (s.forma === 'quadrato' ? AFFOLLAMENTO : TRAFFICO) : ''}
  </svg>`
}

const cache = new Map<string, string>()
export function iconaUrl(s: SpecIcona) {
  const nome = nomeIcona(s)
  let url = cache.get(nome)
  if (!url) cache.set(nome, (url = `data:image/svg+xml,${encodeURIComponent(svgIcona(s))}`))
  return url
}
