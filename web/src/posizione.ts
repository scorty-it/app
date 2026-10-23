import type { Posizione } from './tipi.ts'

// Distanza massima dal distributore per segnalare: il server la verifica comunque.
export const RAGGIO_SEGNALAZIONE = 300
export const DISTANZA_MAX = 30_000 // a distanza: chi è passato da poco, per esempio guidando

export function distanza(a: Posizione, b: Posizione) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

export function formatoDistanza(metri: number) {
  if (metri < 1000) return `${Math.round(metri / 10) * 10} m`
  return `${(metri / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`
}

export function chiediPosizione(): Promise<Posizione> {
  return new Promise((ok, ko) => {
    if (!navigator.geolocation) return ko(new Error('Questo browser non può rilevare la posizione.'))
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) =>
        ko(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Serve il permesso di posizione: lo usiamo solo per verificare che tu sia al distributore, non lo salviamo.'
              : 'Non riesco a trovare la tua posizione. Riprova tra poco.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  })
}
