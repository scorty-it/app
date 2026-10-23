import { Check, Minus, X } from 'lucide-react'
import { CHIARI, COLORI, type Colore } from './aspetto.ts'

// In un file suo perché lo usa anche il widget per le testate, che non deve portarsi dietro la scheda del distributore.
const SIMBOLO = { verde: Check, giallo: Minus, rosso: X } as const

// Stesso simbolo degli spilli sulla mappa: lo stato si legge anche senza colori.
export function SimboloStato({ colore }: { colore: Colore }) {
  const Icona = colore === 'grigio' ? null : SIMBOLO[colore]
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(16_24_40/0.25)]"
      style={{ background: `linear-gradient(${CHIARI[colore]}, ${COLORI[colore]})` }}
    >
      {Icona ? <Icona className="size-3.5" strokeWidth={3.5} /> : '?'}
    </span>
  )
}
