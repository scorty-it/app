import { distanza } from './posizione.ts'
import { NOME_STATO, type Alternativa, type Prodotto, type Punto, type Stato, type StatoProdotto, type StatoPunto } from './tipi.ts'

export type Colore = 'verde' | 'giallo' | 'rosso' | 'grigio'

export const COLORI: Record<Colore, string> = { verde: '#16a34a', giallo: '#d97706', rosso: '#dc2626', grigio: '#9ca3af' }
// Sfumature per spilli e simboli: dal chiaro in alto al colore pieno in basso. TINTA è il fondo degli spilli da confermare.
export const CHIARI: Record<Colore, string> = { verde: '#4ade80', giallo: '#fbbf24', rosso: '#f87171', grigio: '#d1d5db' }
export const TINTE: Record<Colore, string> = { verde: '#dcfce7', giallo: '#fef3c7', rosso: '#fee2e2', grigio: '#f3f4f6' }
export const COLORE_STATO: Record<Stato, Colore> = { disponibile: 'verde', scarso: 'giallo', esaurito: 'rosso' }

// Pillole di stato: testo scuro su fondo tenue, leggibili anche per chi non distingue i colori.
export const PILLOLA: Record<Colore, string> = {
  verde: 'bg-green-50 text-green-900 dark:bg-green-500/15 dark:text-green-200',
  giallo: 'bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  rosso: 'bg-red-50 text-red-900 dark:bg-red-500/15 dark:text-red-200',
  grigio: 'bg-muted text-muted-foreground',
}

// Un negozio ha molte categorie: senza filtro il colore pieno chiede almeno tre categorie concordi, per non colorare un negozio da una sola.
export const MINIMO_CONCORDI = 3
const UN_ORA = 60 * 60 * 1000

export interface Aspetto {
  colore: Colore
  incerto: boolean // segnalazioni contrastanti
  pieno: boolean // confermato da 2+ persone; vuoto = da confermare
  vecchio: boolean // dato più vecchio di un'ora: marker sbiadito
  affollato: boolean // coda lunga o coda in aumento (stima del server)
}

export const affollato = (s: StatoPunto | undefined) =>
  !!s && (s.coda?.livello === 'lunga' || s.stima.coda_in_aumento)

// Aspetto del marker di un punto. Senza filtro: verde se tutto è disponibile,
// rosso se tutto è finito, giallo se è scarso o misto. Un negozio senza filtro è verde o rosso
// solo con almeno MINIMO_CONCORDI categorie note, altrimenti giallo.
export function aspetto(s: StatoPunto | undefined, filtro: Prodotto | null, ora = Date.now()): Aspetto {
  const base: Aspetto = { colore: 'grigio', incerto: false, pieno: false, vecchio: false, affollato: affollato(s) }
  const righe = s?.prodotti.filter((p) => !filtro || p.prodotto === filtro) ?? []
  if (!righe.length) return base

  const vecchio = ora - Math.max(...righe.map((p) => Date.parse(p.ultimo))) > UN_ORA
  const note = righe.filter((p) => p.affidabilita !== 'incerto')
  if (!note.length) return { ...base, incerto: true, pieno: true, vecchio }

  const stati = new Set(note.map((p) => p.stato))
  const pocheCategorie = !filtro && s?.tipo === 'negozio' && note.length < MINIMO_CONCORDI
  const colore = stati.size === 1 && !pocheCategorie ? COLORE_STATO[note[0].stato] : 'giallo'
  return { ...base, colore, pieno: note.every((p) => p.affidabilita === 'affidabile'), vecchio }
}

// Testo per i lettori di schermo. Il giallo di un negozio senza filtro vale anche «poche categorie»,
// quindi non si dice «scarso».
export function descriviSpillo(p: Punto, a: Aspetto, filtro: Prodotto | null) {
  if (a.incerto) return `${p.nome}: segnalazioni contrastanti`
  if (a.colore === 'grigio') return `${p.nome}: nessun dato recente`
  const giallo = p.tipo === 'negozio' && !filtro ? 'poche segnalazioni o miste' : 'scarso o parziale'
  return `${p.nome}: ${{ verde: NOME_STATO.disponibile, giallo, rosso: NOME_STATO.esaurito }[a.colore]}${a.pieno ? '' : ', da confermare'}`
}

export function tempoFa(iso: string, ora = Date.now()) {
  const min = Math.round((ora - Date.parse(iso)) / 60000)
  if (min < 1) return 'adesso'
  if (min < 60) return `${min} min fa`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h} h ${min % 60} min fa` : `${h} h fa`
}

export const quando = (iso: string) =>
  `alle ${new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} (${tempoFa(iso)})`

export function testoPersone(p: StatoProdotto) {
  if (p.affidabilita === 'incerto') return 'segnalazioni contrastanti'
  const dove = p.a_distanza ? ' a distanza' : ''
  const chi = p.persone === 1 ? `segnalato${dove} da 1 persona · da confermare` : `confermato${dove} da ${p.persone} persone`
  if (!p.smentite) return chi
  return `${chi} · ${p.smentite} ${p.smentite === 1 ? 'dice' : 'dicono'} di no`
}

// Fino a 3 distributori entro 10 km con il prodotto non finito. Affollati e scarsi vanno in fondo,
// così la domanda si distribuisce invece di concentrarsi sul più vicino.
export function alternative(
  qui: Punto, prodotto: Prodotto | null, punti: Punto[], stati: Map<number, StatoPunto>,
): Alternativa[] {
  return punti
    .flatMap((punto) => {
      const s = stati.get(punto.id)
      if (!s || punto.id === qui.id) return []
      const metri = distanza(qui, punto)
      const stato = s.prodotti.find(
        (p) => (!prodotto || p.prodotto === prodotto) && p.stato !== 'esaurito' && p.affidabilita !== 'incerto',
      )
      if (!stato || metri > 10000) return []
      return [{ punto, metri, stato, peso: metri + (affollato(s) ? 5000 : 0) + (stato.stato === 'scarso' ? 1000 : 0) }]
    })
    .sort((a, b) => a.peso - b.peso)
    .slice(0, 3)
}
