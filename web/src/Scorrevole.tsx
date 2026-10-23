import { useEffect, useRef, useState, type ReactNode } from 'react'
import { sfumatura } from './sfumatura.ts'

// Una riga che scorre in orizzontale con i bordi sfumati dove c'è altro da vedere (sfumatura.ts). La sfumatura tocca solo
// il contenuto: lo sfondo e gli angoli della barra che la contiene restano interi.
export function Scorrevole({ children, className }: { children: ReactNode; className?: string }) {
  const riga = useRef<HTMLDivElement>(null)
  const [maschera, setMaschera] = useState<string>()
  const aggiorna = () => {
    if (riga.current) setMaschera(sfumatura(riga.current))
  }
  useEffect(() => {
    const el = riga.current
    if (!el) return
    const misure = new ResizeObserver(aggiorna)
    misure.observe(el)
    el.addEventListener('scroll', aggiorna, { passive: true })
    return () => (misure.disconnect(), el.removeEventListener('scroll', aggiorna))
  }, [])
  useEffect(aggiorna) // anche quando cambiano i figli (le categorie di un altro mondo) senza che cambi la misura
  return (
    <div ref={riga} className={`senza-barra flex min-w-0 overflow-x-auto ${className ?? ''}`} style={{ maskImage: maschera, WebkitMaskImage: maschera }}>
      {children}
    </div>
  )
}
