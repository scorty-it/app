// La mappa da lontano: tutti i distributori riassunti in bolle per zona.
// Le bolle le forma MapLibre raggruppando i punti vicini sullo schermo; qui si prepara cosa contano:
// per ogni distributore se ha notizie e di che colore. Funzioni pure, con i loro test.
import { aspetto, COLORI } from './aspetto.ts'
import { TUTTI_I_PRODOTTI, type Prodotto, type StatoPunto } from './tipi.ts'

// Come arriva da /api/mappa: [id, lat, lon, carburanti], con i carburanti come bit nell'ordine di TUTTI_I_PRODOTTI.
export type PuntoMappa = [id: number, lat: number, lon: number, maschera: number]
// ovest, sud, est, nord
export type Limiti = [number, number, number, number]
export type Categoria = 'verde' | 'giallo' | 'rosso' | 'incerto'

export interface Conteggi {
  v: number // disponibile
  g: number // scarso o misto
  r: number // finito
  i: number // segnalazioni contrastanti
}

export const vende = (maschera: number, prodotto: Prodotto) => (maschera & (1 << TUTTI_I_PRODOTTI.indexOf(prodotto))) !== 0

// Lo stesso colore dello spillo; null se non ci sono notizie (sul carburante filtrato, se c'è un filtro).
export function categoria(s: StatoPunto | undefined, filtro: Prodotto | null, ora = Date.now()): Categoria | null {
  const a = aspetto(s, filtro, ora)
  if (a.incerto) return 'incerto'
  return a.colore === 'grigio' ? null : a.colore
}

const conteggiDi = (c: Categoria | null): Conteggi => ({ v: +(c === 'verde'), g: +(c === 'giallo'), r: +(c === 'rosso'), i: +(c === 'incerto') })

// Un punto per distributore, solo quelli che hanno il carburante filtrato. MapLibre somma v, g, r, i nelle bolle.
export function geojson(punti: PuntoMappa[], stati: Map<number, StatoPunto>, filtro: Prodotto | null, ora = Date.now()) {
  return {
    type: 'FeatureCollection' as const,
    features: punti
      .filter(([, , , m]) => !filtro || vende(m, filtro))
      .map(([id, lat, lon]) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [lon, lat] },
        properties: { id, ...conteggiDi(categoria(stati.get(id), filtro, ora)) },
      })),
  }
}

// Per la barra in basso: quanti distributori nella zona visibile e quanti per colore.
export function riepilogo(punti: PuntoMappa[], stati: Map<number, StatoPunto>, filtro: Prodotto | null, [ovest, sud, est, nord]: Limiti, ora = Date.now()) {
  const r = { distributori: 0, verde: 0, giallo: 0, rosso: 0, incerto: 0 }
  for (const [id, lat, lon, m] of punti) {
    if (lat < sud || lat > nord || lon < ovest || lon > est || (filtro && !vende(m, filtro))) continue
    r.distributori++
    const c = categoria(stati.get(id), filtro, ora)
    if (c) r[c]++
  }
  return r
}

// Numeri per la barra in basso, dove lo spazio è poco: 1234 → «1,2k».
export const breve = (n: number) => (n < 1000 ? String(n) : `${+(n / 1000).toFixed(1)}k`.replace('.', ','))

// L'anello intorno al numero: un settore per colore, in proporzione. null se non ci sono notizie.
export function anello({ v, g, r, i }: Conteggi) {
  const totale = v + g + r + i
  if (!totale) return null
  let da = 0
  const settori = ([[COLORI.verde, v], [COLORI.giallo, g], [COLORI.rosso, r], [COLORI.grigio, i]] as const)
    .filter(([, n]) => n > 0)
    .map(([colore, n]) => {
      const a = da + (n / totale) * 100
      const s = `${colore} ${+da.toFixed(2)}% ${+a.toFixed(2)}%`
      da = a
      return s
    })
  return `conic-gradient(${settori.join(', ')})`
}
