// Confini dei comuni (ISTAT) e comune dei negozi: ogni negozio prende comune e provincia dal confine che lo copre.
// OpenStreetMap non basta: l'indirizzo dei negozi quasi sempre non ha provincia (vedi daOsmNegozio).
import { readFile } from 'node:fs/promises'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { FileConfini } from './confini.ts'
import { db, type DB } from './db.ts'

const FILE = new URL('../db/confini-comuni.json', import.meta.url)
const COMUNI_PER_ISTRUZIONE = 200 // circa mezzo MB di JSON ognuna

// Porta i confini nel database: senza argomento quelli di api/db/confini-comuni.json (si rifanno con src/confini.ts).
// Se la tabella ha già quella versione e lo stesso numero di comuni non fa niente e rende 0; altrimenti sostituisce tutto
// e riassegna i negozi, in una sola transazione (se qualcosa va storto restano i confini di prima). Rende i comuni caricati.
export async function caricaConfini(file?: FileConfini) {
  const { comuni, versione, srid } = file ?? (JSON.parse(await readFile(FILE, 'utf8')) as FileConfini)
  if (srid !== 32632) throw new Error(`confini: sistema di coordinate ${srid} non gestito (serve 32632)`)
  const { rows: [carichi] } = await sql<{ totale: number; stessa: number }>`
    select count(*)::int as totale, (count(*) filter (where versione = ${versione}))::int as stessa from confini_comuni
  `.execute(db)
  if (carichi.totale === comuni.length && carichi.stessa === comuni.length) return 0

  return db.transaction().execute(async (tx) => {
    await sql`delete from confini_comuni`.execute(tx)
    for (let i = 0; i < comuni.length; i += COMUNI_PER_ISTRUZIONE) {
      // Gli anelli del file sono linee chiuse in UTM 32N, tutti uguali tra loro (anche i buchi): ST_BuildArea ricostruisce
      // le aree e i buchi dalla posizione degli anelli, senza guardarne il verso. ST_Node prima, perché Bronte e
      // Sannicandro di Bari hanno un anello che tocca se stesso in un punto (un buco attaccato al bordo) e senza dà null.
      // Se un anello non si chiude dà null comunque e l'inserimento fallisce, così un file rotto non passa in silenzio.
      await sql`
        insert into confini_comuni (codice, comune, provincia, versione, geom)
        select x.codice, x.comune, x.provincia, ${versione}::text,
          ST_Multi(ST_Transform(ST_SetSRID(ST_BuildArea(ST_Node(ST_GeomFromGeoJSON(
            json_build_object('type', 'MultiLineString', 'coordinates', x.anelli)::text
          ))), 32632), 4326))
        from json_to_recordset(${JSON.stringify(comuni.slice(i, i + COMUNI_PER_ISTRUZIONE))}::json)
          as x(codice text, comune text, provincia text, anelli json)
      `.execute(tx)
    }
    await assegnaComuniNegozi(tx)
    return comuni.length
  })
}

// Ogni negozio prende comune e provincia del confine che lo copre; senza confine restano entrambi null. I distributori
// no: hanno comune e provincia del Ministero. Un punto sul bordo tra due comuni va al codice più basso, sempre lo stesso.
// Rende quanti negozi hanno un comune.
export async function assegnaComuniNegozi(conn: Kysely<DB> | Transaction<DB>) {
  const { rows: [r] } = await sql<{ n: number }>`
    with assegnati as (
      select p.id, c.comune, c.provincia
      from punti p
      left join lateral (
        select comune, provincia from confini_comuni where ST_Covers(geom, p.geom::geometry) order by codice limit 1
      ) c on true
      where p.tipo = 'negozio'
    ), scritti as (
      update punti p set comune = a.comune, provincia = a.provincia
      from assegnati a
      where p.id = a.id and (p.comune, p.provincia) is distinct from (a.comune, a.provincia)
    )
    select count(comune)::int as n from assegnati
  `.execute(conn)
  return r.n
}
