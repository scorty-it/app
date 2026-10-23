import { useSyncExternalStore } from 'react'

// Da questa larghezza in su il layout da computer: colonna di 440 px a sinistra e scheda di fianco alla mappa.
// La stessa soglia di `md:` di Tailwind, usata nelle classi.
export const LARGO = '(min-width: 768px)'
export const COLONNA = 440 // px, la colonna di sinistra sul computer
export const schermoLargo = () => matchMedia(LARGO).matches

export function useSchermoLargo() {
  return useSyncExternalStore(
    (avvisa) => {
      const m = matchMedia(LARGO)
      m.addEventListener('change', avvisa)
      return () => m.removeEventListener('change', avvisa)
    },
    schermoLargo,
  )
}
