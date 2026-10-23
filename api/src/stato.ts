import type { LivelloCoda, Prodotto, Stato, TipoPunto } from './db.ts'

// Calcolo dello stato di un distributore a partire da segnalazioni e voti. Funzioni pure: le query stanno in app.ts.

export type Affidabilita = 'affidabile' | 'da_confermare' | 'incerto'

// Una segnalazione, o un voto su una segnalazione: "Confermo" afferma quello stato, "Non è vero" lo nega.
export interface Opinione {
  prodotto: Prodotto
  stato: Stato
  afferma: boolean
  dispositivo_id: string
  il: Date
  segnalazione_id: number
  a_distanza: boolean // segnalata dopo, da lontano: conta la metà
}

export interface StatoProdotto {
  prodotto: Prodotto
  stato: Stato
  affidabilita: Affidabilita
  persone: number // dispositivi diversi che sostengono lo stato
  smentite: number // dispositivi che dicono altro
  ultimo: string
  segnalazione_id: number // la più recente a favore: è quella da confermare o smentire
  rifornito: boolean // era finito ed è tornato disponibile
  a_distanza: boolean // tutte le segnalazioni a favore vengono da lontano
}

export interface Coda {
  livello: LivelloCoda
  dispositivo_id: string
  il: Date
}

const ORA = 60 * 60 * 1000
// Una segnalazione vale 24 ore (il filtro è nelle query di app.ts): uno sciopero dura giorni, e una mappa che si
// svuota ogni 4 ore non serve. Perché le notizie nuove vincano comunque, il peso si dimezza ogni 3 ore, e uno stato
// è «affidabile» solo con conferme delle ultime 4 ore: un verde di ieri non deve sembrare sicuro.
// ponytail: stessi valori per carburanti e spesa; separarli per tipo quando i dati dei negozi lo chiederanno.
export const MEZZA_VITA = 3 * ORA
export const RECENTE = 4 * ORA

// Peso di un telefono: i nuovi contano un po' meno, chi viene confermato da altri di più, chi viene smentito di meno.
// Conta la proporzione tra conferme e smentite ricevute, non il totale: chi segnala tanto non viene penalizzato.
// Partenza neutra (come 3 conferme e 3 smentite), peso tra 0,25 e 1,5.
export function fiducia(f: { eta_min: number; conferme: number; smentite: number }) {
  const base = f.eta_min < 30 ? 0.75 : 1
  const quota = (f.conferme + 3) / (f.conferme + f.smentite + 6)
  return Math.min(1.5, Math.max(0.25, base * 2 * quota))
}

const somma = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

// Per ogni telefono conta solo la sua opinione più recente: ripetere non aggiunge peso.
function ultimePerDispositivo<T extends { dispositivo_id: string; il: Date }>(xs: T[]) {
  const ultime = new Map<string, T>()
  for (const x of xs) {
    const prima = ultime.get(x.dispositivo_id)
    if (!prima || x.il > prima.il) ultime.set(x.dispositivo_id, x)
  }
  return [...ultime.values()]
}

// Opinioni delle ultime 24 ore su un prodotto di un distributore (il filtro sulle 24 ore è nella query).
export function statoProdotto(opinioni: Opinione[], fiducie: Map<string, number>, ora = Date.now()): StatoProdotto | null {
  const ultime = ultimePerDispositivo(opinioni)
  const fid = (o: Opinione) => (fiducie.get(o.dispositivo_id) ?? 1) * (o.a_distanza ? 0.5 : 1)
  // Le più recenti pesano di più: il peso si dimezza ogni 3 ore.
  const peso = (o: Opinione) => 0.5 ** ((ora - o.il.getTime()) / MEZZA_VITA) * fid(o)

  const punteggi = new Map<Stato, number>()
  for (const o of ultime) if (o.afferma) punteggi.set(o.stato, (punteggi.get(o.stato) ?? 0) + peso(o))
  if (!punteggi.size) return null
  const [vincente, punteggio] = [...punteggi].sort((a, b) => b[1] - a[1])[0]

  const pro = ultime.filter((o) => o.afferma && o.stato === vincente).sort((a, b) => a.il.getTime() - b.il.getTime())
  const contro = ultime.filter((o) => (o.afferma ? o.stato !== vincente : o.stato === vincente))
  const ultimo = pro[pro.length - 1]

  const proRecenti = pro.filter((o) => ora - o.il.getTime() <= RECENTE)
  let affidabilita: Affidabilita = 'da_confermare'
  if (somma(contro.map(peso)) >= 0.6 * punteggio) affidabilita = 'incerto'
  else if (proRecenti.length >= 2 && somma(proRecenti.map(fid)) >= 1.5) affidabilita = 'affidabile'

  return {
    prodotto: opinioni[0].prodotto,
    stato: vincente,
    affidabilita,
    persone: pro.length,
    smentite: contro.length,
    ultimo: ultimo.il.toISOString(),
    segnalazione_id: ultimo.segnalazione_id,
    rifornito: vincente === 'disponibile' && opinioni.some((o) => o.afferma && o.stato === 'esaurito' && o.il < pro[0].il),
    a_distanza: pro.every((o) => o.a_distanza),
  }
}

