# Scorty: istruzioni per chi sviluppa (anche con Claude Code)

Mappa civica delle scorte di carburante: web app (PWA) con segnalazioni anonime. Online su https://scorty.it, codice su https://github.com/scorty-it/app (AGPL-3.0). Il README spiega il progetto, CONTRIBUTING.md come partecipare; qui le regole di lavoro.

## Lingua e stile
- Interfaccia, nomi nel codice, commenti, messaggi di commit e documentazione: **in italiano**.
- Commenti brevi che spiegano il *perché*. Le semplificazioni volute con un limite noto si segnano con `ponytail:` e dicono quando superarle.
- Il server esegue TypeScript direttamente con Node.js 22, senza compilazione: niente `enum`, `namespace` o proprietà dichiarate nei parametri del costruttore; import con estensione `.ts`.
- Niente dipendenze nuove per cose che bastano poche righe o la libreria standard.

## Test
Girano prima di ogni commit:
```sh
cd web && npx tsc --noEmit -p . && npm test
cd api && npx tsc --noEmit -p . && npm test   # i test sul database partono solo con PGDATABASE=…_test
```
Test sul database (li **svuota**, quindi solo su un database che finisce con `_test`):
```sh
cd api && PGHOST=127.0.0.1 PGUSER=scorty PGPASSWORD=<da .env> PGDATABASE=scorty_test npm test
```
Ogni regola nuova (anti-abuso, calcolo dello stato, formati) ha il suo test.

## Regole che non si rompono
- **Privacy:**
  - la posizione dell'utente non si salva;
  - gli IP stanno solo in memoria;
  - niente cookie di profilazione, statistiche di terze parti o pubblicità;
  - il testo delle ricerche non si salva;
  - un dato nuovo entra anche nella pagina Privacy e in `docs/registro-trattamenti.md`, con il suo tempo di conservazione.
- **Anti-abuso:** le regole stanno nel server (`api/src/app.ts`); l'app può solo anticiparle.
- **Effetto gregge:** niente «vai al più vicino», niente classifiche dei più economici.
- **Database:** solo migrazioni nuove in `api/db/migrazioni/`, mai modificare quelle già applicate. Si applicano da sole all'avvio dell'API.
- **Produzione:** mai segnalazioni inventate (`semina-demo.ts --inventa-attivita` solo in sviluppo).

## Ambiente locale
`.env` (non in Git) copiato da `.env.example`; il sito di prova risponde sulla porta di `PORTA_HTTP`.
```sh
docker compose up -d --build                     # database, API, Caddy
docker compose exec api node src/distributori.ts # aggiorna i distributori dal Ministero
```

## Security review
- `.githooks/pre-push` lancia la skill `security-review-range` esattamente su quello che si pusha (aree in `.githooks/security-review-areas`) e blocca su HIGH/MEDIUM con confidenza ≥ 8/10, o se la review non riesce a girare. Serve Claude Code; si attiva una volta per clone con `git config core.hooksPath .githooks`. Saltarla solo di proposito: `SKIP_SECURITY_REVIEW=1 git push`. Test del hook: `bash scripts/test/pre_push_hook_test.sh`.
- Review di un intervallo o di tutto il codice: `/security-review-range <base>..HEAD` oppure `all`, sempre con l'intervallo esplicito.
- I lockfile si controllano senza LLM (lo fa anche il hook): `node .githooks/controlla-lockfile.ts api/package-lock.json web/package-lock.json`. `npm ci` scarica da qualsiasi `resolved`.
- Un difetto nel nostro codice si corregge qui con un test che prima fallisce; uno in una dipendenza si segnala a chi la mantiene, mai una patch locale.
- **Il repo è pubblico:** i report restano in `.git/security-reviews/`, mai in Git, e una vulnerabilità non ancora corretta non va in issue, PR o messaggi di commit (vedi `SECURITY.md`).
