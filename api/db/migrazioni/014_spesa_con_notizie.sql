-- Quanti negozi hanno notizie, nell'andamento orario e negli avvisi (app.ts, fotografaProvince e valutaAvvisi). Serve a dire
-- «nessuna notizia dai negozi» invece di «nessun comune senza beni»: spesa_beni = {} e gli zeri valgono sia quando i negozi
-- dicono che va tutto bene sia quando non c'è nessuna notizia, e senza notizie non si dice che va tutto bene.
-- Solo un conteggio, nessun dato personale; si tiene un anno insieme al resto della riga (pulizia.ts).
-- Nullable: una fotografia o un avviso di prima di questa colonna non lo sapevano, e si leggono come prima.
alter table andamento add column spesa_con_notizie int;
alter table avvisi add column spesa_con_notizie int;
comment on column andamento.spesa_con_notizie is 'Negozi della provincia con almeno un bene dallo stato noto in quell''ora (con_notizie di spesaDelBollettino); 0 = nessuna notizia dai negozi; null = fotografia di prima di questa colonna';
comment on column avvisi.spesa_con_notizie is 'Lo stesso, nella fotografia che ha fatto partire l''avviso; null = avviso di prima di questa colonna';
