// Testi e calcoli del bollettino per provincia, condivisi da pagina, immagine, PDF e testo. Funzioni pure.
import type { BeneSenza, BollettinoProvincia, ComuneBollettino, Provincia } from './dati.ts'
import type { Elenco } from './righe-widget.ts'
import { NOME_PRODOTTO, nomeInFrase } from './tipi.ts'

const FUSO = 'Europe/Rome'
const GIORNO = new Intl.DateTimeFormat('it-IT', { timeZone: FUSO, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const ORA = new Intl.DateTimeFormat('it-IT', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const PER_FILE = new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

// Sempre l'ora del calcolo sul server, non quella del tocco: chi riceve il bollettino deve sapere di quando sono i dati.
export function momento(iso: string) {
  const d = new Date(iso)
  return { giorno: GIORNO.format(d), ora: ORA.format(d) }
}

export const conNotizie = (b: BollettinoProvincia) => b.verde + b.giallo + b.rosso
export const valoreIndicatore = (b: BollettinoProvincia) => (conNotizie(b) ? (b.verde + b.giallo / 2) / conNotizie(b) : null)
export const gruppo = (b: BollettinoProvincia, g: ComuneBollettino['gruppo']) => b.comuni.filter((c) => c.gruppo === g)

// Al posto dell'elenco vuoto. Senza notizie non si dice «nessun comune senza carburante»: sembrerebbe che vada tutto bene.
export function fraseVuota(b: BollettinoProvincia) {
  if (!conNotizie(b)) return 'Nessuna notizia nelle ultime 24 ore'
  if (!gruppo(b, 'senza_carburante').length) return 'Nessun comune risulta senza carburante'
  return null
}

// I comuni distinti senza almeno un bene: uno senza acqua e senza pane conta una volta (come nella fotografia oraria del server).
// Senza `spesa` (server vecchio) sono 0.
export const comuniSenzaBeni = (b: BollettinoProvincia) => new Set((b.spesa?.beni ?? []).flatMap((x) => x.comuni.map((c) => c.comune))).size

// Come fraseVuota, per la spesa. Senza notizie dai negozi non si dice «nessun comune senza beni»: sembrerebbe che vada tutto bene.
// Senza `spesa` (server vecchio) niente frase: la spesa non c'è proprio.
export function fraseVuotaSpesa(b: BollettinoProvincia) {
  if (!b.spesa) return null
  if (!b.spesa.con_notizie) return 'Nessuna notizia dai negozi nelle ultime 24 ore'
  if (!b.spesa.beni.length) return 'Nessun comune risulta senza beni'
  return null
}

// La riga della spesa sotto ogni provincia nell'elenco. Come fraseVuotaSpesa: senza notizie dai negozi non si dice
// «nessun comune senza beni». Senza `spesa` (server vecchio) nessuna riga.
export function rigaSpesaProvincia(p: Provincia) {
  if (!p.spesa) return null
  if (!p.spesa.con_notizie) return 'Spesa: nessuna notizia dai negozi'
  const n = p.spesa.comuni_senza
  return n ? `Spesa: ${n === 1 ? '1 comune' : `${n} comuni`} senza beni` : 'Spesa: nessun comune senza beni'
}

export const primi = <T,>(lista: T[], n: number) => ({ mostrati: lista.slice(0, n), altri: Math.max(0, lista.length - n) })

// La riga di un bene nell'immagine, come nel widget: «Acqua: Volla, Pozzuoli (da confermare) +3». A pezzi, perché il bene è in
// grassetto e «da confermare» in ambra; i comuni nominati sono i primi `nomi`, gli altri sono «+N».
export interface PezzoBene {
  testo: string
  tipo: 'bene' | 'nome' | 'conferma' | 'altri'
}
export function pezziBene(x: BeneSenza, nomi: number): PezzoBene[] {
  const { mostrati, altri } = primi(x.comuni, nomi)
  return [
    { testo: `${NOME_PRODOTTO[x.bene]}:`, tipo: 'bene' },
    ...mostrati.flatMap((c, i): PezzoBene[] => [
      { testo: `${i ? ', ' : ' '}${c.comune}`, tipo: 'nome' },
      ...(c.confermato ? [] : [{ testo: ' (da confermare)', tipo: 'conferma' as const }]),
    ]),
    ...(altri ? [{ testo: ` +${altri}`, tipo: 'altri' as const }] : []),
  ]
}

// Quante righe di ogni elenco stanno nell'immagine, che ha un'altezza fissa (1080×1350) e due elenchi, i comuni senza carburante e
// i beni della spesa. `spazio` è quello che resta una volta messo tutto il resto. Si parte da `minimo` righe per elenco (o tutte, se
// sono meno) e se ne aggiunge una alla volta, a quello che ne ha mostrate meno rispetto a quante ne ha (a parità i comuni), finché
// stanno; mai oltre il `tetto`. Se un elenco non è mostrato tutto serve anche la riga «e altri N». Come per il widget (righe-widget.ts)
// quello che manca si riassume e il resto sta su scorty.it. Funzione pura: le misure vere le dà chi disegna.
// ponytail: le `minimo` righe non scendono mai, nemmeno se non stanno: il caso peggiore (12 comuni senza carburante, 7 beni con 10 comuni,
// nomi lunghi) è stato guardato negli screenshot; con altre altezze o un terzo elenco va ricontrollato.
export interface ElencoImmagine {
  totale: number // quante voci ha
  tetto: number // fino a quante se ne mostrano, anche con tutto lo spazio
  riga: number // altezza di una voce
  altri: number // altezza della riga «e altri N»
}
export function righeImmagine(elenchi: Record<Elenco, ElencoImmagine>, spazio: number, minimo = 2): Record<Elenco, number> {
  const chiavi: Elenco[] = ['comuni', 'beni']
  const righe: Record<Elenco, number> = { comuni: Math.min(minimo, elenchi.comuni.totale), beni: Math.min(minimo, elenchi.beni.totale) }
  const altezza = (r: Record<Elenco, number>) => chiavi.reduce((somma, k) => somma + r[k] * elenchi[k].riga + (r[k] < elenchi[k].totale ? elenchi[k].altri : 0), 0)
  for (;;) {
    const k = chiavi
      .filter((x) => righe[x] < Math.min(elenchi[x].totale, elenchi[x].tetto) && altezza({ ...righe, [x]: righe[x] + 1 }) <= spazio)
      .sort((x, y) => righe[x] / elenchi[x].totale - righe[y] / elenchi[y].totale)[0]
    if (!k) return righe
    righe[k]++
  }
}

// La dimensione più grande, tra minimo e massimo, con cui il testo sta nella larghezza.
export function adatta(testo: string, larghezza: number, massimo: number, minimo: number, misura: (testo: string, px: number) => number) {
  for (let px = massimo; px > minimo; px--) if (misura(testo, px) <= larghezza) return px
  return minimo
}

// Le righe in cui va a capo un testo, tra una parola e l'altra; una parola troppo lunga resta intera.
export function aCapo(testo: string, larghezza: number, misura: (testo: string) => number) {
  const righe: string[] = []
  for (const parola of testo.split(' ')) {
    const ultima = righe.at(-1)
    if (ultima != null && misura(`${ultima} ${parola}`) <= larghezza) righe[righe.length - 1] = `${ultima} ${parola}`
    else righe.push(parola)
  }
  return righe
}

export const finitiSu = (c: ComuneBollettino) => `${c.rosso} ${c.rosso === 1 ? 'finito' : 'finiti'} su ${c.distributori}`

// Le segnalazioni valgono 24 ore: una notizia può essere di ieri, e con la sola ora sembrerebbe di oggi.
const DATA = new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO })
export function oraNotizia(iso: string, riferimento: string) {
  const ora = ORA.format(new Date(iso))
  return DATA.format(new Date(iso)) === DATA.format(new Date(riferimento)) ? ora : `ieri ${ora}`
}

const conEtichetta = (c: { comune: string; confermato: boolean }) => (c.confermato ? c.comune : `${c.comune} (da confermare)`)
const minuscola = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)

