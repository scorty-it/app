# Contribuire a Scorty

Grazie per voler dare una mano. Scorty è un progetto civico: ogni miglioramento aiuta chi cerca carburante nei giorni difficili.

Partecipando accetti il [codice di condotta](CODE_OF_CONDUCT.md).

## Come partecipare

- **Hai trovato un problema o hai un’idea?** Apri una *issue*. Per un problema indica:
  - cosa hai fatto e cosa ti aspettavi;
  - cosa è successo invece;
  - il telefono e il browser che usavi.
- **Vuoi modificare il codice?** Per cambiamenti grandi apri prima una *issue* per parlarne. Per correzioni piccole manda direttamente una *pull request*.
- **Hai trovato una falla di sicurezza?** Non aprire una *issue* pubblica: scrivi al contatto indicato nella pagina Contatti del sito, oppure usa la segnalazione privata di GitHub (*Security → Report a vulnerability*), se è attiva. Dettagli in [SECURITY.md](SECURITY.md).

## Preparare l’ambiente

Servono Node.js 22.18 o più recente e Docker. Come avviare tutto in locale, caricare i dati demo e lanciare i test è spiegato nel [README](README.md#avvio-in-locale).

Prima di mandare una *pull request*:

```sh
cd web && npx tsc --noEmit && npm test
cd api && npx tsc --noEmit && npm test
```

Se tocchi le regole anti-abuso o il calcolo dello stato, fai girare anche i test sul database. Le istruzioni sono nel README alla sezione *Test*.

## Regole del progetto

**Privacy prima di tutto.** Sono vincoli, non preferenze.

- Le coordinate di chi usa l’app servono solo a controllare la distanza: non si salvano e non finiscono nei log.
- Gli indirizzi IP restano solo in memoria, per i limiti anti-abuso.
- Niente strumenti di statistica, pubblicità o servizi di terze parti. Un nuovo servizio esterno, anche gratuito, si discute prima in una *issue*.
- Un dato nuovo da raccogliere va aggiunto anche alla pagina Privacy, con il tempo di conservazione.

**Le regole contro gli abusi stanno sul server.** L’app può anticipare un controllo per comodità, ma è il server a decidere.

**Codice semplice.**

- Nomi, commenti e testi sono in italiano, come l’interfaccia.
- Preferisci la libreria standard e le funzioni del browser a una dipendenza nuova.
- I commenti spiegano il *perché*, non il *cosa*.
- Una semplificazione voluta, con un limite noto, si segna con un commento `ponytail:` che dice il limite e quando superarlo.
- Il server esegue TypeScript direttamente con Node.js, senza compilazione: niente sintassi che richieda una trasformazione (`enum`, `namespace`, proprietà dichiarate nei parametri del costruttore).

**Ogni regola nuova ha il suo test.** Per esempio un limite, un caso del calcolo dello stato o un formato di dati.

**Il database cambia solo con migrazioni nuove.** Aggiungi un file numerato in `api/db/migrazioni/` e non modificare quelli già esistenti.

**Testi dell’interfaccia.**

- Frasi brevi e concrete, comprensibili a chiunque.
- Niente toni allarmistici: Scorty deve calmare, non spaventare.
- Gli stati si distinguono anche senza colori, grazie a simboli e testi.

## Dati

- I distributori vengono da OpenStreetMap (ODbL) e, appena possibile, dall’anagrafica del Ministero (IODL 2.0). Le attribuzioni vanno sempre mantenute.
- Le segnalazioni esportate sono anonime e hanno licenza ODbL.

## Licenza

Contribuendo accetti che il tuo codice sia distribuito con la licenza [GNU AGPL-3.0](LICENSE), la stessa del progetto.
