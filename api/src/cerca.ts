// Ricerca: comuni e distributori dal nostro database (tollerante agli errori di battitura),
// indirizzi e luoghi da Photon (komoot, dati OpenStreetMap). A Photon vanno solo il testo cercato e una zona
// di circa 10 km, chiesti dal nostro server: l'indirizzo IP di chi cerca non esce da Scorty.
import { sql } from 'kysely'
import { db, type Prodotto, type TipoPunto } from './db.ts'

export interface Centro {
  lat: number
  lon: number
}

export interface Luogo {
  nome: string
  dettaglio: string | null
  lat: number
  lon: number
  zoom: number
  distributori?: number // solo per i comuni: quanti ne conosciamo
}

// Parole che dicono cosa si cerca, non dove: "benzinaio vomero" cerca a Vomero, "gpl napoli" solo il GPL a Napoli.
const INTENTO = new Set([
  'benzinaio', 'benzinai', 'distributore', 'distributori', 'pompa', 'pompe', 'carburante', 'carburanti', 'rifornimento',
  'servizio', 'self', 'vicino', 'vicini', 'presso', 'zona', 'dove', 'trova', 'cerca',
  'di', 'da', 'in', 'al', 'alla', 'nel', 'nei', 'il', 'la', 'lo', 'le', 'gli', 'un', 'una', 'per',
])
const CARBURANTE: Record<string, Prodotto> = { benzina: 'benzina', verde: 'benzina', gasolio: 'gasolio', diesel: 'gasolio', gpl: 'gpl', metano: 'metano' }
// Le parole d'intento che dicono in quale mondo si cerca: «benzinaio vomero» sono i distributori, «supermercato vomero» i negozi.
const INTENTO_CARBURANTE = new Set(['benzinaio', 'benzinai', 'distributore', 'distributori', 'pompa', 'pompe', 'carburante', 'carburanti', 'rifornimento'])
const INTENTO_SPESA = new Set(['supermercato', 'supermercati', 'alimentari', 'spesa', 'negozio', 'negozi', 'discount', 'market', 'minimarket'])
// «verde» è benzina e «verdura» è frutta_verdura: sono parole intere, mai prefissi.
const BENE: Record<string, Prodotto> = {
  acqua: 'acqua', latte: 'latte', pane: 'pane', frutta: 'frutta_verdura', verdura: 'frutta_verdura', pasta: 'pasta_riso', riso: 'pasta_riso',
  carne: 'carne_pesce', pesce: 'carne_pesce', pannolini: 'neonati', neonati: 'neonati', omogeneizzati: 'neonati',
}
const VIA = /^(via|viale|corso|piazza|piazzale|largo|vico|vicolo|strada|contrada|localita|lungomare|traversa|rione|ss|sp)$/

export interface Domanda {
  mondo: 'carburante' | 'spesa' | null // null: la frase non lo dice (un indirizzo, un comune), vale il mondo aperto
  parole: string[] // cosa resta per il luogo o il nome, senza accenti né punteggiatura
  testo: string
  prodotto: Prodotto | null
  indirizzo: boolean // contiene un numero civico o comincia con "via", "corso"...: prima gli indirizzi
}

export const normalizza = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

export function interpreta(q: string): Domanda {
  const tutte = normalizza(q)
  const prodotto = tutte.map((p) => CARBURANTE[p] ?? BENE[p]).find(Boolean) ?? null
  // Il primo indizio decide: un prodotto vale quanto una parola d'intento.
  const mondo = tutte.map((p) => (CARBURANTE[p] || INTENTO_CARBURANTE.has(p) ? 'carburante' : BENE[p] || INTENTO_SPESA.has(p) ? 'spesa' : null)).find(Boolean) ?? null
  const parole = tutte.filter((p) => p.length >= 2 && !INTENTO.has(p) && !INTENTO_SPESA.has(p) && !CARBURANTE[p] && !BENE[p]).slice(0, 5)
  // Un numero civico è fatto di sole cifre (e al più una lettera): "Q8" non lo è.
  return { mondo, parole, testo: parole.join(' '), prodotto, indirizzo: parole.some((p) => /^\d+[a-z]?$/.test(p)) || VIA.test(parole[0] ?? '') }
}

