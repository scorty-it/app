-- Ricerca dei distributori tollerante agli errori di battitura (trigrammi), senza accenti né punteggiatura:
-- "cava de tirreni" trova "Cava De' Tirreni", "pozzoli" trova "Pozzuoli".
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- unaccent non è dichiarata immutabile: serve un involucro per usarla in una colonna calcolata e in un indice.
create function scorty_norm(t text) returns text
  language sql immutable parallel safe strict
  as $$ select regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, t)), '[^a-z0-9]+', ' ', 'g') $$;

alter table punti add column ricerca text generated always as (
  scorty_norm(coalesce(nome, '') || ' ' || coalesce(marchio, '') || ' ' || coalesce(indirizzo, '') || ' ' || coalesce(comune, '') || ' ' || coalesce(provincia, ''))
) stored;
-- ponytail: niente indice, con ~6.000 distributori il confronto diretto costa pochi millisecondi.
-- Se diventano molti di più: create index on punti using gin (ricerca gin_trgm_ops), con gli operatori <% al posto delle soglie.
