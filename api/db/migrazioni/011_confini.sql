-- I confini dei comuni (ISTAT, generalizzati), per dire in quale comune cade un negozio (territorio.ts). L'API li carica
-- all'avvio da api/db/confini-comuni.json; la versione serve a non ricaricare lo stesso file a ogni riavvio.
create table confini_comuni (
  codice text primary key, -- codice ISTAT del comune, sei cifre
  comune text not null,
  provincia text not null, -- sigla
  versione text not null, -- data dei confini ISTAT
  geom geometry(MultiPolygon, 4326) not null
);
create index on confini_comuni using gist (geom);
comment on table confini_comuni is 'Confini dei comuni (ISTAT): solo confini, nessun dato personale';
