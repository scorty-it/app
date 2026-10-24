// Chiamate all'API di Scorty.
// Il telefono ha un identificativo anonimo (token): lo ottiene una volta risolvendo una piccola sfida di calcolo.
import { indirizzoBollettino } from './bollettino.ts'
import type { Limiti, PuntoMappa } from './sintesi.ts'
import type { corpoVisita } from './visita.ts'
import { ciVadoSuperstite } from './visite.ts'
import { CI_VADO_MINUTI, type Correzione, type LivelloCoda, type MiaCiVado, type MiaCoda, type MiaSegnalazione, type Posizione, type Prodotto, type Punto, type Stato, type StatoPunto, type TipoPunto } from './tipi.ts'

const CHIAVE = 'scorty-dispositivo'
const mie = new Set<number>() // le mie segnalazioni: non si possono confermare
const ascoltatori = new Set<(s: StatoPunto) => void>()
let inArrivo: Promise<string> | null = null

function salvato() {
  try {
    return localStorage.getItem(CHIAVE)
  } catch {
    return null
  }
}
function salva(t: string | null) {
  try {
    if (t) localStorage.setItem(CHIAVE, t)
    else localStorage.removeItem(CHIAVE)
  } catch {
    // dati del sito bloccati: il token vale fino alla chiusura della pagina
  }
}

function zeriIniziali(h: Uint8Array) {
  let n = 0
  for (const b of h) {
    if (b) return n + Math.clz32(b) - 24
    n += 8
  }
  return n
}

let inMemoria: string | null = null
async function nuovoToken() {
  const s = await chiama<{ sfida: string; firma: string; bit: number }>('/api/sfida')
  const testo = new TextEncoder()
  let nonce = 0
  while (zeriIniziali(new Uint8Array(await crypto.subtle.digest('SHA-256', testo.encode(s.sfida + nonce)))) < s.bit) nonce++
  const { token } = await chiama<{ token: string }>('/api/dispositivo', { sfida: s.sfida, firma: s.firma, nonce })
  inMemoria = token
  salva(token)
  return token
}

// Una sola richiesta anche se più azioni partono insieme.
function token() {
  const t = inMemoria ?? salvato()
  if (t) return Promise.resolve(t)
  return (inArrivo ??= nuovoToken().finally(() => (inArrivo = null)))
}

async function chiama<T>(url: string, corpo?: object, conToken = false, riprova = true): Promise<T> {
  const headers: Record<string, string> = {}
  if (corpo) headers['content-type'] = 'application/json'
  if (conToken) headers.authorization = `Bearer ${await token()}`
  const r = await fetch(url, { method: corpo ? 'POST' : 'GET', headers, body: corpo && JSON.stringify(corpo) })
  if (r.status === 401 && conToken && riprova) {
    // Token non più valido (per esempio il server ha cambiato segreto): se ne prende uno nuovo.
    inMemoria = null
    salva(null)
    return chiama(url, corpo, conToken, false)
  }
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? 'Qualcosa non ha funzionato. Riprova tra poco.')
  return r.json()
}

const conMie = (s: StatoPunto): StatoPunto => ({ ...s, prodotti: s.prodotti.map((p) => ({ ...p, mia: mie.has(p.segnalazione_id) })) })
const diffondi = (s: StatoPunto) => ascoltatori.forEach((f) => f(conMie(s)))

// All'avvio: identificativo pronto prima della prima segnalazione, e l'elenco delle mie.
export async function prepara() {
  // L'etichetta del link da cui si arriva (scorty.it/?da=whatsapp) si legge subito e si toglie dall'indirizzo,
  // così chi ricondivide la pagina non la ricopia e un ricaricamento non la conta due volte.
  const indirizzo = new URL(location.href)
  const da = indirizzo.searchParams.get('da')?.slice(0, 64)
  if (indirizzo.searchParams.has('da')) {
    indirizzo.searchParams.delete('da')
    history.replaceState(history.state, '', indirizzo)
  }
  await token()
  // Una visita per apertura dell'app: il server somma e basta, non salva chi.
  const installata = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  chiama('/api/visita', { installata, ...(da && { da }) }, true).catch(() => {})
  await mieSegnalazioni()
}

