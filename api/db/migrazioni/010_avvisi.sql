-- Avvisi a enti e redazioni (avvisi.ts): quando in una provincia aumentano i comuni senza carburante confermati, e una
-- volta quando tornano a calare. Servono per la pausa tra un avviso e l'altro e per il feed RSS della provincia.
-- Solo numeri, nessun dato personale; si tengono un anno (pulizia.ts).
create table avvisi (
  id integer generated always as identity primary key, -- per la guid del feed
  provincia text not null,
  ora timestamptz not null, -- ora della fotografia che l'ha fatto partire
  tipo text not null check (tipo in ('peggiora', 'migliora')),
  adesso int not null, -- comuni senza carburante confermati
  prima int not null,
  ora_prima timestamptz not null,
  telegram_il timestamptz, -- quando è partito nel canale della regione; vuoto se non è partito
  unique (provincia, ora)
);
