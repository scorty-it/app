import { readdir, readFile } from 'node:fs/promises'
import type pg from 'pg'

const cartella = new URL('../db/migrazioni/', import.meta.url)

// Applica in ordine i file .sql non ancora applicati, ognuno nella sua transazione.
export async function migra(pool: pg.Pool) {
  await pool.query('create table if not exists migrazioni (nome text primary key, applicata_il timestamptz not null default now())')
  const fatte = new Set((await pool.query('select nome from migrazioni')).rows.map((r) => r.nome))
  const file = (await readdir(cartella)).filter((f) => f.endsWith('.sql')).sort()

  for (const nome of file.filter((f) => !fatte.has(f))) {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(await readFile(new URL(nome, cartella), 'utf8'))
      await client.query('insert into migrazioni (nome) values ($1)', [nome])
      await client.query('commit')
      console.log(`migrazione applicata: ${nome}`)
    } catch (e) {
      await client.query('rollback')
      throw new Error(`migrazione ${nome} fallita`, { cause: e })
    } finally {
      client.release()
    }
  }
}