// I distributori più vicini a un punto della mappa, con il loro stato; con i limiti, solo quelli nella zona inquadrata.
export async function caricaVicini(centro: Posizione, n: number, prodotto: Prodotto | null, tipo: TipoPunto, limiti?: Limiti) {
  const q = new URLSearchParams({ lat: centro.lat.toFixed(5), lon: centro.lon.toFixed(5), n: String(n), tipo })
  if (prodotto) q.set('prodotto', prodotto)
  if (limiti) (['ovest', 'sud', 'est', 'nord'] as const).forEach((k, i) => q.set(k, limiti[i].toFixed(5)))
  const r = await chiama<{ punto: Punto; stato: StatoPunto | null }[]>(`/api/vicini?${q}`)
  return r.map((x) => ({ punto: x.punto, stato: x.stato && conMie(x.stato) }))
}

// La mappa da lontano: tutti i distributori in forma compatta e lo stato di quelli con notizie.
export async function caricaMappa(tipo: TipoPunto) {
  const r = await chiama<{ punti: PuntoMappa[]; stati: StatoPunto[] }>(`/api/mappa?tipo=${tipo}`)
  return { punti: r.punti, stati: r.stati.map(conMie) }
}

// Aggiornamenti in tempo reale. EventSource si ricollega da solo se la rete cade.
let eventi: EventSource | null = null
export function ascolta(f: (s: StatoPunto) => void) {
  ascoltatori.add(f)
  if (!eventi) {
    eventi = new EventSource('/api/eventi')
    eventi.onmessage = (e) => diffondi(JSON.parse(e.data))
  }
  return () => {
    ascoltatori.delete(f)
    if (!ascoltatori.size) {
      eventi?.close()
      eventi = null
    }
  }
}

// Il server registra l'apertura della scheda per "vista da N persone" e per la stima della coda in aumento.
export function apriScheda(puntoId: number) {
  chiama('/api/viste', { punto_id: puntoId }, true).catch(() => {})
}

// minutiFa conta solo a distanza: sul posto si segnala adesso.
export async function segnala(puntoId: number, prodotto: Prodotto, stato: Stato, pos: Posizione, minutiFa = 0) {
  const r = await chiama<{ segnalazione_id: number; stato: StatoPunto }>(
    '/api/segnalazioni', { punto_id: puntoId, prodotto, stato, lat: pos.lat, lon: pos.lon, minuti_fa: minutiFa }, true,
  )
  mie.add(r.segnalazione_id)
  chiudiCiVadoQui(puntoId)
  diffondi(r.stato)
}

// Una visita a un negozio: tutte le categorie e la coda in un colpo solo, che per il limite orario conta come una azione.
// minutiFa conta solo a distanza.
export async function inviaVisita(puntoId: number, corpo: NonNullable<ReturnType<typeof corpoVisita>>, pos: Posizione, minutiFa = 0) {
  const r = await chiama<{ segnalazioni: number[]; stato: StatoPunto }>(
    '/api/visite', { punto_id: puntoId, ...corpo, lat: pos.lat, lon: pos.lon, minuti_fa: minutiFa }, true,
  )
  r.segnalazioni.forEach((id) => mie.add(id))
  chiudiCiVadoQui(puntoId)
  diffondi(r.stato)
}

export async function vota(segnalazioneId: number, conferma: boolean, pos: Posizione) {
  const r = await chiama<{ stato: StatoPunto }>('/api/voti', { segnalazione_id: segnalazioneId, conferma, lat: pos.lat, lon: pos.lon }, true)
  chiudiCiVadoQui(r.stato.punto_id)
  diffondi(r.stato)
}

