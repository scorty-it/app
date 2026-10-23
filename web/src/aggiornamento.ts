/// <reference types="vite-plugin-pwa/client" />
// Dopo una pubblicazione il nuovo service worker prende subito il controllo, ma la pagina aperta gira ancora con il
// codice vecchio. Invece di ricaricarla a sorpresa, si aspetta un momento in cui l'utente non ha niente di aperto.
import { useEffect, useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

let versioneNuova = false
const ascoltatori = new Set<() => void>()

registerSW({
  immediate: true,
  onNeedReload() {
    versioneNuova = true
    ascoltatori.forEach((f) => f())
  },
  // Chi tiene la pagina aperta per ore riceve comunque l'aggiornamento.
  onRegisteredSW(_url, registrazione) {
    if (registrazione) setInterval(() => registrazione.update().catch(() => {}), 30 * 60_000)
  },
})

// `libero`: nessuna scheda, ricerca, menu o segnalazione aperti.
export function useAggiornamento(libero: boolean) {
  const pronta = useSyncExternalStore(
    (f) => (ascoltatori.add(f), () => void ascoltatori.delete(f)),
    () => versioneNuova,
  )
  useEffect(() => {
    if (pronta && libero) location.reload()
  }, [pronta, libero])
}
