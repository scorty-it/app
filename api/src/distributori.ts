// Anagrafica dei distributori, aggiornata ogni giorno.
// Fonte principale: il Ministero (MIMIT), letto dal sito dell'Osservatorio prezzi carburanti, dati IODL 2.0.
// Il file CSV ufficiale risponde solo da indirizzi italiani; l'Osservatorio no.
// Riserva: OpenStreetMap (© OpenStreetMap contributors, ODbL), usato solo finché non ci sono dati del Ministero.
// A mano: docker compose exec api node src/distributori.ts [--osm]
import { sql } from 'kysely'
import { comuneUfficiale, comuniIgnoti } from './comuni.ts'
import { db, type Prodotto, type TipoPunto } from './db.ts'
import { CARBURANTI } from './prodotti.ts'
import { assegnaComuniNegozi } from './territorio.ts'

export interface Prezzo {
  prodotto: Prodotto
  self: boolean
  prezzo: number
}

export interface Impianto {
  id_fonte: string
  nome: string
  marchio: string | null
  indirizzo: string | null
  comune: string | null
  provincia: string | null
  lat: number
  lon: number
  prodotti: Prodotto[]
  prezzi?: Prezzo[] // solo dal Ministero
  prezzi_il?: string | null // quando il distributore li ha comunicati
}

const AGENTE = 'Scorty/1.0 (https://scorty.it, mappa civica delle scorte)'

// --- Ministero (Osservatorio prezzi carburanti) ---

const OSSERVATORIO = 'https://carburanti.mise.gov.it/ospzApi/search/area'
const REGIONI = [8, 6, 3, 7, 11] // Campania, Puglia, Basilicata, Calabria, Sicilia (codici dell'Osservatorio)
const ID_CARBURANTE: Record<number, Prodotto> = { 1: 'benzina', 2: 'gasolio', 3: 'metano', 4: 'gpl' }

interface ImpiantoMimit {
  id: number
  name: string
  brand: string | null
  address: string | null
  location: { lat: number; lng: number } | null
  fuels: { fuelId: number; price?: number; isSelf?: boolean }[]
  insertDate?: string
}

// Per ogni carburante e modalità (self o servito) il prezzo più basso tra le varianti; i valori assurdi si scartano.
export function prezziMimit(fuels: ImpiantoMimit['fuels']): Prezzo[] {
  const migliori = new Map<string, Prezzo>()
  for (const f of fuels) {
    const prodotto = ID_CARBURANTE[f.fuelId]
    if (!prodotto || f.price == null || !(f.price > 0.3 && f.price < 10)) continue
    const chiave = `${prodotto}:${!!f.isSelf}`
    const prima = migliori.get(chiave)
    if (!prima || f.price < prima.prezzo) migliori.set(chiave, { prodotto, self: !!f.isSelf, prezzo: f.price })
  }
  return [...migliori.values()]
}

const MINUSCOLE = new Set(['di', 'del', 'della', 'delle', 'dei', 'degli', 'dello', 'e', 'al', 'alla', 'ai', 'da', 'in'])

