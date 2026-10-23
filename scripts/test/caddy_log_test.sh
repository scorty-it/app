#!/usr/bin/env bash
# Test del Caddyfile: quando l'API non risponde (per esempio durante un deploy) Caddy scrive l'errore nel suo log,
# ma senza IP, posizione e testo cercato, che stanno nell'indirizzo della richiesta.
# Uso: bash scripts/test/caddy_log_test.sh      (serve Docker; IMMAGINE=<immagine> per provare un'altra versione di Caddy)
set -euo pipefail

radice="$(cd "$(dirname "$0")/../.." && pwd)"
immagine="${IMMAGINE:-$(sed -n 's/^FROM \(caddy:[^ ]*\).*/\1/p' "$radice/web/Dockerfile")}"
nome="scorty-test-caddy-log-$$"
trap 'docker rm -f "$nome" >/dev/null 2>&1 || true' EXIT

# Nessun contenitore «api» sulla rete: ogni /api/* finisce in un 502, come mentre l'API si riavvia.
docker run -d --name "$nome" -p 127.0.0.1::80 -e SITI=:80 -e DOMINIO=localhost \
  -v "$radice/Caddyfile:/etc/caddy/Caddyfile:ro" "$immagine" >/dev/null
porta="$(docker port "$nome" 80/tcp | head -1 | sed 's/.*://')"

pronto=""
for _ in $(seq 50); do
  if curl -s -o /dev/null -H 'Host: localhost' "http://127.0.0.1:$porta/"; then pronto=1; break; fi
  sleep 0.2
done
[[ -n "$pronto" ]] || { echo "FAIL: Caddy non risponde"; docker logs "$nome"; exit 1; }

# 203.0.113.7 arriva come IP del visitatore: la richiesta viene dalla rete di Docker, che è tra i proxy fidati.
codice="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: localhost' -H 'X-Forwarded-For: 203.0.113.7' \
  'http://127.0.0.1:'"$porta"'/api/cerca?q=via+Riservata+12&lat=40.68123&lon=14.76801')"
[[ "$codice" == 502 ]] || { echo "FAIL: atteso 502 dall'API assente, arrivato $codice"; exit 1; }

log="$(docker logs "$nome" 2>&1)"
errori=0
for vietato in 203.0.113.7 40.68123 14.76801 Riservata remote_ip client_ip; do
  if grep -q -- "$vietato" <<<"$log"; then echo "FAIL: nel log di Caddy c'è «$vietato»"; errori=1; fi
done
# L'errore resta nel log, per capire perché l'API non rispondeva.
grep -q '"status":502' <<<"$log" || { echo "FAIL: l'errore 502 non è più nel log"; errori=1; }

if [[ "$errori" == 1 ]]; then
  echo "--- log di Caddy"; grep -F 'http.log.error' <<<"$log" || true
  exit 1
fi
echo "ok: errore nel log di Caddy senza IP, posizione né testo cercato"
