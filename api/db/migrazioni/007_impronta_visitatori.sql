-- Visitatori unici senza l'identificativo del telefono: al suo posto un'impronta che vale un giorno solo
-- (improntaVisitatore in firme.ts, con il segreto del server). Non porta al telefono né alle sue segnalazioni.
-- Le righe già presenti (solo oggi: le altre la pulizia notturna le ha già ridotte a un numero) diventano
-- un'impronta qualsiasi: servono solo a contare, e stanotte spariscono.
alter table presenze drop constraint presenze_dispositivo_id_fkey;
alter table presenze alter column dispositivo_id type text using md5(dispositivo_id::text || giorno::text);
alter table presenze rename column dispositivo_id to impronta;
