-- Dati di esempio per sviluppo locale: 10 distributori finti a Napoli e Bari con segnalazioni recenti.
-- Rieseguibile: cancella e ricrea i dati di esempio, con orari relativi a adesso.
-- Uso: docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < api/db/esempio.sql
-- NON usarlo in produzione.

begin;

delete from code where punto_id in (select id from punti where fonte = 'esempio');
delete from viste where punto_id in (select id from punti where fonte = 'esempio');
delete from correzioni where punto_id in (select id from punti where fonte = 'esempio');
delete from segnalazioni where punto_id in (select id from punti where fonte = 'esempio');
delete from punti where fonte = 'esempio';
delete from dispositivi where id::text like '00000000-0000-0000-0000-%';

insert into punti (nome, marchio, indirizzo, comune, provincia, geom, prodotti, fonte, id_fonte)
select nome, 'Esempio', indirizzo, comune, provincia,
       st_makepoint(lon, lat)::geography, prodotti, 'esempio', id_fonte
from (values
  ('e1',  'Esempio Toledo',      'Via Toledo 1',              'Napoli', 'NA', 14.2487, 40.8420, array['benzina','gasolio']),
  ('e2',  'Esempio Marina',      'Via Marina 10',             'Napoli', 'NA', 14.2650, 40.8460, array['benzina','gasolio','gpl']),
  ('e3',  'Esempio Fuorigrotta', 'Viale Augusto 50',          'Napoli', 'NA', 14.1960, 40.8270, array['benzina','gasolio','metano']),
  ('e4',  'Esempio Vomero',      'Via Cilea 20',              'Napoli', 'NA', 14.2240, 40.8470, array['benzina','gasolio']),
  ('e5',  'Esempio Capodichino', 'Calata Capodichino 5',      'Napoli', 'NA', 14.2780, 40.8700, array['benzina','gasolio','gpl','metano']),
  ('e6',  'Esempio Murat',       'Via Murat 3',               'Bari',   'BA', 16.8700, 41.1240, array['benzina','gasolio']),
  ('e7',  'Esempio Japigia',     'Viale Japigia 100',         'Bari',   'BA', 16.8920, 41.1060, array['benzina','gasolio','gpl']),
  ('e8',  'Esempio Poggiofranco','Viale Einaudi 40',          'Bari',   'BA', 16.8650, 41.1050, array['benzina','gasolio']),
  ('e9',  'Esempio San Paolo',   'Viale Europa 200',          'Bari',   'BA', 16.8100, 41.1150, array['benzina','gasolio','metano']),
  ('e10', 'Esempio Lungomare',   'Lungomare Nazario Sauro 8', 'Bari',   'BA', 16.8830, 41.1180, array['benzina','gasolio'])
) as v(id_fonte, nome, indirizzo, comune, provincia, lon, lat, prodotti);

insert into dispositivi (id)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 5) n;

-- (punto, prodotto, stato, dispositivo, minuti fa)
insert into segnalazioni (punto_id, prodotto, stato, dispositivo_id, creata_il)
select p.id, s.prodotto::prodotto, s.stato::stato,
       ('00000000-0000-0000-0000-' || lpad(s.disp::text, 12, '0'))::uuid,
       now() - make_interval(mins => s.minuti)
from (values
  ('e1', 'gasolio', 'esaurito',    1, 25),   -- affidabile: 3 dispositivi
  ('e1', 'gasolio', 'esaurito',    2, 15),
  ('e1', 'gasolio', 'esaurito',    3, 5),
  ('e1', 'benzina', 'disponibile', 1, 25),   -- da confermare: 1 dispositivo
  ('e2', 'gasolio', 'disponibile', 2, 10),   -- affidabile
  ('e2', 'gasolio', 'disponibile', 4, 3),
  ('e2', 'benzina', 'scarso',      2, 10),
  ('e3', 'gasolio', 'disponibile', 3, 40),   -- incerto: segnalazioni contrastanti
  ('e3', 'gasolio', 'esaurito',    4, 35),
  ('e4', 'benzina', 'disponibile', 5, 200),  -- vecchia: quasi scaduta
  ('e6', 'gasolio', 'esaurito',    1, 90),   -- rifornito di recente
  ('e6', 'gasolio', 'disponibile', 2, 20),
  ('e6', 'gasolio', 'disponibile', 3, 12),
  ('e7', 'gpl',     'esaurito',    4, 30),
  ('e9', 'metano',  'disponibile', 5, 50)
) as s(id_fonte, prodotto, stato, disp, minuti)
join punti p on p.fonte = 'esempio' and p.id_fonte = s.id_fonte;

-- conferma su e4, smentita su e9
insert into voti (segnalazione_id, dispositivo_id, conferma, creato_il)
select s.id, ('00000000-0000-0000-0000-' || lpad(v.disp::text, 12, '0'))::uuid, v.conferma,
       now() - make_interval(mins => v.minuti)
from (values ('e4', 1, true, 60), ('e9', 1, false, 10)) as v(id_fonte, disp, conferma, minuti)
join punti p on p.fonte = 'esempio' and p.id_fonte = v.id_fonte
join segnalazioni s on s.punto_id = p.id;

insert into code (punto_id, livello, dispositivo_id, creata_il)
select p.id, c.livello::livello_coda, ('00000000-0000-0000-0000-' || lpad(c.disp::text, 12, '0'))::uuid,
       now() - make_interval(mins => c.minuti)
from (values ('e2', 'lunga', 2, 8), ('e2', 'lunga', 4, 3), ('e6', 'breve', 3, 12)) as c(id_fonte, livello, disp, minuti)
join punti p on p.fonte = 'esempio' and p.id_fonte = c.id_fonte;

-- e2 molto cercato: 5 aperture della scheda negli ultimi 30 minuti
insert into viste (punto_id, dispositivo_id, vista_il)
select p.id, ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, now() - make_interval(mins => n * 4)
from punti p, generate_series(1, 5) n
where p.fonte = 'esempio' and p.id_fonte = 'e2';

commit;
