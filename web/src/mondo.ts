import { useSyncExternalStore } from 'react'
import { mondoDi, PRODOTTI_DI, type Mondo, type Prodotto, type TipoPunto } from './tipi.ts'

// Il mondo aperto (Carburante o Spesa): lo decide il link condiviso, poi l'ultima scelta fatta in questo browser.
const CHIAVE = 'scorty-mondo'
const MONDI: Mondo[] = ['carburante', 'spesa']
const eMondo = (v: unknown): v is Mondo => MONDI.includes(v as Mondo)

export function mondoIniziale(query: string, salvato: string | null): Mondo {
  const dalLink = new URLSearchParams(query).get('mondo')
  if (eMondo(dalLink)) return dalLink
  return eMondo(salvato) ? salvato : 'carburante'
}

// Cambiando mondo un filtro dell'altro non vale più.
export const filtroValido = (f: Prodotto | null, m: Mondo): Prodotto | null => (f && PRODOTTI_DI[m].includes(f) ? f : null)

// Scegliendo un risultato: in che mondo si va e con quale filtro. Il prodotto nominato dalla frase vale se appartiene
// al mondo della scelta (anche se è già quello aperto); null se non c'è niente da cambiare.
export function passaggioMondo(aperto: Mondo, tipo: TipoPunto, prodotto: Prodotto | null): { mondo: Mondo; filtro: Prodotto | null } | null {
  const mondo = mondoDi(tipo)
  const filtro = filtroValido(prodotto, mondo)
  return mondo === aperto && !filtro ? null : { mondo, filtro }
}

function letto() {
  try {
    return localStorage.getItem(CHIAVE)
  } catch {
    return null
  }
}

let mondo: Mondo | null = null // si legge alla prima richiesta, quando la pagina c'è
const ascoltatori = new Set<() => void>()
const corrente = () => (mondo ??= mondoIniziale(location.search, letto()))

function imposta(m: Mondo) {
  mondo = m
  try {
    // Il link condiviso non deve riportare al mondo lasciato dopo un ricaricamento; la posizione (#) resta.
    const u = new URL(location.href)
    if (u.searchParams.has('mondo')) {
      u.searchParams.delete('mondo')
      history.replaceState(history.state, '', u)
    }
  } catch {
    // niente cronologia modificabile: il link resta com'è
  }
  try {
    localStorage.setItem(CHIAVE, m)
  } catch {
    // dati del sito bloccati: vale fino alla chiusura
  }
  ascoltatori.forEach((f) => f())
}

function iscrivi(f: () => void) {
  ascoltatori.add(f)
  return () => void ascoltatori.delete(f)
}

export function useMondo(): [Mondo, (m: Mondo) => void] {
  return [useSyncExternalStore(iscrivi, corrente), imposta]
}
