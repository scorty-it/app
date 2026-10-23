#!/bin/sh
# Prova che l'ultimo backup si ripristini davvero: lo carica in un database temporaneo,
# confronta i conteggi con il database in uso e poi cancella la copia. Non tocca i dati veri.
# Uso, dalla cartella del progetto sul server:  sh scripts/prova-ripristino.sh
set -eu
PROVA=scorty_prova_ripristino
# Dal .env servono solo utente e nome del database (le altre righe possono contenere spazi).
POSTGRES_USER=$(grep '^POSTGRES_USER=' .env | cut -d= -f2-)
POSTGRES_DB=$(grep '^POSTGRES_DB=' .env | cut -d= -f2-)
psql() { docker compose exec -T db psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -q "$@"; }

echo "1. Backup fresco"
docker compose exec -T backup /backup.sh </dev/null >/dev/null
FILE=$(ls -t backups/last/scorty-2*.sql.gz | head -1)
echo "   $FILE ($(du -h "$FILE" | cut -f1))"

echo "2. Ripristino in un database temporaneo"
psql -d postgres -c "drop database if exists $PROVA" -c "create database $PROVA" </dev/null
# Con il psql del contenitore dei backup: è la stessa versione che li scrive (un psql più vecchio
# non riconosce comandi come \restrict, aggiunti nelle versioni recenti).
gunzip -c "$FILE" | docker compose exec -T backup sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -U "$POSTGRES_USER" -d '"$PROVA"' -v ON_ERROR_STOP=1 -q' >/dev/null

echo "3. Confronto dei conteggi (in uso / ripristinato)"
ERRORI=0
for T in punti prezzi dispositivi segnalazioni voti code correzioni migrazioni; do
  A=$(psql -d "$POSTGRES_DB" -At -c "select count(*) from $T" </dev/null)
  B=$(psql -d "$PROVA" -At -c "select count(*) from $T" </dev/null)
  [ "$A" = "$B" ] && ESITO=ok || { ESITO="DIVERSO"; ERRORI=$((ERRORI + 1)); }
  printf '   %-14s %8s %8s  %s\n' "$T" "$A" "$B" "$ESITO"
done
# Le funzioni contano quanto i dati: la ricerca usa scorty_norm
psql -d "$PROVA" -At -c "select scorty_norm('Cava De'' Tirreni')" </dev/null | sed 's/^/   ricerca: /'

echo "4. Pulizia"
psql -d postgres -c "drop database $PROVA" </dev/null
[ "$ERRORI" = 0 ] && echo "Ripristino riuscito." || { echo "ATTENZIONE: $ERRORI tabelle diverse."; exit 1; }
