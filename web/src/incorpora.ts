// Il widget delle province da incorporare nei siti di testate ed enti (widget.tsx): il codice da incollare e le due
// cose che il widget ricava dal suo indirizzo e da chi lo ospita. Funzioni pure.

export type Formato = 'articolo' | 'laterale'

// Due misure pronte: dentro un articolo (larga quanto la colonna, fino a 640 px) e in una barra laterale.
const MISURE: Record<Formato, { larghezza: string; altezza: number; stile: string }> = {
  articolo: { larghezza: '100%', altezza: 480, stile: 'border:0;max-width:640px' },
  laterale: { larghezza: '300', altezza: 600, stile: 'border:0' },
}

const attributo = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

export function codiceIframe(origine: string, sigla: string, nome: string, formato: Formato) {
  const m = MISURE[formato]
  const titolo = attributo(`Carburante in provincia di ${nome} – Scorty`)
  return `<iframe src="${origine}/widget/province/${sigla}" title="${titolo}" width="${m.larghezza}" height="${m.altezza}" style="${m.stile}" loading="lazy"></iframe>`
}

// Il dominio della pagina che ospita il widget: lo manda al server per contare le aperture per sito (POST /api/widget/aperto).
// Vuoto se il sito non lo dice (Referrer-Policy) o se non è un indirizzo.
export function dominioDi(referrer: string) {
  try {
    return referrer ? new URL(referrer).hostname : ''
  } catch {
    return ''
  }
}

export function siglaDelWidget(percorso: string) {
  const m = percorso.match(/^\/widget\/province\/([a-z]{2})\/?$/i)
  return m ? m[1].toUpperCase() : null
}