// Più una parola è corta, più deve somigliare: "eni" non deve trovare "Energas", "pozzoli" deve trovare "Pozzuoli".
export const soglia = (parola: string) => (parola.length <= 4 ? 0.6 : 0.45)

const centroSql = (c: Centro) => sql`ST_MakePoint(${c.lon}, ${c.lat})::geography`
const vende = (prodotto: Prodotto | null) => (prodotto ? sql`and ${prodotto} = any(prodotti)` : sql``)

type Riga = { id: number; nome: string; tipo: TipoPunto; marchio: string | null; indirizzo: string | null; comune: string | null; lat: number; lon: number; prodotti: Prodotto[]; metri: number }

// Ogni parola deve comparire (anche con qualche errore) nel nome, marchio, indirizzo o comune.
// Ordine: somiglianza media, più un premio se il comune corrisponde, meno una piccola penalità per la distanza
// dal centro della mappa (fino a 0,25 a 200 km). Senza parole ("benzinaio", "gpl"): i più vicini.
export async function cercaDistributori(d: Domanda, centro: Centro, tipo: TipoPunto) {
  const colonne = sql`id, nome, tipo, marchio, indirizzo, comune, ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lon, prodotti,
    ST_Distance(geom, ${centroSql(centro)}) as metri`
  let righe: Riga[]
  if (!d.parole.length) {
    righe = (await sql<Riga>`
      select ${colonne} from punti where attivo and tipo = ${tipo} ${vende(d.prodotto)}
      order by geom <-> ${centroSql(centro)} limit 6
    `.execute(db)).rows
  } else {
    const somiglianza = sql.join(d.parole.map((x) => sql`word_similarity(scorty_norm(${x}), ricerca)`), sql` + `)
    righe = (await sql<Riga>`
      select ${colonne} from punti
      where attivo and tipo = ${tipo} ${vende(d.prodotto)} and ${sql.join(d.parole.map((x) => sql`word_similarity(scorty_norm(${x}), ricerca) >= ${soglia(x)}`), sql` and `)}
      order by (${somiglianza}) / ${d.parole.length}
        + 0.2 * word_similarity(${d.testo}, scorty_norm(coalesce(comune, '')))
        - least(ST_Distance(geom, ${centroSql(centro)}) / 1000, 200) / 800 desc
      limit 6
    `.execute(db)).rows
  }
  return righe.map(({ metri, ...punto }) => ({ punto, metri: Math.round(metri) }))
}

// Comuni in cui conosciamo distributori (solo quelli: il numero va nella riga del comune, e i negozi lo gonfierebbero). Un comune entra se il suo nome sta nella frase ("eni pozzuoli",
// "via toledo napoli") o se una parola di almeno 4 lettere ne è l'inizio o quasi ("pozz", "cava", "pozzoli", "napli").
// Si tengono solo quelli vicini al migliore: "salerno" non deve proporre anche Salemi.
export async function cercaComuni(d: Domanda, centro: Centro): Promise<Luogo[]> {
  if (!d.parole.length) return []
  // In un indirizzo conta solo il comune scritto per intero: "corso umberto bari" non deve proporre Castell'Umberto.
  const lunghe = d.indirizzo ? [] : d.parole.filter((p) => p.length >= 4)
  const nellaFrase = sql`word_similarity(scorty_norm(comune), ${d.testo})`
  const perParola = lunghe.map((p) => sql`word_similarity(${p}, scorty_norm(comune))`)
  const copertura = perParola.length ? sql`greatest(${nellaFrase}, ${sql.join(perParola)})` : nellaFrase
  const { rows } = await sql<{ comune: string; provincia: string | null; distributori: number; lat: number; lon: number; punteggio: number }>`
    with c as (
      select comune, provincia, count(*)::int as distributori, avg(ST_Y(geom::geometry)) as lat, avg(ST_X(geom::geometry)) as lon,
        min(ST_Distance(geom, ${centroSql(centro)})) as metri
      from punti where attivo and tipo = 'distributore' and comune is not null group by comune, provincia
    )
    select *, ${copertura} + similarity(scorty_norm(comune), ${d.testo}) as punteggio from c
    where ${nellaFrase} >= 0.6 ${perParola.length ? sql`or ${sql.join(lunghe.map((p, i) => sql`${perParola[i]} >= ${p.length >= 5 ? 0.45 : 0.6}`), sql` or `)}` : sql``}
    order by punteggio desc, metri
    limit 3
  `.execute(db)
  const migliore = rows[0]?.punteggio ?? 0
  return rows
    .filter((r) => r.punteggio >= migliore - 0.35)
    .map((r) => ({ nome: r.comune, dettaglio: r.provincia, lat: r.lat, lon: r.lon, zoom: 13, distributori: r.distributori }))
}

