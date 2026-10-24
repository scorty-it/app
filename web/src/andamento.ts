// L'andamento delle ultime 24 ore di una provincia: quanti comuni sono senza carburante, o senza beni della spesa, ora per ora,
// dalle fotografie orarie del server (009_andamento.sql, 012_andamento_spesa.sql); per l'ora in corso vale il numero di adesso.
// Pagina e PDF. Funzioni pure.
import { comuniSenzaBeni, gruppo } from './bollettino.ts'
import type { BollettinoProvincia, FotografiaProvincia } from './dati.ts'
import type { Mondo } from './tipi.ts'

const ORA_MS = 3_600_000
const CONFRONTO = 6 // ore: abbastanza per una tendenza, abbastanza poche da parlare di stamattina e non di ieri
const ORA = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const oraDi = (iso: string) => ORA.format(Date.parse(iso))

export interface Barra {
  ora: string // ISO, ora piena
  comuni: number | null // null: nessuna fotografia (server fermo, o prima della spesa) o nessuna notizia dai negozi: resta un buco
}

// `?? null`: un server vecchio non manda i campi della spesa, e un buco non deve diventare uno zero. Per la spesa, un'ora in cui nessun
// negozio aveva notizie (`spesa_con_notizie === 0`) è un buco anche se il server ha salvato zero: la frase non deve dire «Nessun comune
// senza beni dalle…» su ore in cui non si sapeva. Con `null` o senza il campo (fotografie e server di prima) lo zero resta uno zero.
const dellaFotografia = (f: FotografiaProvincia, mondo: Mondo) =>
  mondo === 'spesa' ? (f.spesa_con_notizie === 0 ? null : (f.spesa_comuni_senza ?? null)) : f.comuni_senza

export function barreAndamento(b: BollettinoProvincia, mondo: Mondo = 'carburante'): Barra[] {
  // Le ore piene in UTC sono ore piene anche in Italia: il fuso si sposta di ore intere.
  const adesso = Math.floor(Date.parse(b.aggiornato_il) / ORA_MS) * ORA_MS
  const fotografie = new Map((b.andamento ?? []).map((f) => [Date.parse(f.ora), dellaFotografia(f, mondo)]))
  // Per la spesa, senza notizie dai negozi (o senza la spesa nella risposta) l'ora in corso è un buco: uno zero direbbe che va tutto bene.
  const inCorso = mondo === 'spesa' ? (b.spesa?.con_notizie ? comuniSenzaBeni(b) : null) : gruppo(b, 'senza_carburante').length
  return Array.from({ length: 24 }, (_, i) => {
    const t = adesso - (23 - i) * ORA_MS
    return { ora: new Date(t).toISOString(), comuni: i === 23 ? inCorso : (fotografie.get(t) ?? null) }
  })
}

// Il titolo del grafico. Quello della spesa non conta i comuni senza carburante: dice cosa conta, anche stampato nel PDF dove
// il grafico sta da solo sotto il titolo «Spesa».
export const titoloAndamento = (mondo: Mondo = 'carburante') => (mondo === 'spesa' ? 'Comuni senza beni, ultime 24 ore' : 'Ultime 24 ore')

// Il grafico serve se c'è una storia e almeno un'ora con comuni senza carburante (o senza beni).
export const conGrafico = (b: BollettinoProvincia, mondo: Mondo = 'carburante') => !!b.andamento?.length && barreAndamento(b, mondo).some((x) => !!x.comuni)

const comuni = (n: number) => (n === 0 ? 'nessun comune' : n === 1 ? '1 comune' : `${n} comuni`)
const erano = (n: number) => (n === 0 ? 'nessuno' : n === 1 ? 'era 1' : `erano ${n}`)

// Adesso contro l'ultima fotografia di almeno 6 ore fa. Senza storia abbastanza lunga, niente frase.
export function fraseAndamento(b: BollettinoProvincia, mondo: Mondo = 'carburante') {
  if (!b.andamento?.length) return null
  const senza = mondo === 'spesa' ? 'senza beni' : 'senza carburante'
  const barre = barreAndamento(b, mondo)
  // Ora in corso senza dato (spesa senza notizie dai negozi): niente frase, la pagina dice già «nessuna notizia dai negozi».
  if (barre[23].comuni === null) return null
  const note = barre.filter((x) => x.comuni !== null)
  if (note.every((x) => x.comuni === 0)) {
    const dalla = note[0] // la prima ora nota: se è solo adesso non c'è storia da raccontare
    if (!dalla || dalla === barre[23]) return null
    return `Nessun comune ${senza} ${dalla === barre[0] ? 'nelle ultime 24 ore' : `dalle ${oraDi(dalla.ora)}`}`
  }
  const prima = barre.slice(0, 24 - CONFRONTO).findLast((x) => x.comuni !== null)
  if (!prima) return null
  const alle = oraDi(prima.ora)
  const [adesso, allora] = [barre[23].comuni, prima.comuni!]
  if (adesso === allora) return `Stabile: ${comuni(adesso)} ${senza}, come alle ${alle}`
  return `In ${adesso > allora ? 'peggioramento' : 'miglioramento'}: ${comuni(adesso)} ${senza}, alle ${alle} ${erano(allora)}`
}
