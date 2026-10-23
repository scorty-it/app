// Andamento per provincia contro un PostgreSQL vero. Cancella tutto: parte solo su un database che finisce con "_test".
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { sql } from 'kysely'
import { costruisciApp } from './app.ts'
import { db, pool } from './db.ts'
import { BIT, zeriIniziali } from './firme.ts'
import { migra } from './migra.ts'
import { pulisci } from './pulizia.ts'

const attivo = process.env.PGDATABASE?.endsWith('_test') ?? false
const nuovaApp = () => {
  const app = costruisciApp({ segreto: 's'.repeat(32) })
  app.log.level = 'silent'
  return app
}
const app = nuovaApp()

const SALERNO = { lat: 40.68, lon: 14.77 }
let salerno = 0

async function nuovoDispositivo() {
  const s = (await app.inject({ url: '/api/sfida' })).json()
  let nonce = 0
  while (zeriIniziali(createHash('sha256').update(s.sfida + nonce).digest()) < BIT) nonce++
  return (await app.inject({ method: 'POST', url: '/api/dispositivo', payload: { sfida: s.sfida, firma: s.firma, nonce } })).json().token as string
}

const righe = async () =>
  (await sql<{ provincia: string; comuni_senza: number; comuni_senza_confermati: number; con_notizie: number; verde: number; giallo: number; rosso: number }>`
    select provincia, comuni_senza, comuni_senza_confermati, con_notizie, verde, giallo, rosso from andamento order by provincia
  `.execute(db)).rows

describe('andamento per provincia', { skip: !attivo && 'serve PGDATABASE che finisca con _test' }, () => {
  before(async () => {
    await migra(pool)
    await sql`truncate punti, dispositivi, segnalazioni, voti, code, viste, anomalie, correzioni, andamento restart identity cascade`.execute(db)
    const punto = (nome: string, p: { lat: number; lon: number }, comune: string, provincia: string) => sql<{ id: number }>`
      insert into punti (nome, geom, prodotti, fonte, id_fonte, comune, provincia)
      values (${nome}, ST_MakePoint(${p.lon}, ${p.lat})::geography, '{gasolio}', 'test', ${nome}, ${comune}, ${provincia}) returning id`.execute(db)
    salerno = (await punto('Salerno 1', SALERNO, 'Salerno', 'SA')).rows[0].id
    await punto('Salerno 2', { lat: 40.69, lon: 14.78 }, 'Salerno', 'SA')
    await punto('Napoli 1', { lat: 40.85, lon: 14.27 }, 'Napoli', 'NA')
  })
  after(async () => {
    await app.close()
    await db.destroy()
  })

  test('la fotografia dell’ora: una riga per provincia, gli stessi numeri del bollettino, una volta sola', async () => {
    // Salerno 1 finito, Salerno 2 senza notizie: Salerno è senza carburante, da confermare.
    const t = await nuovoDispositivo()
    const r = await app.inject({
      method: 'POST', url: '/api/segnalazioni', headers: { authorization: `Bearer ${t}` },
      payload: { punto_id: salerno, prodotto: 'gasolio', stato: 'esaurito', lat: SALERNO.lat, lon: SALERNO.lon },
    })
    assert.equal(r.statusCode, 200)

    assert.equal(await app.fotografaProvince(), 2)
    assert.deepEqual(await righe(), [
      { provincia: 'NA', comuni_senza: 0, comuni_senza_confermati: 0, con_notizie: 0, verde: 0, giallo: 0, rosso: 0 },
      { provincia: 'SA', comuni_senza: 1, comuni_senza_confermati: 0, con_notizie: 1, verde: 0, giallo: 0, rosso: 1 },
    ])
    const b = (await app.inject({ url: '/api/province/SA' })).json()
    assert.equal(b.comuni.filter((c: { gruppo: string }) => c.gruppo === 'senza_carburante').length, 1)
    assert.equal(b.rosso, 1)

    assert.equal(await app.fotografaProvince(), 0) // la fotografia di quest'ora c'è già
    assert.equal((await righe()).length, 2)
  })

  test('il bollettino porta l’andamento delle ultime 24 ore, dalla più vecchia', async () => {
    await sql`
      insert into andamento (ora, provincia, comuni_senza, comuni_senza_confermati, con_notizie, verde, giallo, rosso) values
        (date_trunc('hour', now()) - interval '30 hours', 'SA', 9, 9, 9, 0, 0, 9),
        (date_trunc('hour', now()) - interval '3 hours', 'SA', 4, 2, 5, 1, 0, 4)
    `.execute(db)
    const altra = nuovaApp() // cache vuota: il bollettino di SA qui sopra è già in cache
    const { andamento } = (await altra.inject({ url: '/api/province/SA' })).json()
    await altra.close()
    assert.deepEqual(andamento.map((a: { comuni_senza: number }) => a.comuni_senza), [4, 1])
    assert.deepEqual(Object.keys(andamento[0]).sort(), ['comuni_senza', 'comuni_senza_confermati', 'con_notizie', 'giallo', 'ora', 'rosso', 'verde'])
    assert.equal(Date.parse(andamento[1].ora) - Date.parse(andamento[0].ora), 3 * 60 * 60 * 1000)
  })

  test('la pulizia cancella le fotografie con più di un anno', async () => {
    await sql`
      insert into andamento (ora, provincia, comuni_senza, comuni_senza_confermati, con_notizie, verde, giallo, rosso) values
        (now() - interval '366 days', 'NA', 1, 0, 1, 0, 0, 1), (now() - interval '364 days', 'NA', 2, 0, 2, 0, 0, 2)
    `.execute(db)
    await pulisci()
    const { rows } = await sql<{ comuni_senza: number }>`select comuni_senza from andamento where ora < now() - interval '300 days'`.execute(db)
    assert.deepEqual(rows.map((r) => r.comuni_senza), [2])
  })
})
