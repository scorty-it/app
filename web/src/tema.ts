import { useSyncExternalStore } from 'react'

// Tema: in automatico segue il telefono; la scelta manuale resta solo in questo browser.
export type Tema = 'auto' | 'chiaro' | 'scuro'

const CHIAVE = 'scorty-tema'
const media = matchMedia('(prefers-color-scheme: dark)')
const ascoltatori = new Set<() => void>()

function letto(): Tema {
  try {
    const t = localStorage.getItem(CHIAVE)
    return t === 'chiaro' || t === 'scuro' ? t : 'auto'
  } catch {
    return 'auto'
  }
}

let tema = letto()

export function impostaTema(t: Tema) {
  tema = t
  try {
    localStorage.setItem(CHIAVE, t)
  } catch {
    // navigazione privata o dati del sito bloccati: vale fino alla chiusura
  }
  ascoltatori.forEach((f) => f())
}

function iscrivi(f: () => void) {
  ascoltatori.add(f)
  media.addEventListener('change', f)
  return () => {
    ascoltatori.delete(f)
    media.removeEventListener('change', f)
  }
}

export function useTema() {
  const scelto = useSyncExternalStore(iscrivi, () => tema)
  const scuro = useSyncExternalStore(iscrivi, () => tema === 'scuro' || (tema === 'auto' && media.matches))
  return { scelto, scuro }
}
