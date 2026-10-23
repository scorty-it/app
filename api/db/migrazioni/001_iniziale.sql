create extension if not exists postgis;

create type prodotto as enum ('benzina', 'gasolio', 'gpl', 'metano');
create type stato as enum ('disponibile', 'scarso', 'esaurito');
create type livello_coda as enum ('nessuna', 'breve', 'lunga');

create table punti (
  id integer generated always as identity primary key,
  nome text not null,
  marchio text,
  indirizzo text,
  comune text,
  provincia text,
  geom geography(Point, 4326) not null,
  -- text[] e non prodotto[]: il driver pg non decodifica gli array di enum
  prodotti text[] not null check (prodotti <@ array['benzina', 'gasolio', 'gpl', 'metano']),
  fonte text not null,
  id_fonte text not null,
  -- false se l'impianto sparisce dall'ultimo import: non si cancella mai, le segnalazioni lo referenziano
  attivo boolean not null default true,
  aggiornato_il timestamptz not null default now(),
  unique (fonte, id_fonte)
);
create index on punti using gist (geom);

create table dispositivi (
  id uuid primary key default gen_random_uuid(),
  creato_il timestamptz not null default now(),
  bloccato boolean not null default false
);

-- dispositivo_id è nullable: viene azzerato dopo 30 giorni (minimizzazione GDPR)
create table segnalazioni (
  id integer generated always as identity primary key,
  punto_id integer not null references punti,
  prodotto prodotto not null,
  stato stato not null,
  dispositivo_id uuid references dispositivi on delete set null,
  creata_il timestamptz not null default now(),
  nascosta boolean not null default false
);
create index on segnalazioni (punto_id, creata_il desc);
create index on segnalazioni (dispositivo_id, creata_il desc);

-- "Confermo" (conferma = true) / "Non è vero" (conferma = false)
create table voti (
  segnalazione_id integer not null references segnalazioni on delete cascade,
  dispositivo_id uuid references dispositivi on delete set null,
  conferma boolean not null,
  creato_il timestamptz not null default now(),
  unique (segnalazione_id, dispositivo_id)
);
create index on voti (dispositivo_id, creato_il desc);

create table code (
  id integer generated always as identity primary key,
  punto_id integer not null references punti,
  livello livello_coda not null,
  dispositivo_id uuid references dispositivi on delete set null,
  creata_il timestamptz not null default now(),
  nascosta boolean not null default false
);
create index on code (punto_id, creata_il desc);
create index on code (dispositivo_id, creata_il desc);

-- Ultima apertura della scheda di un punto per dispositivo: serve per "vista da N persone"
-- e per "molto cercato". Cancellata dopo 24 ore.
create table viste (
  punto_id integer not null references punti,
  dispositivo_id uuid not null references dispositivi on delete cascade,
  vista_il timestamptz not null default now(),
  primary key (punto_id, dispositivo_id)
);

create table anomalie (
  id integer generated always as identity primary key,
  tipo text not null check (tipo in ('velocita_impossibile', 'fuori_raggio', 'limite_superato')),
  dispositivo_id uuid references dispositivi on delete set null,
  dettagli jsonb not null default '{}',
  creata_il timestamptz not null default now()
);
create index on anomalie (creata_il desc);

create table correzioni (
  id integer generated always as identity primary key,
  punto_id integer not null references punti,
  segnalazione_id integer references segnalazioni on delete set null,
  tipo text not null check (tipo in ('dati_errati', 'chiuso', 'gestore', 'altro')),
  messaggio text not null check (length(messaggio) between 1 and 2000),
  contatto text check (length(contatto) <= 200),
  chiusa_il timestamptz,
  creata_il timestamptz not null default now()
);
