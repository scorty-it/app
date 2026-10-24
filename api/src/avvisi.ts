// Gli avvisi a enti e redazioni quando una provincia peggiora, e una volta quando torna a migliorare: nel canale
// Telegram della regione e nel feed RSS della provincia. Scorty non raccoglie niente: ci si iscrive su Telegram o nel
// proprio lettore di feed. Un messaggio solo per provincia, che dice com'è messa per carburante e per spesa. Contano solo i
// comuni senza carburante, o senza un bene della spesa, CONFERMATI (almeno due persone d'accordo): una persona sola non deve
// poter far partire un avviso verso tutte le redazioni (decisione dell'utente). Funzioni pure, più l'invio a Telegram con
// la fetch passata da fuori.
import { BENI, NOME_PRODOTTO } from './prodotti.ts'

const ORA_MS = 3_600_000
const PAUSA = 6 * ORA_MS // al massimo un avviso ogni 6 ore per provincia; il confronto è con 6 ore prima (app.ts)

export type TipoAvviso = 'peggiora' | 'migliora'
// Le voci di un avviso: i comuni senza carburante confermati e, per bene, i comuni senza quel bene confermati (una chiave
// assente vale 0). `beni` è null per le fotografie e gli avvisi di prima della spesa: non sapevano, non è «zero».
// `spesa_con_notizie`: quanti negozi hanno notizie. Con 0 e nessun bene da elencare, «nessun comune senza beni» sarebbe una
// bugia (sembra che vada tutto bene, ma non si sa): la riga dice «nessuna notizia dai negozi», e i beni non entrano nel
// confronto, che resta solo sul carburante (coppie()). Conta solo quello di `adesso`; null o assente (fotografie e avvisi di
// prima di questo dato) = come prima.
export interface Voci {
  carburante: number
  beni: Record<string, number> | null
  spesa_con_notizie?: number | null
}
export interface Fotografia {
  ora: Date
  voci: Voci
}
export interface UltimoAvviso {
  tipo: TipoAvviso
  ora: Date
  voci: Voci
}
export interface Avviso {
  tipo: TipoAvviso
  adesso: Voci
  prima: Voci
  ora_prima: Date
}
export type AvvisoSalvato = Avviso & { id: number; provincia: string; ora: Date }

// Le coppie (adesso, prima) di ogni voce che si può confrontare: il carburante sempre; la spesa, bene per bene, solo se le
// due parti la conoscono (null = di prima della spesa: niente confronto, non zero) e se adesso almeno un negozio ha notizie:
// con spesa_con_notizie === 0 i beni sono spariti perché non si sa più niente, non perché sono tornati, e un bene non può
// «salire» (miglioramento e peggioramento passano tutti e due da qui).
function coppie(adesso: Voci, prima: Voci): [number, number][] {
  const c: [number, number][] = [[adesso.carburante, prima.carburante]]
  if (adesso.beni && prima.beni && adesso.spesa_con_notizie !== 0) {
    for (const bene of new Set([...Object.keys(adesso.beni), ...Object.keys(prima.beni)])) c.push([adesso.beni[bene] ?? 0, prima.beni[bene] ?? 0])
  }
  return c
}

// `prima`: l'ultima fotografia di almeno 6 ore prima (null se manca: non si confronta con un buco).
export function decidiAvviso(adesso: Fotografia, prima: Fotografia | null, ultimo: UltimoAvviso | null): Avviso | null {
  // Dopo un peggioramento, una volta sola: tutto quello che era peggiorato è tornato a zero o almeno alla metà, e intanto
  // niente è salito. `adesso * 2 <= ultimo` dice entrambe le cose: una voce a zero nell'ultimo avviso deve restarci.
  // Una buona notizia non aspetta la pausa. Se l'ultimo avviso è di prima della spesa, o adesso nessun negozio ha notizie, i beni
  // non contano (coppie()). Ma deve esserci almeno una voce che nell'ultimo avviso valeva 1 o più ed è stata confrontata: se
  // tutte quelle peggiorate sono fuori dal confronto (solo spesa e adesso nessuna notizia dai negozi; avviso di prima della
  // spesa col carburante a zero) «0 contro 0» non dice che sia migliorato niente, e non si dice.
  const confronto = ultimo?.tipo === 'peggiora' ? coppie(adesso.voci, ultimo.voci) : []
  if (ultimo && confronto.some(([, avviso]) => avviso >= 1) && confronto.every(([ora, avviso]) => ora * 2 <= avviso)) {
    return { tipo: 'migliora', adesso: adesso.voci, prima: ultimo.voci, ora_prima: ultimo.ora }
  }
  // Peggiora se una voce, carburante o un bene, è salita rispetto a 6 ore prima (ed è almeno 1). La pausa è una sola.
  if (!prima || !coppie(adesso.voci, prima.voci).some(([ora, era]) => ora >= 1 && ora > era)) return null
  if (ultimo && adesso.ora.getTime() - ultimo.ora.getTime() < PAUSA) return null
  return { tipo: 'peggiora', adesso: adesso.voci, prima: prima.voci, ora_prima: prima.ora }
}

const ORA = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const comuni = (n: number) =>
  n === 0 ? 'Nessun comune senza carburante confermato' : n === 1 ? '1 comune senza carburante confermato' : `${n} comuni senza carburante confermati`
const erano = (n: number) => (n === 0 ? 'nessuno' : n === 1 ? 'era 1' : `erano ${n}`)

const senzaCarburante = (n: number) =>
  n === 0 ? 'nessun comune senza' : n === 1 ? '1 comune senza, confermato' : `${n} comuni senza, confermati`
const quantiComuni = (n: number) => (n === 0 ? 'nessun comune' : n === 1 ? '1 comune' : `${n} comuni`)