// Le righe della spesa: quanti negozi hanno notizie e, bene per bene, i comuni senza. Nessuna se il server non manda la spesa.
function righeSpesa(b: BollettinoProvincia) {
  if (!b.spesa) return []
  const { negozi, con_notizie, beni } = b.spesa
  const notizie = `notizie da ${con_notizie} ${con_notizie === 1 ? 'negozio' : 'negozi'} su ${negozi} nelle ultime 24 ore`
  const vuota = fraseVuotaSpesa(b)
  if (!con_notizie) return [`Spesa: ${minuscola(vuota!)}.`]
  if (vuota) return [`Spesa: ${minuscola(vuota)} (${notizie}).`]
  return [`Spesa: ${notizie}.`, beni.map((x) => `Senza ${nomeInFrase(x.bene)}: ${x.comuni.map(conEtichetta).join(', ')}.`).join(' ')]
}

export function testoBollettino(b: BollettinoProvincia, nome: string, url: string) {
  const { giorno, ora } = momento(b.aggiornato_il)
  // Con la spesa la riga dei distributori comincia con «Carburante:», perché accanto ce n'è un'altra che parla dei negozi.
  const righe = [`${b.spesa ? 'Carburante e spesa' : 'Carburante'} in provincia di ${nome}, ${giorno} ore ${ora}`]
  if (!conNotizie(b)) righe.push(b.spesa ? 'Carburante: nessuna notizia nelle ultime 24 ore.' : 'Nessuna notizia nelle ultime 24 ore.')
  else {
    const senza = gruppo(b, 'senza_carburante')
    righe.push(
      `${b.spesa ? 'Carburante: ' : ''}✓ ${b.verde} con carburante · – ${b.giallo} scarso · ✕ ${b.rosso} finito (${conNotizie(b)} ${conNotizie(b) === 1 ? 'distributore' : 'distributori'} su ${b.distributori} con notizie nelle ultime 24 ore)`,
      senza.length ? `Comuni senza carburante: ${senza.map(conEtichetta).join(', ')}.` : 'Nessun comune risulta senza carburante.',
    )
  }
  righe.push(...righeSpesa(b), `Situazione aggiornata: ${url}`)
  return righe.join('\n')
}

// I browser dentro le app social di solito ignorano la stampa e non condividono file.
// «; wv)» è la WebView di Android, quella che usano le app che aprono i link al loro interno.
export const browserInterno = (ua: string) => /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|TikTok|musical_ly|Telegram|Snapchat|\bLine\/|MicroMessenger|; wv\)/i.test(ua)

// La risposta del server si può tenere un minuto: con un indirizzo nuovo ogni minuto la pagina, che si ricarica
// ogni minuto, non riceve dal browser la copia di prima e i dati non restano indietro di due o tre minuti.
export const indirizzoBollettino = (sigla: string, ora: number) => `/api/province/${sigla}?minuto=${Math.floor(ora / 60_000)}`

export const nomeFile = (b: BollettinoProvincia, estensione: 'png' | 'pdf') =>
  `scorty-bollettino-${b.provincia}-${PER_FILE.format(new Date(b.aggiornato_il)).replace(' ', '-').replace(':', '')}.${estensione}`
