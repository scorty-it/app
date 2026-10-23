import { costruisciApp } from './app.ts'
import { inviaTelegram, leggiCanali } from './avvisi.ts'
import { pool } from './db.ts'
import { migra } from './migra.ts'
import { aggiornaSeVecchio } from './distributori.ts'
import { aggiornaNegoziSeVecchio } from './negozi.ts'
import { pulisci } from './pulizia.ts'

const segreto = process.env.SEGRETO ?? ''
if (segreto.length < 32) throw new Error('SEGRETO mancante o troppo corto (almeno 32 caratteri): vedi .env.example')

await migra(pool)
await pulisci()
// Ogni ora: pulizia dei dati e, se l'ultimo ha più di 20 ore, aggiornamento dei distributori (Ministero, o OpenStreetMap di riserva) e dei negozi (OpenStreetMap).
const ogniOra = () => {
  pulisci().catch((e) => console.error('pulizia fallita', e))
  aggiornaSeVecchio().catch((e) => console.error('aggiornamento distributori fallito:', e.message))
  aggiornaNegoziSeVecchio().catch((e) => console.error('aggiornamento negozi fallito:', e.message))
}
setInterval(ogniOra, 60 * 60 * 1000)
setTimeout(() => aggiornaSeVecchio().catch((e) => console.error('aggiornamento distributori fallito:', e.message)), 10_000)
setTimeout(() => aggiornaNegoziSeVecchio().catch((e) => console.error('aggiornamento negozi fallito:', e.message)), 20_000)
// Avvisi a enti e redazioni nei canali Telegram delle regioni (avvisi.ts). Senza token o canali (sviluppo, una copia di
// Scorty senza bot) restano solo nel feed RSS delle province.
const token = process.env.TELEGRAM_TOKEN ?? ''
const canali = leggiCanali(process.env.TELEGRAM_CANALI)
const avvisi = token && Object.keys(canali).length
  ? { origine: `https://${process.env.DOMINIO || 'scorty.it'}`, canali, invia: (canale: string, testo: string, quando: Date) => inviaTelegram(token, canale, testo, quando) }
  : undefined
const app = costruisciApp({ segreto, passwordAdmin: process.env.ADMIN_PASSWORD, avvisi })
// Ogni 5 minuti la fotografia dell'ora per l'andamento delle province, se manca: arriva entro 5 minuti dall'ora piena,
// anche dopo un riavvio, e non si rifà due volte.
const fotografa = () => app.fotografaProvince().catch((e) => console.error('fotografia delle province fallita:', e.message))
setInterval(fotografa, 5 * 60 * 1000)
setTimeout(fotografa, 30_000)
await app.listen({ host: '0.0.0.0', port: 3000 })
