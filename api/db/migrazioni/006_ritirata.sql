-- Segnalazione ritirata dal suo autore (corretta o annullata): non conta più come sua opinione,
-- ma i voti che altri le avevano dato restano, perché erano opinioni su quello stato.
-- «nascosta» resta solo per la moderazione, che toglie anche i voti.
-- Le segnalazioni corrette prima di questa migrazione restano nascoste: hanno più di 4 ore e non contano più.
alter table segnalazioni add column ritirata boolean not null default false;
