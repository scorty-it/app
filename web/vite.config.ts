import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import { DESCRIZIONE_SITO, TITOLO_SITO, descrizioneProvincia, robots, sitemap, testa, titoloProvincia } from './src/anteprima.ts'
import { REGIONI } from './src/province.ts'

// Gli indirizzi assoluti delle anteprime e della sitemap: DOMINIO del file .env, passato alla build (compose.yml).
const SITO = `https://${process.env.DOMINIO || 'scorty.it'}`
const SEGNAPOSTO = /<!-- testa:[^>]*-->/
const TESTA = /<!-- testa -->[\s\S]*<!-- \/testa -->/

// Titolo e anteprima in index.html; poi, a parte, una copia di index.html per ogni provincia con la sua testa
// (Caddy la serve a /province/XX), più robots.txt e sitemap.xml. L'app dentro è la stessa.
function pagineStatiche(): Plugin {
  const conTesta = (html: string, t: Parameters<typeof testa>[0]) => html.replace(TESTA, () => `<!-- testa -->\n    ${testa(t)}\n    <!-- /testa -->`)
  const province = REGIONI.flatMap(([, p]) => Object.entries(p))
  return {
    name: 'scorty-pagine-statiche',
    enforce: 'post',
    transformIndexHtml: (html) =>
      conTesta(html.replace(SEGNAPOSTO, '<!-- testa --><!-- /testa -->'), { titolo: TITOLO_SITO, descrizione: DESCRIZIONE_SITO, sito: SITO }),
    // Dopo che Vite ha scritto index.html nel pacchetto: le copie partono da quella finale, con script e manifest.
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const indice = bundle['index.html']
        if (indice?.type !== 'asset') return
        const html = String(indice.source)
        const emetti = (fileName: string, source: string) => this.emitFile({ type: 'asset', fileName, source })
        emetti('province.html', conTesta(html, {
          titolo: 'Carburante per provincia, oggi – Scorty',
          descrizione: 'I comuni senza carburante in ogni provincia coperta da Scorty, dalle segnalazioni di chi è sul posto.',
          sito: SITO, percorso: '/province',
        }))
        for (const [sigla, nome] of province) {
          emetti(`province/${sigla}.html`, conTesta(html, {
            titolo: titoloProvincia(nome), descrizione: descrizioneProvincia(nome), sito: SITO, percorso: `/province/${sigla}`,
          }))
        }
        emetti('robots.txt', robots(SITO))
        emetti('sitemap.xml', sitemap(SITO, ['/', '/province', ...province.map(([s]) => `/province/${s}`), '/come-funziona', '/chi-siamo', '/fonti', '/avvisi']))
      },
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    pagineStatiche(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Scorty – mappa civica delle scorte',
        short_name: 'Scorty',
        description: "Dove c'è carburante durante scioperi e crisi di approvvigionamento, dalle segnalazioni di chi è sul posto.",
        lang: 'it',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: '/icona-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icona-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icona-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Il widget (widget.html, a /widget/…) non è l'app: il service worker non deve rispondere con index.html.
        navigateFallbackDenylist: [/^\/api\//, /^\/widget\//],
        // Le pagine statiche delle province servono a Google e alle anteprime: l'app installata usa index.html.
        globIgnores: ['**/node_modules/**/*', 'province.html', 'province/**', 'widget.html'],
        // Gli stati non passano mai dalla cache: un dato vecchio qui è pericoloso. Si salvano solo le tile della mappa.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'mappa', expiration: { maxEntries: 3000, maxAgeSeconds: 30 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
  // Due pagine: l'app e il widget per i siti di testate ed enti, che si carica da solo e senza la mappa.
  build: { rollupOptions: { input: { index: 'index.html', widget: 'widget.html' } } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': 'http://localhost:3000' } },
})
