-- Prezzi praticati comunicati al Ministero (Osservatorio prezzi carburanti), sostituiti a ogni aggiornamento.
-- Per ogni carburante il più basso tra le varianti (per esempio gasolio e gasolio "premium"), self e servito separati.
create table prezzi (
  punto_id integer not null references punti,
  prodotto prodotto not null,
  self boolean not null,
  prezzo numeric(5, 3) not null check (prezzo > 0 and prezzo < 10),
  primary key (punto_id, prodotto, self)
);

-- Quando il distributore ha comunicato i prezzi l'ultima volta: se è passato molto, forse è chiuso.
alter table punti add column prezzi_comunicati_il timestamptz;
