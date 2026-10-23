<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="marchio/scorty-logo-bianco.png">
    <img src="marchio/scorty-logo.png" alt="Scorty" width="360">
  </picture>
</p>

<p align="center"><strong>Mappa civica delle scorte di carburante</strong><br>
Dove c’è benzina, gasolio, GPL e metano durante scioperi e crisi di approvvigionamento,<br>
dalle segnalazioni di chi è sul posto.</p>

---

Scorty è un progetto civico, indipendente e senza scopo di lucro. È una web app installabile sul telefono (PWA), con codice aperto e dati aperti. Per ora copre Campania, Puglia, Basilicata, Calabria e Sicilia.

> **Stato: online su [scorty.it](https://scorty.it).** Funzionano:
>
> - la mappa e le segnalazioni, anche da correggere o completare per un’ora;
> - le regole anti-abuso e gli aggiornamenti in tempo reale;
> - i distributori del Ministero, aggiornati ogni giorno;
> - la ricerca, la situazione per provincia con il bollettino da condividere, l’avviso al distributore;
> - il pannello di moderazione con le statistiche;
> - i dati aperti e i backup.
>
> Quello che resta da fare è in [Cosa manca](#cosa-manca).

## Come funziona

- **Una ricerca che capisce le frasi.** Si può scrivere un comune anche sbagliato («pozzoli»), un indirizzo («via Toledo 256 Napoli»), un luogo («ospedale Cardarelli») o un marchio con un posto («Eni Salerno»). Le parole come «benzinaio» o «GPL» dicono cosa cerchi: «gpl napoli» mostra solo i distributori con GPL.
- **Una mappa che riassume e poi mostra.** Da lontano i distributori si raccolgono in bolle per zona: il numero dice quanti hanno notizie delle ultime 24 ore, l’anello come sono messi, un cerchio vuoto è una zona senza notizie. Da vicino compaiono i singoli distributori della zona inquadrata, e ogni spillo dice com’è il carburante: ✓ disponibile, – scarso o solo alcuni carburanti, ✕ finito, ? segnalazioni contrastanti. Un pallino grigio indica un distributore senza notizie recenti.
- **Le segnalazioni le fanno le persone.** Chi è al distributore sceglie *Disponibile*, *Scarso* o *Finito*, oppure risponde *Confermo* / *Non è vero* a quello che hanno detto altri. Può anche dire se c’è coda.
- **Il mondo Spesa.** Un selettore passa da *Carburante* a *Spesa*: la mappa mostra i supermercati e sette categorie di beni essenziali (acqua, latte, pane, frutta e verdura, pasta e riso, carne e pesce, neonati), ciascuna *C’è*, *Poco* o *Finito*. Nella scheda del negozio «Com’è lo scaffale?» raccoglie le categorie guardate e la coda all’ingresso in un solo invio, che conta come una sola visita; non c’è *Confermo* / *Non è vero*, perché chi segnala lo stesso stato è una persona in più. Un negozio senza filtro è verde o rosso solo con almeno tre categorie concordi.
- **Sul posto o a distanza.** Sul posto vuol dire entro 300 metri. Chi ci è passato da poco (per esempio guidando) può segnalare dopo, fino a 30 km di distanza e indicando quando l’ha visto. Una segnalazione a distanza conta la metà, e conferme e code valgono solo sul posto.
- **Lo stato si calcola, non si sceglie.** Contano le ultime 24 ore, perché uno sciopero dura giorni, ma le segnalazioni recenti pesano di più: il peso si dimezza ogni 3 ore. Per ogni telefono conta solo l’ultima. Con una sola persona lo stato è *da confermare*; con almeno due d’accordo nelle ultime 4 ore è *affidabile*. Se le persone non sono d’accordo lo stato è *incerto*.
- **Tempo reale.** Quando qualcuno segnala, chi guarda la mappa vede il cambiamento subito.
- **Bollettino per provincia.** Per comuni, prefetture e testate locali: `scorty.it/province/SA` mostra in cima i comuni senza carburante, cioè quelli dove nessun distributore risulta avere carburante e almeno uno risulta finito. Basta una segnalazione, ma finché due persone non sono d’accordo il comune resta «da confermare». Da lì si condivide il bollettino come immagine (per WhatsApp e i social), come PDF A4 o come testo, sempre con la data e l’ora dei dati. Gli stessi numeri sono in JSON su `/api/province/SA`, con l’andamento delle ultime 24 ore. Con «Incorpora nel tuo sito» una testata o un ente mette nelle sue pagine il riepilogo della provincia (`scorty.it/widget/province/SA`, dentro un iframe), che si aggiorna da solo. Quando in una provincia aumentano i comuni senza carburante confermati (almeno due persone d’accordo), parte un avviso nel canale Telegram della regione e nel feed RSS della provincia (`/api/province/SA/avvisi.rss`), e un altro quando torna a migliorare: al massimo uno ogni 6 ore per provincia, elenco su `scorty.it/avvisi`. Per Telegram servono un bot e i canali nel `.env` (`TELEGRAM_TOKEN`, `TELEGRAM_CANALI`, vedi `.env.example`).
- **Si può correggere.** Per un’ora dopo la visita, da «Le tue segnalazioni» si aggiunge un carburante dimenticato o la coda, si cambia uno stato sbagliato o si annulla tutto, anche lontano dal distributore. Una correzione non trascina i voti degli altri e non li cancella: la vecchia segnalazione si ritira, se ne crea una nuova, e chi aveva confermato o smentito la vecchia continua a contare per quello che aveva detto.
- **Avviso al distributore.** Con Scorty aperto, chi è fermo da un minuto vicino a un distributore riceve un invito a dire com’è. Lo stesso vale per il negozio dove hai detto «Ci vado»: l’invito apre la scheda su «Com’è lo scaffale?». Un negozio qualunque sotto casa non fa scattare niente. Il calcolo avviene sul telefono: al server arriva solo una posizione approssimata. Con l’app chiusa non funziona, perché i browser non danno la posizione alle app in secondo piano.
- **Si installa sul telefono.** Su Android con un pulsante; su iPhone Scorty spiega come aggiungerla alla schermata Home da Safari.

### Contro l’effetto gregge

Se tutti corrono nello stesso distributore, il carburante finisce prima e le code bloccano le strade. Per questo Scorty:

- mostra le code segnalate e, dove la stima del server lo dice, *Coda in aumento* (distributori e negozi) e *Potrebbe finire* (categorie dei negozi), in un riquadro blu che spiega su cosa si basa: quante persone hanno detto «Ci vado» nell’ultima ora e quante schede sono state aperte negli ultimi 30 minuti;
- permette di dire «Ci vado»: un segnale di intenzione, non una prenotazione, che vale un’ora, uno solo per telefono e al massimo tre all’ora. Chi lo vede può scegliere un altro posto, e chi lo dice nel negozio indica le categorie che gli servono. Non compare mai nei dati aperti, viene cancellato dopo 24 ore ed è escluso dai backup;
- propone alternative vicine e mette in fondo quelle affollate;
- rende visibile l’età di ogni dato: gli spilli sbiadiscono dopo un’ora;
- non ha un pulsante «vai al più vicino»;
- condivide una zona della mappa e non un singolo distributore;
- ricorda che chi non ha urgenza può aspettare l’ondata di rifornimenti successiva.

## Privacy

Scorty è progettato per raccogliere il minimo indispensabile.

- **Niente account.** Al primo avvio il telefono riceve un identificativo anonimo, salvato nel browser. Non chiediamo email, numero di telefono o nome.
- **La posizione non si salva.** Serve solo a controllare la distanza dal distributore nel momento della segnalazione.
- **Gli indirizzi IP restano solo nella memoria del server**, per limitare gli abusi, e spariscono da sole entro poco più di un’ora. Non finiscono nei log né nel database.
- **Niente cookie di profilazione, pubblicità o statistiche di terze parti.** Il carattere tipografico è servito dal nostro sito. L’unico servizio esterno che riceve richieste dal telefono è la mappa di base di OpenFreeMap. Le ricerche di indirizzi passano dal nostro server a Photon, con una zona di circa 10 km intorno al centro della mappa per preferire i risultati vicini: Photon non riceve l’IP di chi cerca, e le ricerche non si salvano.
- **Registro dei trattamenti:** [docs/registro-trattamenti.md](docs/registro-trattamenti.md).
- **Conservazione limitata.**
  - L’identificativo viene tolto dalle segnalazioni dopo 30 giorni, e da lì restano anonime.
  - Le aperture delle schede si cancellano dopo 24 ore e i registri delle anomalie dopo 30 giorni.
  - Il «Ci vado» si cancella dopo 24 ore e non entra nelle copie di sicurezza; le anomalie del suo limite non dicono dove.
  - Le richieste di correzione si cancellano 90 giorni dopo la chiusura.

## Regole anti-abuso

Tutte le regole sono applicate dal server, non solo dall’app. Si possono controllare nel codice: le regole in [`api/src/app.ts`](api/src/app.ts) (test in [`regole.test.ts`](api/src/regole.test.ts)), il calcolo dello stato in [`api/src/stato.ts`](api/src/stato.ts) (test in [`stato.test.ts`](api/src/stato.test.ts)), la sfida di calcolo in [`api/src/firme.ts`](api/src/firme.ts) (test in [`firme.test.ts`](api/src/firme.test.ts)).

| Regola | Dettaglio |
|---|---|
| Distanza | Entro 300 m sul posto, 30 km a distanza (verifica con PostGIS) |
| Limiti per telefono | 10 azioni all’ora (una visita al negozio conta come un’azione); al massimo 3 segnalazioni a distanza all’ora |
| «Ci vado» | Un solo «Ci vado» attivo per telefono, al massimo 3 all’ora, nel budget a parte delle segnalazioni; vale un’ora |
| Limiti per rete | Scritture e nuovi telefoni limitati per indirizzo IP, solo in memoria |
| Telefoni nuovi più costosi | Per ottenere l’identificativo il telefono risolve una piccola sfida di calcolo (proof of work) |
| Niente autoconferma | Non si può confermare la propria segnalazione |
| Fiducia | Chi viene confermato pesa di più, chi viene smentito di meno; un telefono appena creato pesa un po’ meno per mezz’ora |
| Anomalie | Si registrano gli spostamenti impossibili (lo stesso telefono in due posti lontani in pochi minuti), i tentativi fuori raggio e i limiti superati |
| Blocco | Un telefono bloccato smette di contare, anche per quello che ha già segnalato |

Questi controlli rendono gli abusi più difficili, non impossibili: la posizione di un telefono si può falsificare. Per questo contano le conferme di più persone.

## Architettura

```
Telefono (PWA) ──HTTPS──▶ Caddy ──┬── /        sito statico (React + MapLibre)
                                  └── /api/*   Node.js (Fastify) ──▶ PostgreSQL + PostGIS
```

- **`web/`**: l’app.
  - React 19, Vite, Tailwind CSS 4 e componenti shadcn/ui (Base UI).
  - MapLibre GL con le mappe di [OpenFreeMap](https://openfreemap.org): Liberty per il tema chiaro, Fiord per quello scuro.
  - Si installa sul telefono come un’app.
- **`api/`**: il server.
  - Node.js 22 esegue direttamente TypeScript, senza compilazione. Usa Fastify e Kysely.
  - Le migrazioni sono file SQL in `api/db/migrazioni/`, applicati all’avvio.
  - Il calcolo dello stato è in `api/src/stato.ts`, come funzione pura con i suoi test.
- **`Caddyfile`**: HTTPS automatico, intestazioni di sicurezza (CSP) e nessun log di accesso.
- **`marchio/`**: logo, icona e avatar in SVG e PNG.

## Avvio in locale

Servono Docker con Docker Compose.

```sh
cp .env.example .env
# nel file .env compila POSTGRES_PASSWORD e SEGRETO (openssl rand -hex 24 / openssl rand -hex 32)
# per provarlo sul tuo computer imposta anche:  DOMINIO=localhost  SITI=:80  PORTA_HTTP=127.0.0.1:8080
docker compose up -d --build
```

Poi apri <http://localhost:8080>.

All’avvio il server scarica da solo i distributori delle regioni coperte, circa 6.000, e li riaggiorna ogni giorno: dal Ministero tramite l’Osservatorio prezzi carburanti, oppure da OpenStreetMap se il Ministero non risponde. Il comune di ogni distributore prende il nome ufficiale dall’elenco ISTAT in `api/db/comuni-istat.json`: quando l’ISTAT pubblica variazioni, o Scorty copre una regione nuova, si aggiorna con `cd api && node src/comuni-istat.ts` (serve `unzip`), e i comuni che non riconosce finiscono nel log dell’import. Senza rete puoi caricarli dal file incluso nella repo con `docker compose exec api node src/semina-demo.ts`. Per provare la mappa con segnalazioni inventate:

```sh
docker compose exec api node src/semina-demo.ts --inventa-attivita
```

Il comando **cancella tutte le segnalazioni** e ne inventa di nuove, quindi non usarlo in produzione. Le segnalazioni inventate scadono dopo 24 ore come quelle vere; per rinfrescarle rilancia il comando.

### Sviluppo dell’app con ricaricamento automatico

`npm run dev` inoltra `/api` a `localhost:3000`, quindi il server va avviato sul computer, fuori da Docker:

```sh
# terminale 1: il server, collegato al database di Docker (porta 5432 su localhost)
cd api && npm install
PGHOST=127.0.0.1 PGUSER=scorty PGPASSWORD=… PGDATABASE=scorty SEGRETO=… npm start

# terminale 2: l'app
cd web && npm install && npm run dev
```

### Test

```sh
cd web && npm test     # aspetto degli spilli, alternative, riconoscimento dei marchi
cd api && npm test     # calcolo dello stato, firme e sfide
```

I test delle regole anti-abuso usano un PostgreSQL vero e **cancellano tutti i dati**. Per questo partono solo se il database ha un nome che finisce con `_test`:

```sh
docker compose exec db createdb -U scorty scorty_test
cd api && PGHOST=127.0.0.1 PGUSER=scorty PGPASSWORD=… PGDATABASE=scorty_test npm test
```

Il `Caddyfile` ha un test con Docker: se l’API non risponde, Caddy scrive l’errore senza IP, posizione né testo cercato.

```sh
bash scripts/test/caddy_log_test.sh
```

## Cosa manca

- [ ] **App per iPhone e Android.** Servirebbero per Android Auto e CarPlay, che per CarPlay richiede un permesso di Apple, e per l’avviso al distributore anche ad app chiusa.
- [ ] **Altri negozi.** Panifici, macellerie, farmacie e simili: per ora la Spesa copre i supermercati.
- [ ] **Spesa nella situazione per provincia.** La pagina e il bollettino per provincia parlano ancora solo di carburante.
- [x] Prezzi del Ministero nella scheda, self e servito, con avviso se non sono aggiornati da oltre 30 giorni
- [x] Titolare del trattamento indicato e [registro dei trattamenti](docs/registro-trattamenti.md)
- [x] Distributori del Ministero aggiornati ogni giorno, tramite l’Osservatorio prezzi carburanti, con OpenStreetMap come riserva
- [x] Pagina «Situazione per provincia»
- [x] Bollettino per provincia: comuni senza carburante, immagine, PDF e testo
- [x] Ricerca di comuni, indirizzi, luoghi e distributori, tollerante agli errori
- [x] Correggere e completare le proprie segnalazioni per un’ora
- [x] Avviso al distributore con l’app aperta, e invito a installarla sul telefono
- [x] Mondo Spesa: supermercati, sette categorie, «Ci vado» e stime di coda e scorte
- [x] Pannello di moderazione con statistiche aggregate
- [x] Pagina «Contatti e suggerimenti»
- [x] Backup giornaliero del database con rotazione
- [x] Esportazione anonima delle segnalazioni in CSV e GeoJSON (ODbL)
- [x] Guida per chi contribuisce e codice di condotta

## Contribuire

Segnalazioni di problemi, idee e pull request sono benvenute. Leggi la [guida per chi contribuisce](CONTRIBUTING.md) e il [codice di condotta](CODE_OF_CONDUCT.md).

## Dati e licenze

- **Codice:** [GNU AGPL-3.0](LICENSE). Chi offre Scorty modificato come servizio online deve pubblicarne il codice.
- **Mappa di base:**
  - fornita da [OpenFreeMap](https://openfreemap.org);
  - dati © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) con licenza ODbL e © [OpenMapTiles](https://openmaptiles.org).
- **Distributori:**
  - anagrafica del Ministero delle Imprese e del Made in Italy, letta ogni giorno dall’[Osservatorio prezzi carburanti](https://carburanti.mise.gov.it): sono gli stessi dati del dataset «Carburanti – prezzi praticati e anagrafica degli impianti», con licenza [IODL 2.0](https://www.dati.gov.it/iodl/2.0/). Il file CSV ufficiale risponde solo da indirizzi italiani, l’Osservatorio no;
  - se il Ministero non risponde: dati © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), con licenza [ODbL](https://opendatacommons.org/licenses/odbl/), tramite Overpass;
  - il file `api/db/demo-distributori.json` è una copia di riserva da OpenStreetMap.
- **Nomi dei comuni:** elenco dei comuni e variazioni amministrative dell’[ISTAT](https://www.istat.it/classificazione/codici-dei-comuni-delle-province-e-delle-regioni/), con licenza [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.it), nel file `api/db/comuni-istat.json`. Servono a scrivere il comune di ogni distributore con il nome ufficiale di oggi, anche quando la fonte usa quello di un comune poi fuso.
- **Ricerca di indirizzi e luoghi:** [Photon](https://photon.komoot.io) di komoot, su dati © OpenStreetMap contributors.
- **Carattere:** [Figtree](https://github.com/erikdkennedy/figtree), con licenza SIL Open Font License.

Scorty non è affiliato al Ministero delle Imprese e del Made in Italy, a OpenStreetMap né ad alcuna compagnia petrolifera.