// "VIA G. LA PIRA" → "Via G. La Pira"; le sigle delle strade (SS, SP) restano maiuscole.
const SIGLE = new Set(['SS', 'SP', 'SR', 'SC', 'A1', 'A2', 'A3', 'A14', 'A16', 'A18', 'A19', 'A20', 'A29'])
export function maiuscoleIniziali(testo: string) {
  return testo
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((parola, i) => {
      if (SIGLE.has(parola.toUpperCase())) return parola.toUpperCase()
      const p = parola.toLowerCase()
      if (i > 0 && MINUSCOLE.has(p)) return p
      return p.replace(/(^|[-'.(])(\p{L})/gu, (_, prima, lettera) => prima + lettera.toUpperCase())
    })
    .join(' ')
}

// "AgipEni" → "Eni", "Api-Ip" → "IP", "ItalianaCarburanti" → "Italiana Carburanti", "GBPetroli" → "GB Petroli"
export function marchioLeggibile(marchio: string | null) {
  if (!marchio?.trim()) return null
  const m = marchio.trim()
  if (/^(agip\s*-?\s*eni|eni|enilive)$/i.test(m)) return 'Eni'
  if (/^(api\s*-?\s*ip|ip)$/i.test(m)) return 'IP'
  if (/^pompe\s*bianche$/i.test(m)) return 'Pompa bianca'
  return m.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
}

// "VIA G. LA PIRA SNC 81100 - CASERTA CE" → via, comune, provincia.
// Si divide sull'ultimo " - " con lo spazio prima: i comuni come CORIGLIANO-ROSSANO hanno un trattino nel nome.
// Senza spazi ("80062-META NA") vale il primo trattino da destra. Il comune è quello ufficiale di oggi (comuni.ts).
export function dividiIndirizzo(indirizzo: string | null) {
  const m = indirizzo?.match(/^(.*)\s-\s*(.+?)\s+([A-Z]{2})\s*$/) ?? indirizzo?.match(/^(.*?)\s*-\s*([^-]+?)\s+([A-Z]{2})\s*$/)
  if (!m) return { indirizzo: indirizzo?.trim() ? maiuscoleIniziali(indirizzo) : null, comune: null, provincia: null }
  // Senza CAP, trattini o virgole in coda e senza "SNC"/"NC" (senza numero civico)
  const coda = /[\s,.-]+$/
  const via = m[1].replace(coda, '').replace(/\d{5}$/, '').replace(coda, '').replace(/\s+(s\.?\s?n\.?\s?c\.?|n\.?\s?c\.?)$/i, '').trim()
  const comune = maiuscoleIniziali(m[2])
  return { indirizzo: via ? maiuscoleIniziali(via) : null, comune: comuneUfficiale(comune, m[3]) ?? comune, provincia: m[3] }
}

export function daMimit(r: ImpiantoMimit): Impianto | null {
  const prodotti = CARBURANTI.filter((p) => r.fuels.some((f) => ID_CARBURANTE[f.fuelId] === p))
  if (!r.location || !prodotti.length) return null
  const marchio = marchioLeggibile(r.brand)
  // Il nome è quello del marchio; per le pompe bianche quello scelto dal gestore.
  const nome = marchio && marchio !== 'Pompa bianca' ? marchio : maiuscoleIniziali(r.name || 'Distributore')
  return {
    id_fonte: String(r.id),
    nome,
    marchio: marchio !== nome ? marchio : null,
    ...dividiIndirizzo(r.address),
    lat: r.location.lat,
    lon: r.location.lng,
    prodotti,
    prezzi: prezziMimit(r.fuels),
    prezzi_il: r.insertDate ?? null,
  }
}

// Una richiesta per regione e carburante (20 in tutto), una alla volta: è un sito pubblico, niente fretta.
async function scaricaMimit() {
  const tutti = new Map<number, ImpiantoMimit>()
  for (const region of REGIONI) {
    for (const fuelId of Object.keys(ID_CARBURANTE)) {
      const r = await fetch(OSSERVATORIO, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': AGENTE },
        body: JSON.stringify({ region, province: null, town: null, fuelType: `${fuelId}-x`, priceOrder: 'asc' }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!r.ok) throw new Error(`Osservatorio: HTTP ${r.status} (regione ${region}, carburante ${fuelId})`)
      const { success, results } = (await r.json()) as { success: boolean; results: ImpiantoMimit[] }
      if (!success) throw new Error(`Osservatorio: risposta non valida (regione ${region}, carburante ${fuelId})`)
      for (const x of results) tutti.set(x.id, x)
      await new Promise((ok) => setTimeout(ok, 1000))
    }
  }
  return [...tutti.values()].map(daMimit).filter((x) => x !== null)
}

// --- OpenStreetMap (riserva) ---

// Area e intestazione sono le stesse per i distributori e per i negozi.
export const AREA_OSM = `[out:json][timeout:180];
area["ISO3166-2"~"^IT-(72|75|77|78|82)$"]->.sud;`
const QUERY_OSM = `${AREA_OSM}
nwr["amenity"="fuel"]["access"!="private"](area.sud);
out center tags;`

// Se un server non risponde si prova il successivo.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

export interface ElementoOsm {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

// Benzina e gasolio ci sono salvo indicazione contraria; GPL e metano solo se indicati.
export function daOsm(e: ElementoOsm): Impianto | null {
  const t = Object.fromEntries(Object.entries(e.tags ?? {}).map(([k, v]) => [k, v.trim()]))
  const lat = e.lat ?? e.center?.lat
  const lon = e.lon ?? e.center?.lon
  if (lat == null || lon == null || t.disused === 'yes') return null
  const prodotti: Prodotto[] = []
  if (t['fuel:octane_95'] !== 'no') prodotti.push('benzina')
  if (t['fuel:diesel'] !== 'no') prodotti.push('gasolio')
  if (t['fuel:lpg'] === 'yes') prodotti.push('gpl')
  if (t['fuel:cng'] === 'yes') prodotti.push('metano')
  if (!prodotti.length) return null
  const marchio = t.brand || t.operator || null
  const nome = t.name || marchio || 'Distributore'
  const comune = t['addr:city'] || null
  return {
    id_fonte: `${e.type}/${e.id}`,
    nome,
    marchio: marchio !== nome ? marchio : null,
    indirizzo: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || null,
    comune: comuneUfficiale(comune, t['addr:province'] || null) ?? comune,
    provincia: t['addr:province'] || null,
    lat,
    lon,
    prodotti,
  }
}

export async function scaricaOverpass<T>(query: string, converti: (e: ElementoOsm) => T | null): Promise<T[]> {
  const errori: string[] = []
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: { 'user-agent': AGENTE },
        signal: AbortSignal.timeout(240_000),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return ((await r.json()).elements as ElementoOsm[]).map(converti).filter((x) => x !== null)
    } catch (e) {
      errori.push(`${new URL(url).host}: ${(e as Error).message}`)
    }
  }
  throw new Error(`nessun server Overpass ha risposto (${errori.join('; ')})`)
}

// --- Salvataggio ---

export type Fonte = 'mimit' | 'osm' | 'osm-negozi'
// Quando arriva una fonte, quelle che sostituisce si spengono: niente doppioni sulla mappa.
const SOSTITUISCE: Record<Fonte, string[]> = { mimit: ['osm', 'osm-demo'], osm: ['osm-demo'], 'osm-negozi': [] }

// Aggiorna i punti di una fonte (distributori o negozi) e disattiva quelli spariti. Se ne arrivano meno della metà di quelli attivi
// (risposta troncata, servizio cambiato) non tocca niente: meglio i dati di ieri che una mappa vuota.
export async function salvaImpianti(impianti: Impianto[], fonte: Fonte, tipo: TipoPunto = 'distributore') {
  return db.transaction().execute(async (tx) => {
    const fonti = [fonte, ...SOSTITUISCE[fonte]]
    const { rows: [{ attivi }] } = await sql<{ attivi: number }>`
      select count(*)::int as attivi from punti where attivo and fonte = any(${fonti})
    `.execute(tx)
    if (impianti.length < attivi / 2) {
      throw new Error(`${fonte}: solo ${impianti.length} punti contro ${attivi} attivi, importazione scartata`)
    }
    for (let i = 0; i < impianti.length; i += 2000) {
      await sql`
        insert into punti (nome, marchio, indirizzo, comune, provincia, geom, prodotti, tipo, fonte, id_fonte, prezzi_comunicati_il)
        select x.nome, x.marchio, x.indirizzo, x.comune, x.provincia, ST_MakePoint(x.lon, x.lat)::geography, x.prodotti, ${tipo}, ${fonte}, x.id_fonte, x.prezzi_il
        from json_to_recordset(${JSON.stringify(impianti.slice(i, i + 2000).map(({ prezzi: _, ...x }) => x))}::json)
          as x(id_fonte text, nome text, marchio text, indirizzo text, comune text, provincia text, lat float8, lon float8, prodotti text[], prezzi_il timestamptz)
        on conflict (fonte, id_fonte) do update set
          nome = excluded.nome, marchio = excluded.marchio, indirizzo = excluded.indirizzo, comune = excluded.comune,
          provincia = excluded.provincia, geom = excluded.geom, prodotti = excluded.prodotti, prezzi_comunicati_il = excluded.prezzi_comunicati_il,
          attivo = true, aggiornato_il = now()
      `.execute(tx)
    }
    // Comune e provincia dei negozi li danno i confini ISTAT, nella stessa transazione: mai un negozio senza comune a metà.
    if (tipo === 'negozio') await assegnaComuniNegozi(tx)
    // I prezzi della fonte si sostituiscono tutti: valgono solo quelli comunicati per ultimi.
    const prezzi = impianti.flatMap((x) => (x.prezzi ?? []).map((p) => ({ id_fonte: x.id_fonte, ...p })))
    if (prezzi.length) {
      await sql`delete from prezzi where punto_id in (select id from punti where fonte = ${fonte})`.execute(tx)
      for (let i = 0; i < prezzi.length; i += 5000) {
        await sql`
          insert into prezzi (punto_id, prodotto, self, prezzo)
          select p.id, x.prodotto::prodotto, x.self, x.prezzo
          from json_to_recordset(${JSON.stringify(prezzi.slice(i, i + 5000))}::json) as x(id_fonte text, prodotto text, self boolean, prezzo numeric)
          join punti p on p.fonte = ${fonte} and p.id_fonte = x.id_fonte
          on conflict do nothing
        `.execute(tx)
      }
    }
    // Spariti dalla fonte: non si cancellano mai, le segnalazioni li citano.
    // now() nella transazione è il suo istante d'inizio: quelli appena aggiornati hanno proprio quell'ora.
    const spenti = await tx.updateTable('punti').set({ attivo: false })
      .where('fonte', '=', fonte).where('aggiornato_il', '<', sql<Date>`now()`).where('attivo', '=', true).executeTakeFirst()
    // `in ()` vuoto non è SQL valido: i negozi non sostituiscono nessuna fonte.
    if (SOSTITUISCE[fonte].length) {
      await tx.updateTable('punti').set({ attivo: false }).where('fonte', 'in', SOSTITUISCE[fonte]).where('attivo', '=', true).execute()
    }
    return { fonte, importati: impianti.length, disattivati: Number(spenti.numUpdatedRows) }
  })
}

// Prima il Ministero; se non risponde e non abbiamo ancora i suoi dati, OpenStreetMap.
export async function aggiornaDistributori({ soloOsm = false } = {}) {
  let errore: Error | null = null
  if (!soloOsm) {
    try {
      const mimit = await scaricaMimit()
      return registra(await salvaImpianti(mimit, 'mimit'), mimit)
    } catch (e) {
      errore = e as Error
      const { rows: [{ n }] } = await sql<{ n: number }>`select count(*)::int as n from punti where attivo and fonte = 'mimit'`.execute(db)
      if (n) throw new Error(`Ministero non aggiornato, restano i dati precedenti: ${errore.message}`)
    }
  }
  const osm = await scaricaOverpass(QUERY_OSM, daOsm)
  const esito = registra(await salvaImpianti(osm, 'osm'), osm)
  if (errore) console.error(`Ministero non disponibile (${errore.message}): usato OpenStreetMap`)
  return esito
}

function registra(esito: Awaited<ReturnType<typeof salvaImpianti>>, impianti: Impianto[]) {
  console.log(`distributori (${esito.fonte}): ${esito.importati} aggiornati, ${esito.disattivati} disattivati`)
  // Una fusione più recente dei file ISTAT o una grafia nuova: vedi comuni-istat.ts.
  const ignoti = comuniIgnoti(impianti)
  if (ignoti.length) console.log(`comuni non riconosciuti (${ignoti.length}): ${ignoti.slice(0, 30).join(', ')}${ignoti.length > 30 ? '…' : ''}`)
  return esito
}

// Il server la chiama ogni ora: aggiorna solo se l'ultimo aggiornamento ha più di 20 ore,
// così dopo un riavvio o un errore riprova da solo senza tempestare le fonti.
export async function aggiornaSeVecchio() {
  const { rows: [{ ultimo }] } = await sql<{ ultimo: Date | null }>`
    select max(aggiornato_il) as ultimo from punti where fonte in ('mimit', 'osm') and attivo
  `.execute(db)
  if (ultimo && Date.now() - ultimo.getTime() < 20 * 60 * 60 * 1000) return null
  return aggiornaDistributori()
}

if (process.argv[1] === import.meta.filename) {
  await aggiornaDistributori({ soloOsm: process.argv.includes('--osm') })
  await db.destroy()
}
