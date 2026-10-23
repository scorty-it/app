import pg from 'pg'
import { Kysely, PostgresDialect, type Generated } from 'kysely'

export type Prodotto =
  | 'benzina' | 'gasolio' | 'gpl' | 'metano'
  | 'acqua' | 'latte' | 'pane' | 'frutta_verdura' | 'pasta_riso' | 'carne_pesce' | 'neonati'
export type TipoPunto = 'distributore' | 'negozio'
export type Stato = 'disponibile' | 'scarso' | 'esaurito'
export type LivelloCoda = 'nessuna' | 'breve' | 'lunga'

export interface DB {
  punti: {
    id: Generated<number>
    nome: string
    marchio: string | null
    indirizzo: string | null
    comune: string | null
    provincia: string | null
    geom: string // geography: si scrive con ST_MakePoint, si legge con ST_X/ST_Y
    tipo: Generated<TipoPunto>
    prodotti: Prodotto[]
    fonte: string
    id_fonte: string
    attivo: Generated<boolean>
    aggiornato_il: Generated<Date>
    prezzi_comunicati_il: Date | null
  }
  prezzi: {
    punto_id: number
    prodotto: Prodotto
    self: boolean
    prezzo: string // numeric: il driver lo restituisce come testo
  }
  dispositivi: {
    id: Generated<string>
    creato_il: Generated<Date>
    bloccato: Generated<boolean>
  }
  segnalazioni: {
    id: Generated<number>
    punto_id: number
    prodotto: Prodotto
    stato: Stato
    dispositivo_id: string | null
    creata_il: Generated<Date>
    nascosta: Generated<boolean> // dalla moderazione: toglie anche i voti degli altri
    ritirata: Generated<boolean> // dall'autore, correggendo o annullando: i voti degli altri restano
    a_distanza: Generated<boolean>
    visto_il: Generated<Date>
    visita: string | null // lega le segnalazioni fatte nella stessa sosta in un negozio
  }
  voti: {
    segnalazione_id: number
    dispositivo_id: string | null
    conferma: boolean
    creato_il: Generated<Date>
  }
  code: {
    id: Generated<number>
    punto_id: number
    livello: LivelloCoda
    dispositivo_id: string | null
    creata_il: Generated<Date>
    nascosta: Generated<boolean>
    visita: string | null
  }
  ci_vado: {
    id: Generated<number>
    dispositivo_id: string
    punto_id: number
    prodotti: Generated<Prodotto[]> // solo beni
    creato_il: Generated<Date>
    chiuso_il: Date | null
  }
  viste: {
    punto_id: number
    dispositivo_id: string
    vista_il: Generated<Date>
  }
  anomalie: {
    id: Generated<number>
    tipo: 'velocita_impossibile' | 'fuori_raggio' | 'limite_superato'
    dispositivo_id: string | null
    dettagli: Generated<unknown>
    creata_il: Generated<Date>
  }
  statistiche: {
    giorno: string
    chiave: string
    valore: number
  }
  presenze: {
    giorno: string
    impronta: string // del giorno, non l'identificativo del telefono (improntaVisitatore)
  }
  correzioni: {
    id: Generated<number>
    punto_id: number
    segnalazione_id: number | null
    tipo: 'dati_errati' | 'chiuso' | 'gestore' | 'altro'
    marchio: string | null
    messaggio: string
    contatto: string | null
    chiusa_il: Date | null
    creata_il: Generated<Date>
  }
  andamento: {
    provincia: string
    ora: Date
    comuni_senza: number
    comuni_senza_confermati: number
    con_notizie: number
    verde: number
    giallo: number
    rosso: number
  }
}

// Connessione dalle variabili standard PGHOST, PGUSER, PGPASSWORD, PGDATABASE.
export const pool = new pg.Pool()
export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) })
