// Il widget per le testate contro un PostgreSQL vero: quante volte si apre, per sito. Parte solo su un database "_test".
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { sql } from 'kysely'
import { costruisciApp } from './app.ts'
import { db, pool } from './db.ts'
import { MAX_FONTI_AL_GIORNO } from './fonti.ts'
import { migra } from './migra.ts'

const attivo = process.env.PGDATABASE?.endsWith('_test') ?? false
const ADMIN = 'a'.repeat(16)
const app = costruisciApp({ segreto: 's'.repeat(32), passwordAdmin: ADMIN })
app.log.level = 'silent'

const apri = (sito?: string) => app.inject({ method: 'POST', url: '/api/widget/aperto', payload: sito === undefined ? {} : { sito } })
const statistiche = async () => (await app.inject({ url: '/api/admin/statistiche', headers: { authorization: `Bearer ${ADMIN}` } })).json()
const chiavi = async () =>
  (await sql<{ chiave: string; valore: number }>`select chiave, valore from statistiche order by chiave`.execute(db)).rows

describe('widget per le testate', { skip: !attivo && 'serve PGDATABASE che finisca con _test' }, () => {
  before(async () => {
    await migra(pool)
    await sql`truncate statistiche`.execute(db)
  })
  after(async () => {
    await app.close()
    await db.destroy()
  })

  test('ogni apertura si conta per sito: www e maiuscole sono lo stesso sito, un dominio non valido non si conta', async () => {
    for (const s of ['www.ilmattino.it', 'IlMattino.it', 'comune.salerno.it', 'localhost', undefined]) assert.equal((await apri(s)).statusCode, 204)
    assert.deepEqual((await statistiche()).widget, [
      { sito: 'ilmattino.it', aperture: 2 },
      { sito: 'comune.salerno.it', aperture: 1 },
      { sito: 'sconosciuto', aperture: 1 },
    ])
    // Non sono visite dell'app né fonti dei link.
    assert.deepEqual((await chiavi()).map((c) => c.chiave), ['widget:comune.salerno.it', 'widget:ilmattino.it', 'widget:sconosciuto'])
  })

  test('al massimo 30 siti nuovi al giorno; quelli già visti si contano sempre', async () => {
    await sql`truncate statistiche`.execute(db)
    for (let i = 0; i < MAX_FONTI_AL_GIORNO; i++) await apri(`sito${i}.it`)
    await apri('nuovo.it')
    await apri('sito0.it')
    const c = await chiavi()
    assert.equal(c.length, MAX_FONTI_AL_GIORNO)
    assert.ok(!c.some((x) => x.chiave === 'widget:nuovo.it'))
    assert.equal(c.find((x) => x.chiave === 'widget:sito0.it')?.valore, 2)
  })
})
