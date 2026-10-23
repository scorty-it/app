export type Carburante = 'benzina' | 'gasolio' | 'gpl' | 'metano'
export type Bene = 'acqua' | 'latte' | 'pane' | 'frutta_verdura' | 'pasta_riso' | 'carne_pesce' | 'neonati'
export type Prodotto = Carburante | Bene
// I due mondi dell'app e il tipo di punto che mostrano.
export type Mondo = 'carburante' | 'spesa'
export type TipoPunto = 'distributore' | 'negozio'
export type Stato = 'disponibile' | 'scarso' | 'esaurito'
export type LivelloCoda = 'nessuna' | 'breve' | 'lunga'
export type Affidabilita = 'affidabile' | 'da_confermare' | 'incerto'

// PRODOTTI sono i carburanti; BENI le categorie della spesa; TUTTI_I_PRODOTTI nell'ordine dei bit di /api/mappa.
export const PRODOTTI: Carburante[] = ['benzina', 'gasolio', 'gpl', 'metano']
export const BENI: Bene[] = ['acqua', 'latte', 'pane', 'frutta_verdura', 'pasta_riso', 'carne_pesce', 'neonati']
export const TUTTI_I_PRODOTTI: Prodotto[] = [...PRODOTTI, ...BENI]
export const PRODOTTI_DI: Record<Mondo, Prodotto[]> = { carburante: PRODOTTI, spesa: BENI }
export const tipoDi = (m: Mondo): TipoPunto => (m === 'spesa' ? 'negozio' : 'distributore')
export const mondoDi = (t: TipoPunto): Mondo => (t === 'negozio' ? 'spesa' : 'carburante')
export const NOME_PRODOTTO: Record<Prodotto, string> = {
  benzina: 'Benzina', gasolio: 'Gasolio', gpl: 'GPL', metano: 'Metano',
  acqua: 'Acqua', latte: 'Latte', pane: 'Pane', frutta_verdura: 'Frutta e verdura', pasta_riso: 'Pasta e riso', carne_pesce: 'Carne e pesce', neonati: 'Neonati',
}
export const nomeInFrase = (p: Prodotto) => (p === 'gpl' ? 'GPL' : NOME_PRODOTTO[p].toLowerCase())
export const NOME_STATO: Record<Stato, string> = { disponibile: 'Disponibile', scarso: 'Scarso', esaurito: 'Finito' }
// Per la spesa le stesse tre voci si leggono «C’è», «Poco», «Finito».
export const NOME_STATO_SPESA: Record<Stato, string> = { disponibile: 'C’è', scarso: 'Poco', esaurito: 'Finito' }
export const nomeStato = (s: Stato, m: Mondo) => (m === 'spesa' ? NOME_STATO_SPESA : NOME_STATO)[s]
export const NOME_CODA: Record<LivelloCoda, string> = { nessuna: 'Nessuna', breve: 'Breve', lunga: 'Lunga' }

// I marchi più diffusi al Sud nei dati dei distributori; il resto va in "Altro".
export const MARCHI = ['Eni', 'Q8', 'IP', 'Esso', 'Tamoil', 'TotalErg', 'Api', 'Repsol', 'Shell', 'Giap', 'Energas', 'Lukoil', 'Pompa bianca', 'Altro']

// Il marchio attuale del distributore, se è tra quelli dell'elenco.
export function marchioNoto(p: Pick<Punto, 'marchio' | 'nome'>) {
  const t = `${p.marchio ?? ''} ${p.nome}`.toLowerCase()
  if (/\b(agip|eni|enilive)\b/.test(t)) return 'Eni'
  if (/\bip\b/.test(t)) return 'IP' // anche "Api-Ip"
  if (/pompe? bianc|indipenden|independent/.test(t)) return 'Pompa bianca'
  if (/\btotal/.test(t)) return 'TotalErg'
  return MARCHI.find((m) => new RegExp(`\\b${m.toLowerCase()}\\b`).test(t)) ?? ''
}

export interface Posizione {
  lat: number
  lon: number
}

export interface Punto extends Posizione {
  id: number
  tipo: TipoPunto
  nome: string
  marchio: string | null
  indirizzo: string | null
  comune: string | null
  prodotti: Prodotto[]
}

export interface StatoProdotto {
  prodotto: Prodotto
  stato: Stato
  affidabilita: Affidabilita
  persone: number // dispositivi diversi che sostengono lo stato
  smentite: number
  ultimo: string // ISO, prova più recente
  segnalazione_id: number // la segnalazione su cui si vota
  mia?: boolean // fatta da questo dispositivo: non si può confermare
  rifornito?: boolean // passato da finito a disponibile
  a_distanza?: boolean // segnalato da chi è passato da poco, non sul posto: conta la metà
}

export interface StatoPunto {
  punto_id: number
  tipo: TipoPunto
  prodotti: StatoProdotto[] // solo i prodotti con dati nelle ultime 24 ore
  coda: { livello: LivelloCoda; persone: number; ultimo: string } | null
  interesse: number // persone che hanno aperto la scheda negli ultimi 30 minuti
  arrivi: number // persone con un «Ci vado» attivo qui
  arrivi_per: Partial<Record<Prodotto, number>> // per categoria, solo negozi
  stima: { coda_in_aumento: boolean; potrebbe_finire: Prodotto[] } // calcolata dal server
  calcolato_il: number // ms: tra due versioni dello stesso punto vince la più recente
}

export interface Alternativa {
  punto: Punto
  metri: number
  stato: StatoProdotto
}

export interface MiaSegnalazione {
  id: number
  punto: Punto
  prodotto: Prodotto
  stato: Stato
  creata_il: string // quando l'hai inviata: da qui parte l'ora per completarla
  visto_il: string // quando hai visto il distributore
  a_distanza: boolean
  viste: number
}

export interface MiaCiVado {
  punto: Punto
  prodotti: Prodotto[]
  creato_il: string
}

export const CI_VADO_MINUTI = 60 // quanto vale un «Ci vado»

export interface MiaCoda {
  punto_id: number
  livello: LivelloCoda
  creata_il: string
}

export const MODIFICA_MINUTI = 60 // per quanto si può completare o correggere la propria visita

export interface Correzione {
  punto_id: number
  tipo: 'dati_errati' | 'chiuso' | 'gestore' | 'altro'
  marchio: string | null // scelto da un elenco: aiuta a ritrovare e correggere il distributore
  messaggio: string
  contatto: string
}
