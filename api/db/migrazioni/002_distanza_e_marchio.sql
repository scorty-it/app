-- Segnalazioni a distanza: chi è passato da poco (per esempio guidando) può segnalare dopo, fino a 30 km.
-- visto_il è quando ha visto il distributore; conta quello, non l'ora di invio.
alter table segnalazioni add column a_distanza boolean not null default false;
alter table segnalazioni add column visto_il timestamptz not null default now();
create index on segnalazioni (punto_id, visto_il desc);

-- Il gestore sceglie il marchio da un elenco; le note diventano facoltative.
alter table correzioni add column marchio text check (length(marchio) <= 50);
alter table correzioni drop constraint correzioni_messaggio_check;
alter table correzioni add constraint correzioni_messaggio_check check (length(messaggio) <= 2000);
