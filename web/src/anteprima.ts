// Titolo, descrizione e anteprima dei link (Open Graph) scritti nell'HTML dalla build (vite.config.ts).
// WhatsApp, Facebook e Telegram non eseguono JavaScript: dell'app vedono solo questo. Per la stessa
// ragione ogni provincia ha la sua pagina statica, con il suo titolo, servita da Caddy a /province/XX.

export const TITOLO_SITO = 'Scorty – dove c’è benzina e gasolio adesso'
export const DESCRIZIONE_SITO =
  'La mappa dei distributori con carburante durante scioperi e crisi: benzina, gasolio, GPL e metano, segnalati da chi è sul posto. Gratis, senza account.'

export const titoloProvincia = (nome: string) => `Carburante in provincia di ${nome}, oggi – Scorty`
export const descrizioneProvincia = (nome: string) =>
  `I comuni senza carburante e i distributori con benzina, gasolio, GPL e metano in provincia di ${nome}, dalle segnalazioni di chi è sul posto. Con il bollettino da condividere.`

const testo = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Senza percorso niente canonical né og:url: index.html risponde a tutti gli indirizzi dell'app,
// e un canonical verso la home direbbe a Google che ogni pagina è un doppione della home.
export function testa({ titolo, descrizione, sito, percorso }: { titolo: string; descrizione: string; sito: string; percorso?: string }) {
  const [t, d] = [testo(titolo), testo(descrizione)]
  const indirizzo = percorso && `${sito}${percorso}`
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    ...(indirizzo ? [`<link rel="canonical" href="${indirizzo}" />`, `<meta property="og:url" content="${indirizzo}" />`] : []),
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Scorty" />',
    '<meta property="og:locale" content="it_IT" />',
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:image" content="${sito}/anteprima.png" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="Scorty: dove c’è benzina adesso, segnalato da chi è al distributore" />',
    '<meta name="twitter:card" content="summary_large_image" />',
  ].join('\n    ')
}

// «Le tue segnalazioni» è vuota per chiunque altro: niente da indicizzare.
export const robots = (sito: string) => `User-agent: *\nDisallow: /mie\n\nSitemap: ${sito}/sitemap.xml\n`

export const sitemap = (sito: string, percorsi: string[]) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...percorsi.map((p) => `  <url><loc>${testo(sito + p)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n')
