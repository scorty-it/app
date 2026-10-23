-- Andamento per provincia: ogni ora una fotografia dei numeri del bollettino (app.ts, fotografaProvince).
-- Si salva e non si ricalcola perché le ore passate restino quelle che il bollettino ha mostrato, anche dopo
-- moderazioni e correzioni. Solo conteggi, nessun dato personale; si tiene un anno (pulizia.ts).
create table andamento (
  provincia text not null,
  ora timestamptz not null, -- ora piena della fotografia
  comuni_senza int not null, -- comuni senza carburante, anche da confermare
  comuni_senza_confermati int not null,
  con_notizie int not null, -- distributori con notizie: verde + giallo + rosso
  verde int not null,
  giallo int not null,
  rosso int not null,
  primary key (provincia, ora)
);