interface Photon {
  geometry: { coordinates: [number, number] }
  properties: { name?: string; street?: string; housenumber?: string; city?: string; county?: string; type?: string; osm_value?: string }
}

const ZOOM: Record<string, number> = { city: 13, town: 13, village: 14, district: 14, locality: 15, street: 16, house: 17 }
// ponytail: cache in memoria con un tetto di voci; basta finché c'è un solo server.
const cache = new Map<string, { il: number; luoghi: Luogo[] }>()

export function daPhoton(f: Photon): Luogo | null {
  const p = f.properties
  if (p.osm_value === 'fuel') return null // i distributori li cerchiamo noi
  const via = [p.street, p.housenumber].filter(Boolean).join(' ')
  const nome = p.name || via
  if (!nome) return null
  const [lon, lat] = f.geometry.coordinates
  const dettaglio = [p.name && via, p.city || p.county].filter(Boolean).join(', ') || null
  return { nome, dettaglio, lat, lon, zoom: ZOOM[p.type ?? ''] ?? 15 }
}

export function urlPhoton(testo: string, centro: Centro) {
  const url = new URL('https://photon.komoot.io/api/')
  // Riquadro del Sud Italia e preferenza per i risultati vicini al centro della mappa, arrotondato al decimo di grado
  // (circa 10 km, come la chiave della cache): basta per i risultati vicini e non dice dov'è chi cerca.
  const zona = { lat: centro.lat.toFixed(1), lon: centro.lon.toFixed(1) }
  for (const [k, v] of Object.entries({ q: testo, limit: '5', bbox: '12.3,36.6,18.6,41.9', ...zona })) url.searchParams.set(k, v)
  return url
}

export async function cercaLuoghi(d: Domanda, centro: Centro): Promise<Luogo[]> {
  const testo = d.testo.slice(0, 100)
  if (testo.length < 3) return []
  const chiave = `${testo.toLowerCase()}|${centro.lat.toFixed(1)}|${centro.lon.toFixed(1)}`
  const salvato = cache.get(chiave)
  if (salvato && Date.now() - salvato.il < 10 * 60 * 1000) return salvato.luoghi
  try {
    const r = await fetch(urlPhoton(testo, centro), { headers: { 'user-agent': 'Scorty/1.0 (https://scorty.it)' }, signal: AbortSignal.timeout(2500) })
    if (!r.ok) return []
    const luoghi = ((await r.json()).features as Photon[]).map(daPhoton).filter((x) => x !== null)
    if (cache.size > 500) cache.delete(cache.keys().next().value!)
    cache.set(chiave, { il: Date.now(), luoghi })
    return luoghi
  } catch {
    return [] // Photon lento o giù: restano i risultati nostri
  }
}

// Un luogo di Photon il cui nome contiene tutte le parole cercate ("ospedale cardarelli") va prima dei comuni simili.
// Conta solo il nome: "Parcheggio Q8 Bar, Cava de' Tirreni" non è la risposta a "q8 cava".
export function centrato(l: Luogo, d: Domanda) {
  const nome = normalizza(l.nome).join(' ')
  return d.parole.length > 0 && d.parole.every((p) => nome.includes(p))
}

// Il comune scritto per intero nella frase ("corso umberto bari"): Photon cerca intorno a lui, non al centro della mappa.
export const comuneNominato = (comuni: Luogo[], d: Domanda) => comuni.find((c) => normalizza(c.nome).every((p) => d.parole.includes(p)))