// Code dell'ultima ora: vince il livello con più peso, il peso si dimezza ogni mezz'ora.
export function statoCoda(code: Coda[], fiducie: Map<string, number>, ora = Date.now()) {
  const ultime = ultimePerDispositivo(code)
  if (!ultime.length) return null
  const peso = (c: Coda) => 0.5 ** ((ora - c.il.getTime()) / (ORA / 2)) * (fiducie.get(c.dispositivo_id) ?? 1)
  const punteggi = new Map<LivelloCoda, number>()
  for (const c of ultime) punteggi.set(c.livello, (punteggi.get(c.livello) ?? 0) + peso(c))
  const [livello] = [...punteggi].sort((a, b) => b[1] - a[1])[0]
  const per = ultime.filter((c) => c.livello === livello)
  return { livello, persone: per.length, ultimo: new Date(Math.max(...per.map((c) => c.il.getTime()))).toISOString() }
}

// Stime dai «Ci vado» (telefoni in arrivo nell'ora) e dalle schede aperte: sono campi a parte, lo stato osservato
// non cambia mai. Una segnalazione sul posto vale più di una previsione.
// ponytail: soglie e peso a occhio, fissi per tutti i punti; tararli quando ci saranno segnalazioni vere con cui
// confrontare le stime, e per dimensione del negozio se un ipermercato scatta come una bottega.
// ponytail: costo dell'abuso: cinque telefoni nuovi bastano per «Coda in aumento», dieci per «Potrebbe finire», e il «Ci vado»
// pesa per intero, senza `fiducia`. Da rivedere con dati veri (per esempio pesarlo con la fiducia, o una vista di moderazione).
export const SOGLIA_POTREBBE_FINIRE = 10 // «Ci vado» sullo stesso prodotto
export const SOGLIA_CODA_IN_AUMENTO = 10
export const PESO_CI_VADO = 2 // pesa il doppio di una scheda aperta: 10 schede = soglia, come il «molto cercato» di oggi

export interface Stima {
  coda_in_aumento: boolean
  potrebbe_finire: Prodotto[]
}

export function stimaArrivi(a: {
  tipo: TipoPunto
  ci_vado: number
  per_prodotto: Partial<Record<Prodotto, number>>
  interesse: number
  coda: { livello: LivelloCoda } | null
  prodotti: StatoProdotto[]
}): Stima {
  // Dove qualcuno ha segnalato la coda sul posto (anche «nessuna») la stima tace: vince l'osservazione.
  const coda_in_aumento = !a.coda && PESO_CI_VADO * a.ci_vado + a.interesse >= SOGLIA_CODA_IN_AUMENTO
  // Solo negozi, e mai per un prodotto visto finito (esaurito non incerto, la stessa regola del 409 di «Ci vado»): sarebbe una stima su un fatto noto.
  const potrebbe_finire =
    a.tipo !== 'negozio'
      ? []
      : (Object.entries(a.per_prodotto) as [Prodotto, number][])
          .filter(([p, n]) => n >= SOGLIA_POTREBBE_FINIRE && !a.prodotti.some((s) => s.prodotto === p && s.stato === 'esaurito' && s.affidabilita !== 'incerto'))
          .map(([p]) => p)
  return { coda_in_aumento, potrebbe_finire }
}
