// Supermercati e alimentari, da OpenStreetMap (© OpenStreetMap contributors, ODbL), aggiornati ogni giorno.
// A mano: docker compose exec api node src/negozi.ts
import { sql } from 'kysely'
import { db } from './db.ts'
import { AREA_OSM, salvaImpianti, scaricaOverpass, type ElementoOsm, type Impianto } from './distributori.ts'
import { BENI } from './prodotti.ts'

// Senza amenity=fuel: i minimarket dei distributori sono già distributori.
export const QUERY_NEGOZI = `${AREA_OSM}
nwr["shop"~"^(supermarket|convenience)$"]["amenity"!="fuel"]["access"!="private"](area.sud);
out center tags;`

export function daOsmNegozio(e: ElementoOsm): Impianto | null {
  const t = Object.fromEntries(Object.entries(e.tags ?? {}).map(([k, v]) => [k, v.trim()]))
  const lat = e.lat ?? e.center?.lat
  const lon = e.lon ?? e.center?.lon
  if (lat == null || lon == null || t.disused === 'yes') return null
  const marchio = t.brand || t.operator || null
  const nome = t.name || marchio || (t.shop === 'supermarket' ? 'Supermercato' : 'Alimentari')
  return {
    id_fonte: `${e.type}/${e.id}`,
    nome,
    marchio: marchio !== nome ? marchio : null,
    indirizzo: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || null,
    // Comune e provincia non si leggono da OSM: nei negozi mancano quasi sempre (60 su 60 senza provincia nel controllo
    // del 23/10). Li scrive salvaImpianti dai confini ISTAT, in base alle coordinate (territorio.ts).
    comune: null,
    provincia: null,
    lat,
    lon,
    prodotti: BENI,
  }
}

export async function aggiornaNegozi() {
  const esito = await salvaImpianti(await scaricaOverpass(QUERY_NEGOZI, daOsmNegozio), 'osm-negozi', 'negozio')
  console.log(`negozi (${esito.fonte}): ${esito.importati} aggiornati, ${esito.disattivati} disattivati`)
  return esito
}

// Come i distributori: il server la chiama ogni ora e aggiorna solo se l'ultimo aggiornamento ha più di 20 ore.
export async function aggiornaNegoziSeVecchio() {
  const { rows: [{ ultimo }] } = await sql<{ ultimo: Date | null }>`
    select max(aggiornato_il) as ultimo from punti where fonte = 'osm-negozi' and attivo
  `.execute(db)
  if (ultimo && Date.now() - ultimo.getTime() < 20 * 60 * 60 * 1000) return null
  return aggiornaNegozi()
}

if (process.argv[1] === import.meta.filename) {
  await aggiornaNegozi()
  await db.destroy()
}
