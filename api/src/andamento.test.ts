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
    assert.deepEqual(Object.keys(andamento[0]).sort(), [
      'comuni_senza', 'comuni_senza_confermati', 'con_notizie', 'giallo', 'ora', 'rosso', 'spesa_comuni_senza', 'spesa_comuni_senza_confermati',
      'spesa_con_notizie', 'verde',
    ])
    // Una fotografia di prima della spesa non dice «zero», dice che non lo sapeva; quella di quest'ora (test sopra) lo sa.
    assert.deepEqual(andamento.map((a: { spesa_comuni_senza: number | null }) => a.spesa_comuni_senza), [null, 0])
    // Lo stesso per quanti negozi avevano notizie: null prima di quel dato; zero (nessun negozio a Salerno) per quella di quest'ora.
    assert.deepEqual(andamento.map((a: { spesa_con_notizie: number | null }) => a.spesa_con_notizie), [null, 0])
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

  test('la fotografia dell’ora salva anche i numeri della spesa', async () => {
    // Un negozio a Salerno con l'acqua finita per due telefoni: un comune senza acqua, confermato. A Napoli niente negozi.
    await sql`delete from andamento`.execute(db)
    const { rows: [{ id: negozio }] } = await sql<{ id: number }>`
      insert into punti (nome, tipo, geom, prodotti, fonte, id_fonte, comune, provincia)
      values ('Spesa Salerno', 'negozio', ST_MakePoint(${SALERNO.lon}, ${SALERNO.lat})::geography, '{acqua,pane}', 'test-spesa', 'spesa-salerno', 'Salerno', 'SA')
      returning id`.execute(db)
    try {
      for (let i = 0; i < 2; i++) {
        const { rows: [{ id: telefono }] } = await sql<{ id: string }>`insert into dispositivi default values returning id`.execute(db)
        await sql`insert into segnalazioni (punto_id, prodotto, stato, dispositivo_id) values (${negozio}, 'acqua', 'esaurito', ${telefono})`.execute(db)
      }
      assert.equal(await app.fotografaProvince(), 2)
      const { rows } = await sql`
        select provincia, spesa_comuni_senza, spesa_comuni_senza_confermati, spesa_beni, spesa_con_notizie from andamento order by provincia
      `.execute(db)
      assert.deepEqual(rows, [
        // Niente negozi: zeri veri, non null; e zero negozi con notizie, che è la differenza tra «va tutto bene» e «non si sa».
        { provincia: 'NA', spesa_comuni_senza: 0, spesa_comuni_senza_confermati: 0, spesa_beni: {}, spesa_con_notizie: 0 },
        { provincia: 'SA', spesa_comuni_senza: 1, spesa_comuni_senza_confermati: 1, spesa_beni: { acqua: 1 }, spesa_con_notizie: 1 },
      ])

      // Il bollettino dice gli stessi numeri della fotografia (e, per l'ora in corso, li ha già salvati).
      const altra = nuovaApp() // cache vuota
      const b = (await altra.inject({ url: '/api/province/SA' })).json()
      await altra.close()
      assert.deepEqual(b.spesa.beni, [{ bene: 'acqua', comuni: [{ comune: 'Salerno', confermato: true }] }])
      const ultima = b.andamento.at(-1)
      assert.deepEqual([ultima.spesa_comuni_senza, ultima.spesa_comuni_senza_confermati, ultima.spesa_con_notizie], [1, 1, 1])
    } finally {
      await sql`delete from andamento`.execute(db)
      await sql`delete from segnalazioni where punto_id = ${negozio}`.execute(db)
      await sql`delete from punti where id = ${negozio}`.execute(db)
    }
  })
})
