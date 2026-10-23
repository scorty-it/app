// Gli avvisi a enti e redazioni quando una provincia peggiora, e una volta quando torna a migliorare: nel canale
// Telegram della regione e nel feed RSS della provincia. Scorty non raccoglie niente: ci si iscrive su Telegram o nel
// proprio lettore di feed. Contano solo i comuni senza carburante CONFERMATI (almeno due persone d'accordo): una persona
// sola non deve poter far partire un avviso verso tutte le redazioni (decisione dell'utente). Funzioni pure, più
// l'invio a Telegram con la fetch passata da fuori.

const ORA_MS = 3_600_000
const PAUSA = 6 * ORA_MS // al massimo un avviso ogni 6 ore per provincia; il confronto è con 6 ore prima (app.ts)

export type TipoAvviso = 'peggiora' | 'migliora'
export interface Fotografia {
  ora: Date
  confermati: number // comuni senza carburante confermati
}
export interface UltimoAvviso {
  tipo: TipoAvviso
  ora: Date
  confermati: number
}
export interface Avviso {
  tipo: TipoAvviso
  adesso: number
  prima: number
  ora_prima: Date
}
export type AvvisoSalvato = Avviso & { id: number; provincia: string; ora: Date }

// `prima`: l'ultima fotografia di almeno 6 ore prima (null se manca: non si confronta con un buco).
export function decidiAvviso(adesso: Fotografia, prima: Fotografia | null, ultimo: UltimoAvviso | null): Avviso | null {
  // Dopo un peggioramento, una volta sola: tornati a zero o almeno alla metà. Una buona notizia non aspetta la pausa.
  if (ultimo?.tipo === 'peggiora' && (adesso.confermati === 0 || adesso.confermati * 2 <= ultimo.confermati)) {
    return { tipo: 'migliora', adesso: adesso.confermati, prima: ultimo.confermati, ora_prima: ultimo.ora }
  }
  if (!prima || adesso.confermati < 1 || adesso.confermati <= prima.confermati) return null
  if (ultimo && adesso.ora.getTime() - ultimo.ora.getTime() < PAUSA) return null
  return { tipo: 'peggiora', adesso: adesso.confermati, prima: prima.confermati, ora_prima: prima.ora }
}

const ORA = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const comuni = (n: number) =>
  n === 0 ? 'Nessun comune senza carburante confermato' : n === 1 ? '1 comune senza carburante confermato' : `${n} comuni senza carburante confermati`
const erano = (n: number) => (n === 0 ? 'nessuno' : n === 1 ? 'era 1' : `erano ${n}`)

// `da` è l'etichetta del link (?da=telegram, ?da=rss): nelle statistiche si vede da dove arrivano le visite.
export function testoAvviso(sigla: string, nome: string, a: Avviso, origine: string, da: string) {
  const hashtag = nome.replace(/[^\p{L}\p{N}]/gu, '')
  return `Provincia di ${nome}: in ${a.tipo === 'peggiora' ? 'peggioramento' : 'miglioramento'} #${hashtag}\n` +
    `${comuni(a.adesso)}, alle ${ORA.format(a.ora_prima)} ${erano(a.prima)}.\n` +
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
    `    <title>${xml(`Scorty – avvisi carburante, provincia di ${nome}`)}</title>\n    <link>${xml(link)}</link>\n` +
    `    <description>${xml(`Quando nella provincia di ${nome} aumentano i comuni senza carburante confermati, e quando tornano a calare.`)}</description>\n` +
    `    <language>it</language>\n${voci.join('\n')}${voci.length ? '\n' : ''}  </channel>\n</rss>\n`
}
