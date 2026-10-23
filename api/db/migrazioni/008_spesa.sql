-- La spesa: negozi accanto ai distributori, sette categorie di beni, il segnale «Ci vado».
-- I valori nuovi dell'enum non si usano in questo file (la migrazione gira in una transazione).
alter type prodotto add value 'acqua';
alter type prodotto add value 'latte';
alter type prodotto add value 'pane';
alter type prodotto add value 'frutta_verdura';
alter type prodotto add value 'pasta_riso';
alter type prodotto add value 'carne_pesce';
alter type prodotto add value 'neonati';

alter table punti add column tipo text not null default 'distributore' check (tipo in ('distributore', 'negozio'));

-- un negozio ha solo beni, un distributore solo carburanti (testo e non enum: i valori nuovi non sono usabili qui)
alter table punti drop constraint punti_prodotti_check;
alter table punti add constraint punti_prodotti_check check (
  case tipo
    when 'distributore' then prodotti <@ array['benzina', 'gasolio', 'gpl', 'metano']
    else prodotti <@ array['acqua', 'latte', 'pane', 'frutta_verdura', 'pasta_riso', 'carne_pesce', 'neonati']
  end
);

-- la visita lega segnalazioni e code fatte nella stessa sosta in un negozio
alter table segnalazioni add column visita uuid;
alter table code add column visita uuid;

-- «Ci vado»: un segnale di intenzione, cancellato dopo 24 h (vedi pulizia) ed escluso dai backup
create table ci_vado (
  id integer generated always as identity primary key,
  dispositivo_id uuid not null references dispositivi on delete cascade,
  punto_id integer not null references punti,
  prodotti text[] not null default '{}' check (prodotti <@ array['acqua', 'latte', 'pane', 'frutta_verdura', 'pasta_riso', 'carne_pesce', 'neonati']),
  creato_il timestamptz not null default now(),
  chiuso_il timestamptz
);
create unique index on ci_vado (dispositivo_id) where chiuso_il is null;
create index on ci_vado (punto_id, creato_il desc);
create index on ci_vado (dispositivo_id, creato_il desc);
