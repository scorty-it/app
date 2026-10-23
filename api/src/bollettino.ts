import type { StatoProdotto } from './stato.ts'

// Il bollettino per provincia: quali comuni sono senza carburante, quali hanno notizie e quali no. Funzioni pure.
// «Senza carburante»: nessun distributore del comune ha carburante (verde o giallo) e almeno uno è finito.
// Basta una sola segnalazione (decisione dell'utente), ma il comune resta «da confermare» finché un suo
// distributore finito non ha almeno due persone d'accordo nelle ultime 4 ore (affidabilità «affidabile», stato.ts).

export type ColoreDistributore = 'verde' | 'giallo' | 'rosso' | null // come coloreDi in app.ts

export interface DistributoreBollettino {
  comune: string | null
  lat: number
  lon: number
  colore: ColoreDistributore
  confermato: boolean // finito con almeno un carburante esaurito e affidabile
  ultimo: string | null // ISO, notizia più recente
}

export type Gruppo = 'senza_carburante' | 'con_notizie' | 'senza_notizie'

export interface ComuneBollettino {
  comune: string
  distributori: number
  verde: number
  giallo: number
  rosso: number
  ultima: string | null
  lat: number
  lon: number
  gruppo: Gruppo
  confermato: boolean // ha senso solo per i comuni senza carburante
}

export const finitoConfermato = (prodotti: Pick<StatoProdotto, 'stato' | 'affidabilita'>[]) =>
  prodotti.some((p) => p.stato === 'esaurito' && p.affidabilita === 'affidabile')

const GRUPPI: Gruppo[] = ['senza_carburante', 'con_notizie', 'senza_notizie']
const media = (valori: number[]) => valori.reduce((a, b) => a + b, 0) / valori.length
const tempo = (iso: string | null) => (iso ? Date.parse(iso) : -Infinity)

// I distributori senza comune contano nei totali della provincia, non qui.
// Lo stesso comune può arrivare scritto in modi diversi: si unisce senza badare a maiuscole e spazi.
export function comuniDelBollettino(distributori: DistributoreBollettino[]): ComuneBollettino[] {
  const conComune = distributori.filter((d) => d.comune?.trim())
  const perComune = Map.groupBy(conComune, (d) => d.comune!.trim().toLowerCase())
  const comuni = [...perComune.values()].map((lista): ComuneBollettino => {
    const conta = (c: ColoreDistributore) => lista.filter((d) => d.colore === c).length
    const [verde, giallo, rosso] = [conta('verde'), conta('giallo'), conta('rosso')]
    const gruppo: Gruppo = verde + giallo + rosso === 0 ? 'senza_notizie' : verde + giallo === 0 ? 'senza_carburante' : 'con_notizie'
    const ultima = lista.reduce<string | null>((u, d) => (tempo(d.ultimo) > tempo(u) ? d.ultimo : u), null)
    return {
      comune: grafia(lista.map((d) => d.comune!.trim())),
      distributori: lista.length,
      verde,
      giallo,
      rosso,
      ultima,
      lat: media(lista.map((d) => d.lat)),
      lon: media(lista.map((d) => d.lon)),
      gruppo,
      confermato: gruppo === 'senza_carburante' && lista.some((d) => d.colore === 'rosso' && d.confermato),
    }
  })
  return comuni.sort(confronta)
}

// La grafia usata dalla maggior parte dei distributori; a parità, la prima in ordine alfabetico.
function grafia(nomi: string[]) {
  const volte = new Map<string, number>()
  for (const n of nomi) volte.set(n, (volte.get(n) ?? 0) + 1)
  return [...volte].sort(([a, x], [b, y]) => y - x || a.localeCompare(b, 'it'))[0][0]
}

// Prima i comuni senza carburante (confermati, con più finiti, con la notizia più recente), poi quelli con
// notizie (i più grandi prima), poi quelli senza notizie in ordine alfabetico.
function confronta(a: ComuneBollettino, b: ComuneBollettino) {
  const g = GRUPPI.indexOf(a.gruppo) - GRUPPI.indexOf(b.gruppo)
  if (g) return g
  if (a.gruppo === 'senza_carburante') {
    return +b.confermato - +a.confermato || b.rosso - a.rosso || tempo(b.ultima) - tempo(a.ultima) || a.comune.localeCompare(b.comune, 'it')
  }
  if (a.gruppo === 'con_notizie') return b.distributori - a.distributori || a.comune.localeCompare(b.comune, 'it')
  return a.comune.localeCompare(b.comune, 'it')
}
