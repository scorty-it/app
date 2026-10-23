// L'andamento delle ultime 24 ore di una provincia: quanti comuni sono senza carburante, ora per ora, dalle fotografie
// orarie del server (009_andamento.sql); per l'ora in corso vale il numero di adesso. Pagina e PDF. Funzioni pure.
import { gruppo } from './bollettino.ts'
import type { BollettinoProvincia } from './dati.ts'

const ORA_MS = 3_600_000
const CONFRONTO = 6 // ore: abbastanza per una tendenza, abbastanza poche da parlare di stamattina e non di ieri
const ORA = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const oraDi = (iso: string) => ORA.format(Date.parse(iso))

export interface Barra {
  ora: string // ISO, ora piena
  comuni: number | null // null: nessuna fotografia (server fermo), resta un buco
}

export function barreAndamento(b: BollettinoProvincia): Barra[] {
  // Le ore piene in UTC sono ore piene anche in Italia: il fuso si sposta di ore intere.
  const adesso = Math.floor(Date.parse(b.aggiornato_il) / ORA_MS) * ORA_MS
  const fotografie = new Map((b.andamento ?? []).map((f) => [Date.parse(f.ora), f.comuni_senza]))
  return Array.from({ length: 24 }, (_, i) => {
    const t = adesso - (23 - i) * ORA_MS
    return { ora: new Date(t).toISOString(), comuni: i === 23 ? gruppo(b, 'senza_carburante').length : (fotografie.get(t) ?? null) }
  })
}

// Il grafico serve se c'è una storia e almeno un'ora con comuni senza carburante.
export const conGrafico = (b: BollettinoProvincia) => !!b.andamento?.length && barreAndamento(b).some((x) => !!x.comuni)

const comuni = (n: number) => (n === 0 ? 'nessun comune' : n === 1 ? '1 comune' : `${n} comuni`)
const erano = (n: number) => (n === 0 ? 'nessuno' : n === 1 ? 'era 1' : `erano ${n}`)

// Adesso contro l'ultima fotografia di almeno 6 ore fa. Senza storia abbastanza lunga, niente frase.
export function fraseAndamento(b: BollettinoProvincia) {
  if (!b.andamento?.length) return null
  const barre = barreAndamento(b)
  const note = barre.filter((x) => x.comuni !== null)
  if (note.every((x) => x.comuni === 0)) {
    const dalla = note[0] // la prima ora nota: se è solo adesso non c'è storia da raccontare
    if (dalla === barre[23]) return null
    return `Nessun comune senza carburante ${dalla === barre[0] ? 'nelle ultime 24 ore' : `dalle ${oraDi(dalla.ora)}`}`
  }
  const prima = barre.slice(0, 24 - CONFRONTO).findLast((x) => x.comuni !== null)
  if (!prima) return null
  const alle = oraDi(prima.ora)
  const [adesso, allora] = [barre[23].comuni!, prima.comuni!]
  if (adesso === allora) return `Stabile: ${comuni(adesso)} senza carburante, come alle ${alle}`
  return `In ${adesso > allora ? 'peggioramento' : 'miglioramento'}: ${comuni(adesso)} senza carburante, alle ${alle} ${erano(allora)}`
}
