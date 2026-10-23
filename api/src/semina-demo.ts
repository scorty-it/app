// Dati per provare Scorty senza aspettare l'importazione da OpenStreetMap.
// - Senza opzioni: se il database non ha distributori, carica quelli del file (© OpenStreetMap contributors, ODbL),
//   scaricati una volta con Overpass. Sicuro anche in produzione.
// - Con --inventa-attivita: CANCELLA tutte le segnalazioni e ne inventa di nuove sui distributori attivi. Solo sviluppo.
// Uso: docker compose exec api node src/semina-demo.ts [--inventa-attivita]
import { readFile } from 'node:fs/promises'
import { sql } from 'kysely'
import { db, type LivelloCoda, type Prodotto, type Stato } from './db.ts'

// Riga: lat, lon, nome, marchio, indirizzo, comune, prodotti (bit: 1 benzina, 2 gasolio, 4 GPL, 8 metano).
type Riga = [number, number, string, string | null, string | null, string | null, number]
const PRODOTTI: Prodotto[] = ['benzina', 'gasolio', 'gpl', 'metano']

const inventa = process.argv.includes('--inventa-attivita')
const righe: Riga[] = JSON.parse(await readFile(new URL('../db/demo-distributori.json', import.meta.url), 'utf8'))
const r = Math.random
const scegli = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]
const minutiFa = (m: number) => new Date(Date.now() - m * 60000)
const aBlocchi = <T>(xs: T[], n = 2000) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

await db.transaction().execute(async (tx) => {
  const { rows: [{ attivi }] } = await sql<{ attivi: number }>`select count(*)::int as attivi from punti where attivo`.execute(tx)
  if (!attivi) for (const blocco of aBlocchi(righe.map((x, i) => [i, ...x] as const))) {
    await sql`
      insert into punti (nome, marchio, indirizzo, comune, geom, prodotti, fonte, id_fonte)
      select x.nome, x.marchio, x.indirizzo, x.comune, ST_MakePoint(x.lon, x.lat)::geography, x.prodotti::text[], 'osm-demo', x.id
      from json_to_recordset(${JSON.stringify(blocco.map(([i, lat, lon, nome, marchio, indirizzo, comune, bit]) => ({
        id: String(i), lat, lon, nome, marchio, indirizzo, comune, prodotti: `{${PRODOTTI.filter((_, k) => bit & (1 << k)).join(',')}}`,
      })))}::json)
        as x(id text, lat float8, lon float8, nome text, marchio text, indirizzo text, comune text, prodotti text)
      on conflict (fonte, id_fonte) do update set nome = excluded.nome, marchio = excluded.marchio, geom = excluded.geom, prodotti = excluded.prodotti
    `.execute(tx)
  }

  if (!inventa) return console.log(attivi ? `${attivi} distributori già presenti: niente da caricare` : `${righe.length} distributori caricati dal file`)

  const demo = sql`(select id from punti where attivo)`
  await sql`delete from voti where segnalazione_id in (select id from segnalazioni where punto_id in ${demo})`.execute(tx)
  for (const t of ['segnalazioni', 'code', 'viste', 'correzioni']) await sql`delete from ${sql.table(t)} where punto_id in ${demo}`.execute(tx)
  await sql`delete from dispositivi d where creato_il < now() - interval '9 days' and not exists (select 1 from segnalazioni where dispositivo_id = d.id)`.execute(tx)

  // Telefoni con qualche giorno di vita: pesano come utenti normali.
  const dispositivi = (await tx.insertInto('dispositivi')
    .values(Array.from({ length: 4000 }, () => ({ creato_il: minutiFa(60 * 24 * 10) })))
    .returning('id').execute()).map((d) => d.id)

  const punti = await tx.selectFrom('punti').select(['id', 'prodotti']).where('attivo', '=', true).execute()
  const segnalazioni: { punto_id: number; prodotto: Prodotto; stato: Stato; dispositivo_id: string; visto_il: Date; creata_il: Date; a_distanza: boolean }[] = []
  const conferme: { indice: number; dispositivo_id: string; conferma: boolean; creato_il: Date }[] = []
  const code: { punto_id: number; livello: LivelloCoda; dispositivo_id: string; creata_il: Date }[] = []
  const viste: { punto_id: number; dispositivo_id: string; vista_il: Date }[] = []

  for (const p of punti) {
    if (r() < 0.25) continue
    for (const prodotto of p.prodotti) {
      if (r() < 0.25) continue
      const x = r()
      const stato: Stato = x < 0.5 ? 'disponibile' : x < 0.68 ? 'scarso' : 'esaurito'
      const il = minutiFa(Math.floor(r() ** 1.5 * 230))
      const chi = scegli(dispositivi)
      const aDistanza = r() < 0.12
      segnalazioni.push({ punto_id: p.id, prodotto, stato, dispositivo_id: chi, visto_il: il, creata_il: il, a_distanza: aDistanza })
      const y = r()
      const indice = segnalazioni.length - 1
      const altri = () => scegli(dispositivi.filter((d) => d !== chi))
      // 55% confermato da altri, 10% contestato, il resto con una sola segnalazione
      if (y < 0.55) for (let k = 0; k < 1 + Math.floor(r() * 4); k++) conferme.push({ indice, dispositivo_id: altri(), conferma: true, creato_il: il })
      else if (y < 0.65) {
        conferme.push({ indice, dispositivo_id: altri(), conferma: false, creato_il: il })
        conferme.push({ indice, dispositivo_id: altri(), conferma: false, creato_il: il })
      }
    }
    const c = r()
    if (c < 0.3) code.push({ punto_id: p.id, livello: c < 0.1 ? 'lunga' : c < 0.2 ? 'breve' : 'nessuna', dispositivo_id: scegli(dispositivi), creata_il: minutiFa(Math.floor(r() * 50)) })
    for (let k = 0; k < Math.floor(r() ** 3 * 30); k++) viste.push({ punto_id: p.id, dispositivo_id: scegli(dispositivi), vista_il: minutiFa(Math.floor(r() * 29)) })
  }

  const ids: number[] = []
  for (const b of aBlocchi(segnalazioni)) ids.push(...(await tx.insertInto('segnalazioni').values(b).returning('id').execute()).map((s) => s.id))
  const voti = new Map(conferme.map((v) => [`${ids[v.indice]}:${v.dispositivo_id}`, { segnalazione_id: ids[v.indice], dispositivo_id: v.dispositivo_id, conferma: v.conferma, creato_il: v.creato_il }]))
  for (const b of aBlocchi([...voti.values()])) await tx.insertInto('voti').values(b).execute()
  for (const b of aBlocchi(code)) await tx.insertInto('code').values(b).execute()
  const unicheViste = new Map(viste.map((v) => [`${v.punto_id}:${v.dispositivo_id}`, v]))
  for (const b of aBlocchi([...unicheViste.values()])) await tx.insertInto('viste').values(b).execute()
  console.log(`${punti.length} distributori, ${ids.length} segnalazioni, ${voti.size} voti, ${code.length} code`)
})
await db.destroy()