export async function segnalaCoda(puntoId: number, livello: LivelloCoda, pos: Posizione) {
  const r = await chiama<{ stato: StatoPunto }>('/api/code', { punto_id: puntoId, livello, lat: pos.lat, lon: pos.lon }, true)
  chiudiCiVadoQui(puntoId)
  diffondi(r.stato)
}

export async function mieSegnalazioni() {
  const r = await chiama<{ segnalazioni: MiaSegnalazione[]; code: MiaCoda[]; ci_vado: MiaCiVado | null }>('/api/mie', undefined, true)
  r.segnalazioni.forEach((m) => mie.add(m.id))
  miaCiVado = r.ci_vado
  return r
}

// Il «Ci vado» attivo di questo telefono, come l'ha detto il server all'ultima lettura di /api/mie.
let miaCiVado: MiaCiVado | null = null
const chiudiCiVadoQui = (puntoId: number) => void (miaCiVado = ciVadoSuperstite(miaCiVado, puntoId))
export const mioCiVado = (ora = Date.now()) =>
  miaCiVado && ora - Date.parse(miaCiVado.creato_il) < CI_VADO_MINUTI * 60000 ? miaCiVado : null

// Un negozio vuole da 1 a 7 categorie, un distributore nessuna. Un nuovo «Ci vado» sostituisce il precedente.
// La posizione serve solo al controllo dei 30 km, il server non la salva.
export async function ciVado(puntoId: number, prodotti: Prodotto[], pos: Posizione) {
  const r = await chiama<{ stato: StatoPunto }>('/api/ci-vado', { punto_id: puntoId, prodotti, lat: pos.lat, lon: pos.lon }, true)
  diffondi(r.stato)
  await mieSegnalazioni().catch(() => {}) // la scheda legge da qui il «Ci vado» attivo
}

export async function annullaCiVado() {
  const r = await chiama<{ stato: StatoPunto | null }>('/api/ci-vado/annulla', {}, true)
  miaCiVado = null
  if (r.stato) diffondi(r.stato)
}

// Completare o correggere la propria visita, per un'ora, anche lontano dal distributore.
async function modifica(id: number, azione: string, corpo: object = {}) {
  const r = await chiama<{ segnalazione_id?: number; stato: StatoPunto }>(`/api/segnalazioni/${id}/${azione}`, corpo, true)
  if (r.segnalazione_id) mie.add(r.segnalazione_id)
  diffondi(r.stato)
}
export const correggi = (id: number, stato: Stato) => modifica(id, 'correggi', { stato })
export const aggiungiCarburante = (id: number, prodotto: Prodotto, stato: Stato) => modifica(id, 'aggiungi', { prodotto, stato })
export const aggiungiCoda = (id: number, livello: LivelloCoda) => modifica(id, 'coda', { livello })
export const annullaVisita = (id: number) => modifica(id, 'annulla')

export async function inviaCorrezione(c: Correzione) {
  await chiama('/api/correzioni', c)
}

export interface Provincia {
  provincia: string // sigla
  distributori: number
  lat: number
  lon: number
  verde: number
  giallo: number
  rosso: number
  spesa?: { negozi: number; con_notizie: number; comuni_senza: number } // manca se il server non è ancora aggiornato
}

export const caricaProvince = () => chiama<Provincia[]>('/api/province')

// Il bollettino di una provincia, comune per comune: la regola dei gruppi è nel server (api/src/bollettino.ts).
export interface ComuneBollettino {
  comune: string
  distributori: number
  verde: number
  giallo: number
  rosso: number
  ultima: string | null // ISO
  lat: number
  lon: number
  gruppo: 'senza_carburante' | 'con_notizie' | 'senza_notizie'
  confermato: boolean // solo per i senza carburante: false vuol dire «da confermare»
}

// La spesa di una provincia, dallo stesso calcolo del server (api/src/bollettino.ts).
export interface ComuneSenzaBene {
  comune: string
  confermato: boolean // false vuol dire «da confermare»
}