// Il messaggio nuovo: una riga per il carburante e una per la spesa. I beni hanno i nomi di NOME_PRODOTTO, nell'ordine di
// BENI, e compaiono se valgono almeno 1 adesso o nel confronto; senza confronto (prima === null) niente parentesi. Contano i
// comuni confermati, come per il carburante, mentre la pagina mostra anche quelli «da confermare»: dove ci sono beni la riga lo
// dice. Se nessun negozio ha notizie (conNotizie === 0) la riga è sempre «nessuna notizia dai negozi», anche se prima c'erano
// beni: «acqua in nessun comune (prima 1)» direbbe che l'acqua è tornata, ma non si sa. Senza beni da elencare e con notizie,
// «nessun comune senza beni».
function rigaSpesa(adesso: Record<string, number>, prima: Record<string, number> | null, conNotizie: number | null | undefined) {
  if (conNotizie === 0) return 'Spesa: nessuna notizia dai negozi.'
  const voci = BENI.filter((b) => (adesso[b] ?? 0) >= 1 || (prima?.[b] ?? 0) >= 1).map((b) => {
    const n = adesso[b] ?? 0
    const era = prima?.[b] ?? 0
    const confronto = prima === null ? '' : era === n ? ' (come prima)' : era === 0 ? ' (prima nessuno)' : ` (prima ${era})`
    return `${NOME_PRODOTTO[b]} in ${quantiComuni(n)}${confronto}`
  })
  return voci.length ? `Spesa (comuni confermati): ${voci.join(', ')}.` : 'Spesa: nessun comune senza beni.'
}

// `da` è l'etichetta del link (?da=telegram, ?da=rss): nelle statistiche si vede da dove arrivano le visite.
// Un avviso di prima della spesa (beni null) si legge parola per parola come allora, anche nel feed.
export function testoAvviso(sigla: string, nome: string, a: Avviso, origine: string, da: string) {
  const hashtag = nome.replace(/[^\p{L}\p{N}]/gu, '')
  const alle = ORA.format(a.ora_prima)
  const corpo = a.adesso.beni === null
    ? `${comuni(a.adesso.carburante)}, alle ${alle} ${erano(a.prima.carburante)}.`
    : `Carburante: ${senzaCarburante(a.adesso.carburante)}; alle ${alle} ${erano(a.prima.carburante)}.\n${rigaSpesa(a.adesso.beni, a.prima.beni, a.adesso.spesa_con_notizie)}`
  return `Provincia di ${nome}: in ${a.tipo === 'peggiora' ? 'peggioramento' : 'miglioramento'} #${hashtag}\n` +
    `${corpo}\n` +
    `Situazione aggiornata: ${origine}/province/${sigla}?da=${da}`
}

// Di notte, dalle 23 alle 7, il messaggio arriva senza suono: chi segue il canale lo legge al risveglio.
const silenzioso = (quando: Date) => {
  const h = Number(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hourCycle: 'h23' }).format(quando))
  return h >= 23 || h < 7
}

// Un errore (Telegram che non risponde, canale sbagliato) non ferma niente: l'avviso resta nel feed.
// Nei log il motivo, perché un canale sbagliato o un bot non amministratore si scopra senza diagnosi a mano
// («chat not found»); il token mai, nemmeno se un errore di rete riporta l'indirizzo.
export async function inviaTelegram(
  token: string, canale: string, testo: string, quando: Date, f: typeof fetch = fetch, registra: (messaggio: string) => void = console.error,
) {
  const motivo = (m: string) => registra(`Telegram ${canale}: ${m.replaceAll(token, '…')}`)
  try {
    const r = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: canale, text: testo, disable_notification: silenzioso(quando), link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(15_000),
    })
    const risposta = await r.json().catch(() => ({}))
    if (r.ok && risposta.ok === true) return true
    motivo(risposta.description ?? `HTTP ${r.status}`)
    return false
  } catch (e) {
    motivo((e as Error).message)
    return false
  }
}

// TELEGRAM_CANALI nel .env: «Campania=@scorty_campania,Puglia=@scorty_puglia». Il nome della regione è quello ISTAT.
export function leggiCanali(testo: string | undefined): Record<string, string> {
  const coppie = (testo ?? '').split(',').map((c) => c.split('=').map((x) => x.trim()))
  return Object.fromEntries(coppie.filter(([regione, canale]) => regione && /^@\w{5,}$/.test(canale ?? '')))
}

const ENTITA: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITA[c])

export function rssAvvisi(sigla: string, nome: string, origine: string, avvisi: AvvisoSalvato[]) {
  const link = `${origine}/province/${sigla}?da=rss`
  const voci = avvisi
    .toSorted((a, b) => b.ora.getTime() - a.ora.getTime())
    .map((a) => {
      const testo = testoAvviso(sigla, nome, a, origine, 'rss')
      return `    <item>\n      <title>${xml(testo.split('\n')[0].replace(/ #\S+$/, ''))}</title>\n      <link>${xml(link)}</link>\n` +
        `      <guid isPermaLink="false">scorty-avviso-${a.id}</guid>\n      <pubDate>${a.ora.toUTCString()}</pubDate>\n` +
        `      <description>${xml(testo)}</description>\n    </item>`
    })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n` +
    `    <title>${xml(`Scorty – avvisi carburante e spesa, provincia di ${nome}`)}</title>\n    <link>${xml(link)}</link>\n` +
    `    <description>${xml(`Quando nella provincia di ${nome} aumentano i comuni senza carburante o senza un bene della spesa confermati, e quando tornano a calare.`)}</description>\n` +
    `    <language>it</language>\n${voci.join('\n')}${voci.length ? '\n' : ''}  </channel>\n</rss>\n`
}
