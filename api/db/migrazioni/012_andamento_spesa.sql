-- L'andamento orario conta anche la spesa (app.ts, fotografaProvince): i comuni senza un bene (acqua, pane, latte…).
-- Solo conteggi, nessun dato personale; si tengono un anno insieme al resto della riga (pulizia.ts).
-- Nullable: una fotografia di prima della spesa non dice «zero», dice che non lo sapeva.
alter table andamento
  add column spesa_comuni_senza int,
  add column spesa_comuni_senza_confermati int,
  add column spesa_beni jsonb;
comment on column andamento.spesa_comuni_senza is 'Comuni senza almeno un bene della spesa, anche da confermare; null prima della spesa';
comment on column andamento.spesa_comuni_senza_confermati is 'Comuni con almeno un bene senza, confermato (almeno due persone d''accordo); null prima della spesa';
comment on column andamento.spesa_beni is 'Per bene, i comuni senza confermati: {"acqua": 2}; solo i beni con almeno uno, {} se nessuno; null prima della spesa';