export interface BeneSenza {
  bene: Prodotto
  comuni: ComuneSenzaBene[] // prima i confermati, poi in ordine alfabetico
}

export interface SpesaBollettino {
  negozi: number // tutti i negozi della provincia, anche senza comune
  con_notizie: number // quelli con almeno un bene dallo stato noto nelle ultime 24 ore
  beni: BeneSenza[] // solo i beni con almeno un comune senza, nell'ordine di BENI
}

export interface BollettinoProvincia {
  provincia: string // sigla
  aggiornato_il: string // ISO, quando il server l'ha calcolato
  distributori: number
  verde: number
  giallo: number
  rosso: number
  lat: number
  lon: number
  comuni: ComuneBollettino[]
  andamento?: FotografiaProvincia[] // ultime 24 ore, dalla più vecchia; manca se il server non è ancora aggiornato
  spesa?: SpesaBollettino // manca se il server non è ancora aggiornato
}

// Una fotografia oraria della provincia (api/db/migrazioni/009_andamento.sql, 012_andamento_spesa.sql e 014_spesa_con_notizie.sql).
export interface FotografiaProvincia {
  ora: string // ISO, ora piena
  comuni_senza: number
  comuni_senza_confermati: number
  con_notizie: number
  verde: number
  giallo: number
  rosso: number
  spesa_comuni_senza: number | null // null: fotografia di prima della spesa, un buco nel grafico e non uno zero
  spesa_comuni_senza_confermati: number | null
  // Quanti negozi avevano notizie in quell'ora. 0: nessuna notizia, e allora gli zeri della spesa sono un buco; null: fotografia di prima
  // di questo dato. Facoltativo: un server vecchio non lo manda.
  spesa_con_notizie?: number | null
}

// I canali Telegram degli avvisi, uno per regione: solo quelli in cui il bot scrive davvero (api/src/avvisi.ts).
export interface CanaleAvvisi {
  regione: string
  canale: string // @scorty_campania
  link: string // https://t.me/scorty_campania
}
export const caricaCanaliAvvisi = () => chiama<CanaleAvvisi[]>('/api/avvisi/canali')

export const caricaBollettino =(sigla: string) => chiama<BollettinoProvincia>(indirizzoBollettino(sigla, Date.now()))

export interface Luogo {
  nome: string
  dettaglio: string | null
  lat: number
  lon: number
  zoom: number
  distributori?: number // solo per i comuni
}

export interface Trovato {
  punto: Punto
  metri: number
  stato: StatoPunto | null
}

// Ricerca mentre si scrive: chi chiama annulla la richiesta precedente con il segnale.
// Il server cerca nel mondo di `tipo`, ma se la frase lo nomina («latte vomero») vince la frase: la risposta dice quale.
// La chiave resta `distributori` anche per i negozi.
export async function cerca(q: string, centro: Posizione, tipo: TipoPunto, signal: AbortSignal) {
  const qs = new URLSearchParams({ q, lat: centro.lat.toFixed(3), lon: centro.lon.toFixed(3), tipo })
  const r = await fetch(`/api/cerca?${qs}`, { signal })
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? 'Ricerca non riuscita. Riprova.')
  const d = (await r.json()) as { luoghi: Luogo[]; distributori: Trovato[]; prodotto?: Prodotto | null; tipo?: TipoPunto }
  return {
    luoghi: d.luoghi,
    distributori: d.distributori.map((t) => ({ ...t, stato: t.stato && conMie(t.stato) })),
    prodotto: d.prodotto ?? null,
    tipo: d.tipo ?? tipo,
  }
}

export interface Prezzo {
  prodotto: Prodotto
  self: boolean
  prezzo: number
}

// Prezzi comunicati al Ministero: cambiano una volta al giorno.
export const caricaPrezzi = (puntoId: number) =>
  chiama<{ prezzi: Prezzo[]; comunicati_il: string | null }>(`/api/prezzi/${puntoId}`)
