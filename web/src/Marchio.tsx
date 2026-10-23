import { cn } from '@/lib/utils'

// Lo spillo del logo: segue il colore del testo, il quadrante prende il colore della superficie.
export function Marchio({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <path d="M32 61L14.66 41.11A23 23 0 1 1 49.34 41.11Z" fill="currentColor" />
      <circle cx="32" cy="26" r="16.5" className="fill-card" />
      <Archi cx={32} cy={29} r={10.5} spessore={4.4} />
      <path d="M32 29L38.51 23.54" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="32" cy="29" r="3.23" fill="currentColor" />
    </svg>
  )
}

// Rosso, giallo e verde come nel logo.
const ARCHI: [string, number, number][] = [['#ef4444', 198, 228], ['#f59e0b', 255, 285], ['#22c55e', 312, 342]]
const punto = (cx: number, cy: number, r: number, gradi: number) => {
  const a = (gradi * Math.PI) / 180
  return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`
}

function Archi({ cx, cy, r, spessore }: { cx: number; cy: number; r: number; spessore: number }) {
  return ARCHI.map(([colore, da, a]) => (
    <path
      key={colore}
      d={`M${punto(cx, cy, r, da)}A${r} ${r} 0 0 1 ${punto(cx, cy, r, a)}`}
      stroke={colore}
      strokeWidth={spessore}
      strokeLinecap="round"
      fill="none"
    />
  ))
}

// L'indicatore del logo applicato alla zona: la lancetta va dal rosso (tutto finito) al verde (tutto disponibile).
// Senza valore resta dritta; al primo caricamento oscilla. Quando il valore cambia si sposta da dov'era,
// con un leggero oltrepasso come la lancetta di uno strumento.
export function Indicatore({ valore, caricamento, className }: { valore: number | null; caricamento?: boolean; className?: string }) {
  const rotazione = valore == null ? 0 : (valore - 0.5) * 130
  return (
    <svg viewBox="0 0 48 40" aria-hidden="true" className={className}>
      <Archi cx={24} cy={26} r={16} spessore={5} />
      <g
        className={cn('transition-transform duration-900 ease-[cubic-bezier(0.34,1.4,0.64,1)]', caricamento && 'oscilla')}
        style={{ transformOrigin: '24px 26px', transform: caricamento ? undefined : `rotate(${rotazione}deg)` }}
      >
        <path d="M24 26L24 13.5" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" opacity={valore == null && !caricamento ? 0.5 : 1} />
      </g>
      <circle cx="24" cy="26" r="3.8" fill="currentColor" />
    </svg>
  )
}
