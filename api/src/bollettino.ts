import type { Prodotto, Stato } from './db.ts'
import { BENI } from './prodotti.ts'
import type { StatoProdotto } from './stato.ts'

// Il bollettino per provincia: quali comuni sono senza carburante, quali hanno notizie e quali no, e quali
// sono senza un bene della spesa (acqua, pane, latte…). Funzioni pure.
// «Senza carburante»: nessun distributore del comune ha carburante (verde o giallo) e almeno uno è finito.
// «Senza un bene»: nessun negozio del comune ha quel bene (disponibile o scarso) e almeno uno l'ha finito.
// Basta una sola segnalazione (decisione dell'utente), ma il comune resta «da confermare» finché un suo
// distributore (o negozio) finito non ha almeno due persone d'accordo nelle ultime 4 ore (affidabilità
// «affidabile», stato.ts).

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

export interface BeneNegozio {
  bene: Prodotto
  stato: Stato // solo beni con stato noto: gli «incerti» non ci sono
  confermato: boolean // esaurito e affidabile
}

export interface NegozioBollettino {
  comune: string | null
  beni: BeneNegozio[]
  ultimo: string | null // ISO, notizia più recente
}

export interface ComuneSenzaBene {
  comune: string
  confermato: boolean
}

export interface BeneSenza {
  bene: Prodotto
  comuni: ComuneSenzaBene[]
}

export interface SpesaBollettino {
  negozi: number // tutti i negozi della provincia, anche senza comune
  con_notizie: number // quelli con almeno un bene dallo stato noto
  beni: BeneSenza[] // solo i beni con almeno un comune senza, nell'ordine di BENI
}

// Per ogni bene un comune è senza quando, tra i suoi negozi con quel bene noto, nessuno lo ha disponibile o
// scarso e almeno uno lo ha esaurito; chi non ha notizie su quel bene non lo impedisce. I negozi senza comune
// contano nei totali, non tra i comuni. Dentro un bene prima i confermati, poi l'ordine alfabetico.
export function spesaDelBollettino(negozi: NegozioBollettino[]): SpesaBollettino {
  const perComune = [...Map.groupBy(negozi.filter((x) => x.comune?.trim()), (x) => x.comune!.trim().toLowerCase()).values()]
  const beni: BeneSenza[] = []
  for (const bene of BENI) {
    const comuni: ComuneSenzaBene[] = []
    for (const lista of perComune) {
      const note = lista.flatMap((x) => x.beni.filter((b) => b.bene === bene))
      if (note.length === 0 || note.some((b) => b.stato !== 'esaurito')) continue
      comuni.push({ comune: grafia(lista.map((x) => x.comune!.trim())), confermato: note.some((b) => b.confermato) })
    }
    if (comuni.length) {
      comuni.sort((a, b) => +b.confermato - +a.confermato || a.comune.localeCompare(b.comune, 'it'))
      beni.push({ bene, comuni })
    }
  }
  return { negozi: negozi.length, con_notizie: negozi.filter((x) => x.beni.length > 0).length, beni }
}

export interface NumeriSpesa {
  comuni_senza: number // comuni distinti senza almeno un bene
  comuni_senza_confermati: number // quelli con almeno un bene senza, confermato
  beni: Record<string, number> // per bene, i comuni senza confermati; solo i beni con almeno uno
}

// I numeri della fotografia oraria: solo conteggi, nessun dato personale.
export function numeriSpesa(s: SpesaBollettino): NumeriSpesa {
  const confermati = s.beni.map((b) => [b.bene, b.comuni.filter((c) => c.confermato).length] as const)
  return {
    comuni_senza: new Set(s.beni.flatMap((b) => b.comuni.map((c) => c.comune))).size,
    comuni_senza_confermati: new Set(s.beni.flatMap((b) => b.comuni.filter((c) => c.confermato).map((c) => c.comune))).size,
    beni: Object.fromEntries(confermati.filter(([, volte]) => volte > 0)),
  }
}
