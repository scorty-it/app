import * as maplibregl from 'maplibre-gl'
import urlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'
import { aspetto, descriviSpillo, type Aspetto } from './aspetto.ts'
import { ePerno, iconaUrl, nomeIcona } from './icone.ts'
import { COLONNA, schermoLargo } from './schermo.ts'
import { anello, type geojson, type Limiti } from './sintesi.ts'
import type { Posizione, Prodotto, Punto, StatoPunto } from './tipi.ts'

// Il worker va indicato esplicitamente, altrimenti il bundler non lo include.
maplibregl.setWorkerUrl(urlWorker)

// Chiaro colorato (Liberty) e scuro blu notte (Fiord): niente nero pieno.
const STILI = { chiaro: 'https://tiles.openfreemap.org/styles/liberty', scuro: 'https://tiles.openfreemap.org/styles/fiord' }
const SUD_ITALIA: maplibregl.LngLatBoundsLike = [[12.3, 36.6], [18.6, 41.9]]

// Da questo zoom in su gli spilli dei singoli distributori; sotto, le bolle che riassumono le zone.
export const ZOOM_SPILLI = 13
const SORGENTE = 'sintesi'

export interface Centro extends Posizione {
  zoom: number
  limiti: Limiti
}

export interface ControlliMappa {
  trovaPosizione: () => void
  vaiA: (p: Posizione) => void
  volaA: (p: Posizione, zoom: number) => void
}

interface Props {
  punti: Punto[]
  sintesi: ReturnType<typeof geojson>
  stati: Map<number, StatoPunto>
  filtro: Prodotto | null
  selezionato: number | null
  scuro: boolean
  onSeleziona: (id: number) => void
  onCentro: (c: Centro) => void
  onPosizione: (p: Posizione) => void
  controlli: React.RefObject<ControlliMappa | null>
}

// Da vicino i distributori sono al massimo 150: gli spilli sono elementi HTML e si animano con il CSS (vedi .spillo in index.css).
interface Spillo {
  marker: maplibregl.Marker
  el: HTMLButtonElement
  img: HTMLImageElement
  icona: string
  perno: boolean
}

// Una bolla della mappa da lontano: un gruppo di distributori (cluster) o uno solo rimasto isolato.
interface Bolla {
  marker: maplibregl.Marker
  el: HTMLButtonElement
  firma: string
}

type ProprietaBolla = { cluster?: boolean; cluster_id?: number; point_count?: number; v: number; g: number; r: number; i: number }

// Il numero conta i distributori con notizie, l'anello come sono messi; una zona senza notizie è un cerchio vuoto.
function disegnaBolla(el: HTMLButtonElement, p: ProprietaBolla) {
  const notizie = p.v + p.g + p.r + p.i
  const dentro = document.createElement('span')
  if (!p.cluster) {
    dentro.className = notizie ? 'bolla punto' : 'bolla vuota punto'
    dentro.style.setProperty('--d', notizie ? '14px' : '12px')
    if (notizie) dentro.style.background = anello(p)!
    el.setAttribute('aria-label', notizie ? 'Un distributore con notizie: avvicina' : 'Un distributore senza notizie: avvicina')
  } else if (notizie) {
    dentro.className = 'bolla'
    dentro.style.setProperty('--d', `${Math.round(Math.min(60, 32 + Math.sqrt(notizie) * 4.5))}px`)
    dentro.style.background = anello(p)!
    const numero = document.createElement('span')
    numero.className = 'bolla-numero'
    numero.textContent = String(notizie)
    dentro.append(numero)
    el.setAttribute('aria-label', `${notizie} distributori con notizie su ${p.point_count}: ${p.v} disponibili, ${p.g} scarsi o parziali, ${p.r} finiti. Avvicina`)
  } else {
    dentro.className = 'bolla vuota'
    dentro.style.setProperty('--d', `${Math.round(Math.min(32, 18 + Math.sqrt(p.point_count ?? 1)))}px`)
    el.setAttribute('aria-label', `${p.point_count} distributori senza notizie. Avvicina`)
  }
  el.replaceChildren(dentro)
}

// Riavvia un'animazione CSS anche se la classe c'era già.
function anima(el: Element, classe: string) {
  el.classList.remove('entra', 'cambia')
  void (el as HTMLElement).offsetWidth
  el.classList.add(classe)
}

