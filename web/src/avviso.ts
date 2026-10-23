import { useEffect, useRef, useState } from 'react'
import { caricaVicini } from './dati.ts'
import { distanza } from './posizione.ts'
import type { Posizione, Punto } from './tipi.ts'

// Avviso al distributore: con Scorty aperto, se sei fermo vicino a un distributore ti invita a dire com'è.
// I browser non danno la posizione alle app chiuse o in secondo piano: funziona solo a schermo acceso.

export const VICINO = 120 // metri dal distributore, margine compreso per l'errore del GPS
export const FERMO = 40 // metri: oscillazione massima per considerarti fermo
export const ATTESA = 60_000 // da quanto devi essere fermo
const RIPETI = 2 * 60 * 60 * 1000 // lo stesso distributore non si ripropone prima di 2 ore

export interface Campione {
  pos: Posizione
  t: number
}

// I punti per cui vale l'invito: i distributori vicini e, se hai detto «Ci vado», il negozio dove vai.
// Un alimentari sotto casa non conta: senza «Ci vado» i negozi non fanno scattare niente.
export function puntiDaAvvisare(distributori: Punto[], ciVado: Punto | null): Punto[] {
  return ciVado && !distributori.some((d) => d.id === ciVado.id) ? [...distributori, ciVado] : distributori
}

// Il punto vicino a cui sei fermo da almeno un minuto, o niente.
export function fermoVicino(campioni: Campione[], punti: Punto[], ora: number): Punto | null {
  const ultimo = campioni[campioni.length - 1]
  if (!ultimo || !campioni.some((c) => c.t <= ora - ATTESA)) return null
  const finestra = campioni.filter((c) => c.t >= ora - ATTESA - 15_000)
  if (finestra.some((c) => distanza(c.pos, ultimo.pos) > FERMO)) return null
  const vicino = punti
    .map((p) => ({ p, m: distanza(ultimo.pos, p) }))
    .filter((x) => x.m <= VICINO)
    .sort((a, b) => a.m - b.m)[0]
  return vicino?.p ?? null
}

const CHIAVE = 'scorty-avvisati'
function giaAvvisato(id: number, ora: number) {
  try {
    const visti: Record<string, number> = JSON.parse(localStorage.getItem(CHIAVE) ?? '{}')
    if (visti[id] && ora - visti[id] < RIPETI) return true
    const recenti = Object.fromEntries(Object.entries(visti).filter(([, t]) => ora - t < RIPETI))
    localStorage.setItem(CHIAVE, JSON.stringify({ ...recenti, [id]: ora }))
  } catch {
    // dati del sito bloccati: si avvisa comunque, al massimo una volta in più
  }
  return false
}

// Al server va solo una posizione approssimata (circa 100 m) per sapere quali distributori sono vicini;
// la distanza vera si calcola qui sul telefono.
const approssimata = (p: Posizione) => ({ lat: Math.round(p.lat * 1000) / 1000, lon: Math.round(p.lon * 1000) / 1000 })

// ciVado è una funzione perché il «Ci vado» cambia fuori da React: si rilegge a ogni valutazione.
export function useAvvisoAlDistributore(attivo: boolean, ciVado: () => Punto | null, onPunto: (p: Punto) => void) {
  const avvisa = useRef(onPunto)
  avvisa.current = onPunto
  const ciVadoCorrente = useRef(ciVado)
  ciVadoCorrente.current = ciVado

  useEffect(() => {
    if (!attivo || !('geolocation' in navigator)) return
    let campioni: Campione[] = []
    let distributori: Punto[] = []
    let ultimaRicerca: Posizione | null = null
    let osserva: number | null = null

    const valuta = () => {
      const ora = Date.now()
      const ultimo = campioni[campioni.length - 1]
      // Da fermo il GPS può tacere: l'ultima posizione vale ancora per un po'.
      if (ultimo && ora - ultimo.t < 30_000) campioni.push({ pos: ultimo.pos, t: ora })
      campioni = campioni.filter((c) => c.t >= ora - ATTESA - 30_000)
      const p = fermoVicino(campioni, puntiDaAvvisare(distributori, ciVadoCorrente.current()), ora)
      if (p && !giaAvvisato(p.id, ora)) avvisa.current(p)
    }

    const nuovaPosizione = (g: GeolocationPosition) => {
      if (g.coords.accuracy > 100) return // troppo impreciso per dire a quale distributore sei
      const pos = { lat: g.coords.latitude, lon: g.coords.longitude }
      campioni.push({ pos, t: Date.now() })
      if (!ultimaRicerca || distanza(pos, ultimaRicerca) > 300) {
        ultimaRicerca = pos
        caricaVicini(approssimata(pos), 5, null, 'distributore').then((r) => (distributori = r.map((x) => x.punto)), () => {})
      }
      valuta()
    }

    // Solo con la pagina visibile: in secondo piano non funzionerebbe comunque e consumerebbe batteria.
    const aggiorna = () => {
      if (document.visibilityState === 'visible' && osserva == null) {
        osserva = navigator.geolocation.watchPosition(nuovaPosizione, () => {}, { enableHighAccuracy: true, maximumAge: 15_000 })
      } else if (document.visibilityState !== 'visible' && osserva != null) {
        navigator.geolocation.clearWatch(osserva)
        osserva = null
        campioni = []
      }
    }
    aggiorna()
    document.addEventListener('visibilitychange', aggiorna)
    const ogni15s = setInterval(valuta, 15_000)
    return () => {
      document.removeEventListener('visibilitychange', aggiorna)
      clearInterval(ogni15s)
      if (osserva != null) navigator.geolocation.clearWatch(osserva)
    }
  }, [attivo])
}

// Attivo se l'hai acceso dal menu, oppure, finché non scegli, se la posizione è già permessa:
// l'avviso non chiede mai permessi da solo.
const SCELTA = 'scorty-avviso'
function letta(): 'si' | 'no' | null {
  try {
    const v = localStorage.getItem(SCELTA)
    return v === 'si' || v === 'no' ? v : null
  } catch {
    return null
  }
}

export function usePreferenzaAvviso() {
  const [scelta, setScelta] = useState(letta)
  const [permesso, setPermesso] = useState<PermissionState | null>(null)
  useEffect(() => {
    let stato: PermissionStatus | null = null
    navigator.permissions?.query({ name: 'geolocation' }).then((s) => {
      stato = s
      setPermesso(s.state)
      s.onchange = () => setPermesso(s.state)
    }, () => {})
    return () => void (stato && (stato.onchange = null))
  }, [])
  const imposta = (si: boolean) => {
    const v = si ? 'si' : 'no'
    try {
      localStorage.setItem(SCELTA, v)
    } catch {
      // dati del sito bloccati: la scelta vale fino alla chiusura
    }
    setScelta(v)
  }
  return { attivo: scelta === 'si' || (scelta == null && permesso === 'granted'), imposta }
}
