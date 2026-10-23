-- Statistiche aggregate per giorno (ora italiana): solo conteggi, nessun dato sulle persone.
create table statistiche (
  giorno date not null,
  chiave text not null, -- visite, visite_app, ricerche, schede, visitatori
  valore integer not null default 0,
  primary key (giorno, chiave)
);

-- I telefoni anonimi visti oggi, solo per contare i visitatori unici:
-- a fine giornata diventano un numero in statistiche e le righe si cancellano (vedi pulizia.ts).
create table presenze (
  giorno date not null,
  dispositivo_id uuid not null references dispositivi on delete cascade,
  primary key (giorno, dispositivo_id)
);
