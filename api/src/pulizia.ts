import { sql } from 'kysely'
import { db } from './db.ts'

// Conservazione dei dati come scritto nella pagina Privacy. Gira all'avvio e poi ogni ora.
// Nota: in un'unica istruzione SQL i passi vedono tutti la stessa fotografia dei dati, quindi conteggio e cancellazione non si pestano i piedi.
export async function pulisci() {
  await sql`
    with
      a as (update segnalazioni set dispositivo_id = null where dispositivo_id is not null and creata_il < now() - interval '30 days'),
      b as (update voti set dispositivo_id = null where dispositivo_id is not null and creato_il < now() - interval '30 days'),
      c as (update code set dispositivo_id = null where dispositivo_id is not null and creata_il < now() - interval '30 days'),
      d as (delete from viste where vista_il < now() - interval '24 hours'),
      e as (delete from anomalie where creata_il < now() - interval '30 days'),
      f as (delete from ci_vado where creato_il < now() - interval '24 hours')
    delete from correzioni where chiusa_il < now() - interval '90 days'
  `.execute(db)
  // I visitatori dei giorni passati diventano un numero; l'elenco dei telefoni si cancella.
  await sql`
    with conteggi as (
      insert into statistiche (giorno, chiave, valore)
      select giorno, 'visitatori', count(*)::int from presenze where giorno < (now() at time zone 'Europe/Rome')::date group by giorno
      on conflict (giorno, chiave) do update set valore = excluded.valore
    )
    delete from presenze where giorno < (now() at time zone 'Europe/Rome')::date
  `.execute(db)
  // L'andamento per provincia e gli avvisi a enti e redazioni: soli numeri, nessun dato personale; si tengono un anno.
  await sql`delete from andamento where ora < now() - interval '1 year'`.execute(db)
  await sql`delete from avvisi where ora < now() - interval '1 year'`.execute(db)
}