export function Mappa(props: Props) {
  const contenitore = useRef<HTMLDivElement>(null)
  const mappa = useRef<maplibregl.Map>(null)
  const spilli = useRef(new Map<number, Spillo>())
  const bolle = useRef(new Map<string, Bolla>())
  const ultime = useRef(props)
  ultime.current = props

  useEffect(() => {
    const daLink = /^#\d/.test(location.hash) // aperta da un link condiviso: resta dov'è
    const m = new maplibregl.Map({
      container: contenitore.current!,
      style: ultime.current.scuro ? STILI.scuro : STILI.chiaro,
      bounds: SUD_ITALIA,
      hash: true, // la posizione della mappa resta nell'indirizzo: è il link da condividere
      attributionControl: false, // l'attribuzione è sopra la barra in basso
      dragRotate: false,
      pitchWithRotate: false,
    })
    m.touchZoomRotate.disableRotation()
    mappa.current = m

    const geo = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      fitBoundsOptions: { maxZoom: 13 },
      showAccuracyCircle: false,
    })
    m.addControl(geo)
    geo.on('geolocate', (p) => ultime.current.onPosizione({ lat: p.coords.latitude, lon: p.coords.longitude }))

    const centro = () => {
      const c = m.getCenter()
      const b = m.getBounds()
      ultime.current.onCentro({ lat: c.lat, lon: c.lng, zoom: m.getZoom(), limiti: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] })
    }
    // La posizione si chiede solo aprendo la mappa: chi apre una pagina, come il link di un bollettino (/province/SA), non cerca
    // carburante intorno a sé. Dalla pagina alla mappa basta il pulsante della posizione.
    m.once('load', () => (centro(), daLink || location.pathname !== '/' || geo.trigger()))
    m.on('moveend', centro)

    ultime.current.controlli.current = {
      trovaPosizione: () => geo.trigger(),
      // Il distributore scelto finisce nella parte di mappa libera: sopra la scheda che sale dal basso sul telefono,
      // a destra del pannello sul computer.
      vaiA: (p) => m.easeTo({
        center: [p.lon, p.lat], zoom: Math.max(m.getZoom(), 15),
        offset: schermoLargo() ? [(COLONNA + 16) / 2, 0] : [0, -innerHeight * 0.22],
      }),
      volaA: (p, zoom) => m.flyTo({ center: [p.lon, p.lat], zoom }),
    }

    // Le bolle: MapLibre raggruppa i distributori vicini sullo schermo e somma i conteggi di ogni gruppo.
    // Lo strato invisibile serve solo a far caricare la sorgente; le bolle sono elementi HTML, come gli spilli.
    const aggiungiSorgente = () => {
      if (m.getSource(SORGENTE)) return
      const somma = (k: string) => ['+', ['get', k]] as maplibregl.ExpressionSpecification
      m.addSource(SORGENTE, {
        type: 'geojson', data: ultime.current.sintesi, cluster: true, clusterMaxZoom: ZOOM_SPILLI - 1, clusterRadius: 72,
        clusterProperties: { v: somma('v'), g: somma('g'), r: somma('r'), i: somma('i') },
      })
      m.addLayer({ id: SORGENTE, type: 'circle', source: SORGENTE, maxzoom: ZOOM_SPILLI, paint: { 'circle-radius': 0, 'circle-opacity': 0 } })
    }
    const aggiornaBolle = () => {
      const viste = new Set<string>()
      if (m.getZoom() < ZOOM_SPILLI && m.getSource(SORGENTE) && m.isSourceLoaded(SORGENTE)) {
        for (const f of m.querySourceFeatures(SORGENTE)) {
          const p = f.properties as ProprietaBolla & { id?: number }
          const chiave = p.cluster ? `c${p.cluster_id}` : `p${p.id}`
          if (viste.has(chiave)) continue // lo stesso gruppo può arrivare da due riquadri
          viste.add(chiave)
          const firma = `${p.point_count}|${p.v}|${p.g}|${p.r}|${p.i}`
          let b = bolle.current.get(chiave)
          if (!b) {
            const el = document.createElement('button')
            el.className = 'bolla-tasto'
            const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates
            el.addEventListener('click', async (e) => {
              e.stopPropagation()
              const zoom = p.cluster
                ? await (m.getSource(SORGENTE) as maplibregl.GeoJSONSource).getClusterExpansionZoom(p.cluster_id!)
                : ZOOM_SPILLI
              m.easeTo({ center: [lon, lat], zoom: Math.min(Math.max(zoom, m.getZoom() + 1), ZOOM_SPILLI) })
            })
            b = { marker: new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(m), el, firma: '' }
            bolle.current.set(chiave, b)
          }
          if (b.firma !== firma) {
            disegnaBolla(b.el, p)
            b.firma = firma
          }
        }
      }
      for (const [chiave, b] of bolle.current) {
        if (viste.has(chiave)) continue
        b.marker.remove()
        bolle.current.delete(chiave)
      }
    }
    m.on('render', aggiornaBolle)

    m.on('style.load', () => {
      aggiungiSorgente() // cambiando tema lo stile si ricarica da capo, sorgenti comprese
      for (const l of m.getStyle().layers) {
        // Niente icone di negozi e luoghi: sulla mappa contano solo i distributori.
        if ('source-layer' in l && l['source-layer'] === 'poi') m.setLayoutProperty(l.id, 'visibility', 'none')
        // Etichette in italiano dove le tile le hanno.
        else if (l.type === 'symbol' && JSON.stringify(l.layout?.['text-field'] ?? '').includes('name')) {
          m.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:it'], ['get', 'name']])
        }
      }
    })

    return () => m.remove()
  }, [])

  const { punti, stati, filtro, selezionato, sintesi } = props

  useEffect(() => {
    ;(mappa.current?.getSource(SORGENTE) as maplibregl.GeoJSONSource | undefined)?.setData(sintesi)
  }, [sintesi])

  useEffect(() => {
    const m = mappa.current
    if (!m) return
    const ora = Date.now()
    const presenti = new Set<number>()
    let nuovi = 0

    for (const p of punti) {
      const a = aspetto(stati.get(p.id), filtro, ora)
      const spec = { ...a, forma: p.tipo === 'negozio' ? ('quadrato' as const) : ('goccia' as const) }
      const icona = nomeIcona(spec)
      const perno = ePerno(a)
      presenti.add(p.id)
      let s = spilli.current.get(p.id)
      if (s && s.perno !== perno) {
        // da pallino a spillo o viceversa cambia l'ancoraggio: si ricrea
        s.marker.remove()
        s = undefined
      }
      if (!s) {
        const el = document.createElement('button')
        el.className = 'spillo-tasto'
        const dentro = document.createElement('span')
        dentro.className = `spillo ${perno ? 'perno' : 'pallino'}`
        // Compaiono uno dopo l'altro, dal più vicino al centro (l'API li manda in quest'ordine); dopo i primi 20 tutti insieme.
        dentro.style.animationDelay = `${Math.min(nuovi++, 20) * 45}ms`
        const img = document.createElement('img')
        img.alt = ''
        img.draggable = false
        dentro.append(img)
        el.append(dentro)
        el.addEventListener('click', (e) => (e.stopPropagation(), ultime.current.onSeleziona(p.id)))
        anima(dentro, 'entra')
        s = { marker: new maplibregl.Marker({ element: el, anchor: perno ? 'bottom' : 'center' }).setLngLat([p.lon, p.lat]).addTo(m), el, img, icona: '', perno }
        spilli.current.set(p.id, s)
      } else if (s.icona !== icona) {
        anima(s.el.firstElementChild!, 'cambia') // lo stato è cambiato: un piccolo salto
      }
      if (s.icona !== icona) {
        s.img.src = iconaUrl(spec)
        s.icona = icona
      }
      s.el.setAttribute('aria-label', descriviSpillo(p, a, filtro))
      s.el.classList.toggle('vecchio', a.vecchio)
      s.el.classList.toggle('sel', p.id === selezionato)
      s.el.style.zIndex = p.id === selezionato ? '3' : perno ? '2' : '1'
    }

    // Quelli usciti dall'elenco svaniscono.
    for (const [id, s] of spilli.current) {
      if (presenti.has(id)) continue
      spilli.current.delete(id)
      s.el.firstElementChild!.classList.add('esce')
      setTimeout(() => s.marker.remove(), 250)
    }
  }, [punti, stati, filtro, selezionato])

  const primoStile = useRef(true)
  useEffect(() => {
    if (primoStile.current) return void (primoStile.current = false)
    mappa.current?.setStyle(props.scuro ? STILI.scuro : STILI.chiaro, { diff: false })
  }, [props.scuro])

  // Stile inline: il CSS di MapLibre imposta position: relative sul contenitore e annullerebbe una classe.
  return <div ref={contenitore} style={{ position: 'absolute', inset: 0 }} />
}
