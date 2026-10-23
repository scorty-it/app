// Testi e calcoli del bollettino per provincia, condivisi da pagina, immagine, PDF e testo. Funzioni pure.
import type { BollettinoProvincia, ComuneBollettino } from './dati.ts'

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

export const primi = <T,>(lista: T[], n: number) => ({ mostrati: lista.slice(0, n), altri: Math.max(0, lista.length - n) })

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

const conEtichetta = (c: ComuneBollettino) => (c.confermato ? c.comune : `${c.comune} (da confermare)`)

export function testoBollettino(b: BollettinoProvincia, nome: string, url: string) {
  const { giorno, ora } = momento(b.aggiornato_il)
  const righe = [`Carburante in provincia di ${nome}, ${giorno} ore ${ora}`]
  if (!conNotizie(b)) righe.push('Nessuna notizia nelle ultime 24 ore.')
  else {
    const senza = gruppo(b, 'senza_carburante')
    righe.push(
      `✓ ${b.verde} con carburante · – ${b.giallo} scarso · ✕ ${b.rosso} finito (${conNotizie(b)} distributori su ${b.distributori} con notizie nelle ultime 24 ore)`,
      senza.length ? `Comuni senza carburante: ${senza.map(conEtichetta).join(', ')}.` : 'Nessun comune risulta senza carburante.',
    )
  }
  righe.push(`Situazione aggiornata: ${url}`)
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
