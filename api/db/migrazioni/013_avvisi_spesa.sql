-- Un messaggio unico per carburante e spesa (avvisi.ts): oltre ai comuni senza carburante confermati (adesso, prima) l'avviso
-- salva, per bene, i comuni senza confermati al momento dell'avviso e nella fotografia di confronto. Servono al miglioramento
-- («tutto quello che era peggiorato è calato») e al testo del feed. Solo conteggi, nessun dato personale; si tengono un anno.
-- Nullable: un avviso di prima della spesa non dice «nessun bene», dice che non lo sapeva, e nel feed si legge come prima.
alter table avvisi
  add column beni jsonb,
  add column beni_prima jsonb;
comment on column avvisi.beni is 'Per bene, i comuni senza confermati al momento dell''avviso: {"acqua": 2}, {} se nessuno; null prima della spesa';
comment on column avvisi.beni_prima is 'Lo stesso nella fotografia di confronto; null se quella era di prima della spesa';
