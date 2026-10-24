import { ArrowLeft, Bug, ChevronRight, Download, Lightbulb, Mail, MessageCircle, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TITOLO_SITO } from './anteprima.ts'
import { quando } from './aspetto.ts'
import { rigaSpesaProvincia } from './bollettino.ts'
import { DONAZIONI_URL, EMAIL_CONTATTI, REPO_URL, TITOLARE } from './config.ts'
import { caricaProvince, type Provincia } from './dati.ts'
import { Indicatore } from './Marchio.tsx'
import { ALTEZZA, LARGHEZZA, LATO_PALLINO, ePerno, iconaUrl } from './icone.ts'
import { REGIONI } from './province.ts'
import { SimboloStato } from './SchedaPunto.tsx'

const ALLA_MAPPA = { href: '/', etichetta: 'Torna alla mappa' }

export function Pagina({ titolo, titoloDocumento, children, indietro = ALLA_MAPPA }: {
  titolo: string
  titoloDocumento?: string // il titolo della scheda del browser e di Google, se diverso da «titolo – Scorty»
  children: React.ReactNode
  indietro?: { href: string; etichetta: string }
}) {
  // Google legge il titolo dopo aver eseguito l'app: ogni pagina ha il suo, e tornando alla mappa torna quello del sito.
  useEffect(() => {
    document.title = titoloDocumento ?? `${titolo} – Scorty`
    return () => void (document.title = TITOLO_SITO)
  }, [titolo, titoloDocumento])

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background/95 px-2 pt-[env(safe-area-inset-top)] backdrop-blur">
        <Link href={indietro.href} aria-label={indietro.etichetta} className="flex size-12 items-center justify-center rounded-full hover:bg-muted">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-lg font-semibold">{titolo}</h1>
      </header>
      <main className="testo mx-auto max-w-prose space-y-3 px-4 py-5 pb-[max(env(safe-area-inset-bottom),2rem)] leading-relaxed">
        {children}
      </main>
    </div>
  )
}

const VOCI_LEGENDA: [Parameters<typeof iconaUrl>[0], string, boolean?][] = [
  [{ colore: 'verde', incerto: false, pieno: true, affollato: false, forma: 'goccia' }, 'Disponibile'],
  [{ colore: 'giallo', incerto: false, pieno: true, affollato: false, forma: 'goccia' }, 'Scarso, oppure solo alcuni carburanti'],
  [{ colore: 'rosso', incerto: false, pieno: true, affollato: false, forma: 'goccia' }, 'Finito'],
  [{ colore: 'verde', incerto: false, pieno: false, affollato: false, forma: 'goccia' }, 'Chiaro e tratteggiato: una sola segnalazione, da confermare'],
  [{ colore: 'grigio', incerto: true, pieno: true, affollato: false, forma: 'goccia' }, 'Segnalazioni contrastanti'],
  [{ colore: 'grigio', incerto: false, pieno: false, affollato: false, forma: 'goccia' }, 'Pallino grigio: nessuna segnalazione nelle ultime 24 ore'],
  [{ colore: 'verde', incerto: false, pieno: true, affollato: true, forma: 'goccia' }, 'Simbolo dell’auto: coda lunga o coda in aumento (stima)'],
  [{ colore: 'verde', incerto: false, pieno: true, affollato: false, forma: 'quadrato' }, 'Spillo quadrato: un negozio. È verde o rosso solo se almeno 3 categorie concordano, altrimenti giallo'],
  [{ colore: 'verde', incerto: false, pieno: true, affollato: true, forma: 'quadrato' }, 'Simbolo della persona: negozio con molta gente'],
  [{ colore: 'rosso', incerto: false, pieno: true, affollato: false, forma: 'goccia' }, 'Sbiadito: ultima segnalazione di più di un’ora fa', true],
]

export function Legenda() {
  return (
    <ul className="space-y-1">
      {VOCI_LEGENDA.map(([spec, testo, sbiadito]) => (
        <li key={testo} className="flex items-center gap-3 text-sm">
          <span className="flex w-10 shrink-0 justify-center">
            {ePerno(spec) ? (
              <img src={iconaUrl(spec)} alt="" width={LARGHEZZA} height={ALTEZZA} className={cn('drop-shadow-sm', sbiadito && 'opacity-50')} />
            ) : (
              <img src={iconaUrl(spec)} alt="" width={LATO_PALLINO} height={LATO_PALLINO} className="drop-shadow-sm" />
            )}
          </span>
          {testo}
        </li>
      ))}
    </ul>
  )
}

export function ComeFunziona() {
  return (
    <Pagina titolo="Come funziona">
      <p>
        Scorty mostra dove c’è carburante durante gli scioperi e le crisi di approvvigionamento. I dati arrivano da chi è al
        distributore in quel momento.
      </p>
      <h2>Segnalare</h2>
      <p>
        Apri un distributore e scegli <strong>Disponibile</strong>, <strong>Scarso</strong> o <strong>Finito</strong>: bastano
        due tocchi. Puoi anche dire se c’è coda. Si può segnalare solo entro 300 metri dal distributore: lo verifichiamo con la
        posizione del telefono, che usiamo per il controllo e poi non salviamo.
      </p>
      <h2>La spesa</h2>
      <p>
        Dal selettore in alto passi da Carburante a Spesa: la mappa mostra i supermercati e sette categorie di beni essenziali, cioè
        acqua, latte, pane, frutta e verdura, pasta e riso, carne e pesce, prodotti per neonati. In un negozio ogni categoria è «C’è»,
        «Poco» o «Finito».
      </p>
      <p>
        Nella scheda del negozio «Com’è lo scaffale?» ti fa toccare solo le categorie che hai guardato, e se vuoi dire com’è la coda
        all’ingresso. Un solo pulsante, <strong>Invia</strong>, manda tutto insieme e conta come una sola visita. Nei negozi non c’è
        «Confermo» o «Non è vero»: se un’altra persona segnala lo stesso stato, è una persona in più che lo conferma.
      </p>
      <h2>Correggere una segnalazione</h2>
      <p>
        Per un’ora dopo la visita, da «Le tue segnalazioni» puoi aggiungere un carburante (o una categoria, in un negozio) o la coda che avevi dimenticato, cambiare uno
        stato sbagliato o annullare tutto, anche se non sei più al distributore.
      </p>
      <h2>«Ci vado»</h2>
      <p>
        Nella scheda di un negozio o di un distributore, <strong>Ci vado</strong> dice agli altri che stai per andarci. Nel negozio scegli
        per quali categorie; al distributore basta un tocco. Vale un’ora, ne hai uno solo alla volta e puoi toglierlo quando vuoi: se
        poi segnali sul posto, si chiude da solo. Non serve a prenotare nulla. Serve a stimare dove la coda sta crescendo e quali
        categorie potrebbero finire, così chi sta per uscire può scegliere con più informazioni.
      </p>
      <h2>Avviso al distributore</h2>
      <p>
        Se sei fermo da almeno un minuto vicino a un distributore, con Scorty aperto, ti chiediamo com’è il carburante. Lo stesso
        distributore non si ripropone prima di due ore. Lo stesso avviso, all’arrivo, ti chiede com’era nel negozio dove avevi detto
        «Ci vado». L’avviso si accende o si spegne dal menu. Con l’app chiusa o in secondo piano
        non funziona: i browser non permettono ai siti di usare la posizione in quei momenti.
      </p>
      <h2>Come calcoliamo lo stato</h2>
      <ul>
        <li>Contano le segnalazioni delle ultime 24 ore: uno sciopero dura giorni.</li>
        <li>Le più recenti pesano di più: il peso di una segnalazione si dimezza ogni 3 ore, così chi passa oggi corregge il dato di ieri.</li>
        <li>Per ogni telefono conta solo la sua ultima segnalazione: ripetere non aggiunge peso.</li>
        <li>Con una sola segnalazione lo stato è «da confermare». Con due o più persone d’accordo nelle ultime 4 ore è affidabile: un dato più vecchio resta da confermare.</li>
        <li>Se le segnalazioni non sono d’accordo, lo stato è «incerto».</li>
        <li>Chi è sul posto può rispondere «Confermo» o «Non è vero».</li>
      </ul>
      <h2>Legenda</h2>
      <Legenda />
      <p>
        Le note su sfondo <strong>blu</strong> parlano di persone: la coda segnalata da chi è lì e chi sta arrivando. Quelle segnate
        «stima» («Coda in aumento», «Potrebbe finire») nascono da quante persone hanno detto «Ci vado» e da quante schede sono state
        aperte. Il blu non dice mai lo stato di un prodotto:
        quello resta verde, giallo o rosso e viene solo da chi è stato lì. Dove qualcuno ha segnalato la coda sul posto, la stima tace.
      </p>
      <h2>Perché mostriamo code e stime sulle persone in arrivo</h2>
      <p>
        Se tutti vanno nello stesso punto si forma la coda e le scorte finiscono in fretta. Per questo mostriamo le code
        segnalate, quante persone stanno arrivando e, quando serve, alternative vicine meno affollate. Non c’è un
        pulsante «vai al più vicino»: così le persone si distribuiscono.
      </p>
      <h2>Regole contro gli abusi</h2>
      <ul>
        <li>Segnalazioni e conferme solo entro 300 m dal distributore.</li>
        <li>Al massimo 10 segnalazioni all’ora per telefono, più limiti per indirizzo di rete.</li>
        <li>Non si può confermare la propria segnalazione.</li>
        <li>
          Registriamo i comportamenti anomali, per esempio lo stesso telefono in posti lontani in pochi minuti. Un moderatore può
          nascondere segnalazioni e bloccare telefoni.
        </li>
        <li>
          Questi controlli rendono gli abusi più difficili, non impossibili: la posizione di un telefono si può falsificare. Per
          questo contano le conferme di più persone.
        </li>
      </ul>
      <h2>Dati sbagliati</h2>
      <p>Se un dato è sbagliato, o sei il gestore del distributore, usa «Segnala un errore» nella sua scheda.</p>
    </Pagina>
  )
}

export function FontiDati() {
  return (
    <Pagina titolo="Fonti e dati aperti">
      <h2>Distributori</h2>
      <p>
        Anagrafica degli impianti del Ministero delle Imprese e del Made in Italy, aggiornata ogni giorno dal sito dell’
        <a href="https://carburanti.mise.gov.it">Osservatorio prezzi carburanti</a>. Sono gli stessi dati del dataset{' '}
        <a href="https://www.mimit.gov.it/it/open-data/elenco-dataset/carburanti-prezzi-praticati-e-anagrafica-degli-impianti">
          «Carburanti – prezzi praticati e anagrafica degli impianti»
        </a>
        , licenza <a href="https://www.dati.gov.it/iodl/2.0/">IODL 2.0</a>.
      </p>
      <p>
        Se il servizio del Ministero non è disponibile usiamo i distributori di{' '}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (© OpenStreetMap contributors, licenza ODbL).
      </p>
      <h2>Negozi</h2>
      <p>
        Supermercati e negozi di alimentari da <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (© OpenStreetMap
        contributors, licenza ODbL).
      </p>
      <h2>Comuni e confini</h2>
      <p>
        I nomi ufficiali dei comuni e i confini dei comuni vengono dall’
        <a href="https://www.istat.it/classificazione/codici-dei-comuni-delle-province-e-delle-regioni/">ISTAT</a> (licenza{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/deed.it">CC BY 4.0</a>). Servono a dare il comune ai distributori e ai negozi,
        e così a dire quali comuni sono senza carburante o senza un bene della spesa.
      </p>
      <h2>Prezzi</h2>
      <p>
        I prezzi sono quelli che i gestori comunicano al Ministero, letti ogni giorno dall’
        <a href="https://carburanti.mise.gov.it">Osservatorio prezzi carburanti</a> (licenza{' '}
        <a href="https://www.dati.gov.it/iodl/2.0/">IODL 2.0</a>). Per ogni carburante mostriamo il prezzo più basso tra le varianti, self e
        servito separati. Possono non coincidere con quelli alla pompa se il gestore li ha cambiati dopo l’ultima comunicazione.
      </p>
      <h2>Mappa</h2>
      <p>
        Mappa di base di <a href="https://openfreemap.org">OpenFreeMap</a> con dati ©{' '}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (licenza ODbL) e{' '}
        <a href="https://openmaptiles.org">OpenMapTiles</a>.
      </p>
      <h2>Ricerca</h2>
      <p>
        Comuni e distributori dal nostro archivio; indirizzi e luoghi da <a href="https://photon.komoot.io">Photon</a> di komoot, su dati ©{' '}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>.
      </p>
      <h2>Segnalazioni</h2>
      <p>Le segnalazioni vengono dalle persone che usano Scorty.</p>
      <h2>Scarica i dati</h2>
      <p>
        Tutte le segnalazioni in forma anonima, senza alcun identificativo del telefono, con licenza{' '}
        <a href="https://opendatacommons.org/licenses/odbl/">ODbL</a>.
      </p>
      <div className="flex gap-2">
        {(['csv', 'geojson'] as const).map((f) => (
          <a key={f} href={`/api/export/segnalazioni.${f}`} download className={cn(buttonVariants({ variant: 'outline' }), 'h-11 no-underline')}>
            <Download /> {f.toUpperCase()}
          </a>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Scorty non è affiliato al Ministero né a OpenStreetMap.</p>
    </Pagina>
  )
}

export function ChiSiamo() {
  return (
    <Pagina titolo="Chi siamo">
      <p>
        Scorty è un progetto civico indipendente e senza scopo di lucro. Non è affiliato a enti pubblici, compagnie petrolifere o
        catene commerciali.
      </p>
      <p>
        Nasce per aiutare durante gli scioperi degli autotrasportatori e le crisi di approvvigionamento nel Sud Italia: meno giri
        a vuoto, meno code, meno panico.
      </p>
      <h2>Codice aperto</h2>
      <p>
        Il codice è pubblico con licenza AGPL-3.0: chiunque può verificarlo, migliorarlo o riusarlo. Lo trovi su{' '}
        <a href={REPO_URL}>GitHub</a>.
      </p>
      <h2>Niente pubblicità né tracciamento</h2>
      <p>Nessuna pubblicità, nessuno strumento di statistica di terze parti, nessun cookie di profilazione.</p>
      {DONAZIONI_URL && (
        <>
          <h2>Sostieni il progetto</h2>
          <p>
            I costi sono quelli del server. Se vuoi contribuire: <a href={DONAZIONI_URL}>fai una donazione</a>.
          </p>
        </>
      )}
    </Pagina>
  )
}

export function Privacy() {
  return (
    <Pagina titolo="Privacy">
      <h2>Chi tratta i dati</h2>
      <p>
        Il titolare del trattamento è {TITOLARE}, che gestisce Scorty come progetto personale, indipendente e senza scopo di lucro.
        Per qualsiasi richiesta: <a href={`mailto:${EMAIL_CONTATTI}`}>{EMAIL_CONTATTI}</a>.
      </p>
      <h2>Cosa trattiamo e perché</h2>
      <ul>
        <li>
          Un identificativo anonimo del dispositivo, creato al primo avvio e salvato nel browser. Serve a contare le conferme di
          persone diverse e ad applicare i limiti contro gli abusi.
        </li>
        <li>Le tue segnalazioni, conferme e segnalazioni di coda, collegate a quell’identificativo.</li>
        <li>
          Il tuo «Ci vado», se lo tocchi: identificativo anonimo, distributore o negozio, categorie scelte (solo per i negozi) e ora.
          Serve a stimare le code che crescono e le categorie che potrebbero finire. Vale un’ora, ne hai uno solo alla volta e non
          compare mai nei dati aperti.
        </li>
        <li>
          La posizione del telefono, che non salviamo mai. Serve quando segnali o dici «Ci vado», per verificare quanto sei vicino al
          distributore o al negozio. Serve per mostrarti i distributori e i negozi intorno: il server riceve il centro della mappa, che
          può coincidere con dove sei. E, se è attivo l’avviso al distributore, mentre Scorty è aperto: al server arriva solo una
          posizione approssimata a circa 100 m, il resto si calcola sul telefono.
        </li>
        <li>
          Statistiche aggregate per giorno: quante visite, quanti telefoni diversi, quante ricerche e segnalazioni, e quante visite
          arrivano dai link che pubblichiamo o che si condividono dall’app (per esempio scorty.it/?da=whatsapp o ?da=zona: l’etichetta
          la scegliamo noi, è uguale per tutti e non dice niente di chi condivide o apre il link). Mai chi: niente
          cookie, niente IP salvati, niente strumenti di terze parti. Per contare i telefoni diversi non usiamo l’identificativo anonimo:
          teniamo fino a fine giornata un’impronta che vale solo per quel giorno e non porta alle segnalazioni, poi resta solo il numero. Il testo delle ricerche non si salva.
        </li>
        <li>
          Il riquadro di Scorty che testate ed enti possono mettere nei loro siti: si carica da scorty.it, non usa cookie e non crea
          identificativi. Contiamo quante volte si apre, per sito: solo il nome del sito che lo ospita, non chi lo guarda.
        </li>
        <li>L’indirizzo IP, solo nella memoria del server per limitare gli abusi: non viene scritto su disco e sparisce entro un’ora.</li>
        <li>Il contatto che scegli di lasciare in una richiesta di correzione, solo per risponderti.</li>
      </ul>
      <p>Base giuridica: legittimo interesse a offrire un servizio di informazione civica affidabile e a prevenire abusi (art. 6.1.f GDPR).</p>
      <h2>Per quanto tempo</h2>
      <ul>
        <li>L’identificativo del dispositivo viene tolto dalle segnalazioni dopo 30 giorni: da quel momento restano anonime.</li>
        <li>Le aperture delle schede si cancellano dopo 24 ore, i registri delle anomalie dopo 30 giorni.</li>
        <li>I «Ci vado» si cancellano dopo 24 ore e non entrano nelle copie di sicurezza.</li>
        <li>Le richieste di correzione, con l’eventuale contatto, si cancellano 90 giorni dopo la chiusura.</li>
        <li>
          L’andamento delle province, cioè quanti comuni sono senza carburante o senza beni della spesa, quanti distributori hanno ciascun colore e quanti negozi hanno notizie, ora per ora, è fatto di soli numeri,
          senza dati delle persone: si tiene un anno. Lo stesso vale per gli avvisi a enti e redazioni nei canali Telegram e nei feed
          RSS: Scorty non sa chi li segue, e su Telegram valgono le regole di Telegram.
        </li>
        <li>
          Le copie di sicurezza del database, che servono a recuperare i dati in caso di guasto, si conservano fino a 6 mesi e poi si
          cancellano da sole: fino ad allora possono contenere anche i dati più vecchi di quanto indicato sopra.
        </li>
      </ul>
      <h2>Servizi esterni</h2>
      <p>
        Il server di Scorty è ospitato da OVHcloud in Germania, nell’Unione Europea, che tratta i dati per nostro conto come responsabile
        del trattamento. La mappa di base viene caricata da OpenFreeMap (tiles.openfreemap.org), che riceve il tuo indirizzo IP come ogni sito che
        visiti. Quando cerchi un indirizzo, il testo che scrivi viene inviato dal nostro server a{' '}
        <a href="https://photon.komoot.io">Photon</a> (servizio di komoot su dati OpenStreetMap), insieme a una zona di circa 10 km
        intorno al centro della mappa per preferire i risultati vicini. Photon non riceve il tuo indirizzo IP. Le ricerche non vengono
        salvate. Non usiamo altri servizi esterni.
      </p>
      <h2>Cookie</h2>
      <p>
        Non usiamo cookie. Nel browser salviamo l’identificativo anonimo del dispositivo, necessario al funzionamento, e alcune
        cose che servono solo a te e non ci vengono inviate: le ultime ricerche, i distributori per cui hai già ricevuto l’avviso
        (per non ripeterlo), il tema chiaro o scuro, se l’avviso è acceso e se hai chiuso l’invito a installare l’app. Niente di
        questo serve a profilarti: per questo non c’è il banner.
      </p>
      <h2>I tuoi diritti</h2>
      <p>
        Puoi chiedere accesso, cancellazione e gli altri diritti previsti dagli articoli 15–22 del GDPR scrivendo a{' '}
        <a href={`mailto:${EMAIL_CONTATTI}`}>{EMAIL_CONTATTI}</a>. Puoi anche cancellare l’identificativo svuotando i dati del sito nel browser. Hai diritto di presentare
        reclamo al <a href="https://www.garanteprivacy.it">Garante per la protezione dei dati personali</a>.
      </p>
    </Pagina>
  )
}

// Ogni motivo apre l'email con oggetto e traccia già pronti: chi scrive sa cosa dire, chi legge sa già di cosa si parla.
const MOTIVI: { titolo: string; testo: string; oggetto: string; traccia: string; icona: typeof Mail }[] = [
  {
    titolo: 'Dicci cosa ne pensi',
    testo: 'Cosa funziona, cosa è scomodo, cosa non si capisce.',
    oggetto: 'Feedback su Scorty',
    traccia: 'Cosa ti è piaciuto:\n\nCosa cambieresti:\n',
    icona: MessageCircle,
  },
  {
    titolo: 'Segnala un problema',
    testo: 'Qualcosa non funziona o si comporta in modo strano.',
    oggetto: 'Problema su Scorty',
    traccia: 'Cosa stavi facendo:\n\nCosa è successo invece:\n\nTelefono e browser (per esempio iPhone e Safari):\n',
    icona: Bug,
  },
  {
    titolo: 'Proponi una funzione',
    testo: 'Un’idea che renderebbe Scorty più utile.',
    oggetto: 'Idea per Scorty',
    traccia: 'Cosa vorresti poter fare:\n\nIn quale situazione ti servirebbe:\n',
    icona: Lightbulb,
  },
  {
    titolo: 'Segnala un abuso',
    testo: 'Segnalazioni false o fatte apposta per ingannare.',
    oggetto: 'Abuso su Scorty',
    traccia: 'Distributore e comune:\n\nQuando hai visto la segnalazione sospetta:\n\nCosa hai notato:\n',
    icona: ShieldAlert,
  },
]

const mailto = (oggetto: string, traccia: string) =>
  `mailto:${EMAIL_CONTATTI}?subject=${encodeURIComponent(oggetto)}&body=${encodeURIComponent(traccia)}`

export function Contatti() {
  return (
    <Pagina titolo="Contatti e suggerimenti">
      <p>
        Scorty migliora con i consigli di chi lo usa. Scrivici a <a href={`mailto:${EMAIL_CONTATTI}`}>{EMAIL_CONTATTI}</a>, oppure
        scegli qui sotto il motivo: l’email si apre già pronta.
      </p>
      <ul className="space-y-2">
        {MOTIVI.map(({ titolo, testo, oggetto, traccia, icona: Icona }) => (
          <li key={titolo}>
            <a href={mailto(oggetto, traccia)} className="flex min-h-16 items-center gap-3 rounded-2xl border px-3.5 py-3 no-underline transition-colors active:bg-muted">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icona className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{titolo}</span>
                <span className="block text-[13px] text-muted-foreground">{testo}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </a>
          </li>
        ))}
      </ul>
      <h2>Dati di un distributore</h2>
      <p>Se un distributore ha nome, indirizzo o posizione sbagliati, o ne sei il gestore, usa «Segnala un errore» nella sua scheda: arriva subito a chi modera.</p>
      <h2>Dati personali</h2>
      <p>
        Per accedere ai tuoi dati o chiederne la cancellazione scrivi allo stesso indirizzo. Trovi i dettagli nella pagina{' '}
        <Link href="/privacy">Privacy</Link>.
      </p>
      <h2>Per chi sviluppa</h2>
      <p>
        Il codice è aperto: problemi e proposte si possono aprire anche su <a href={`${REPO_URL}/issues`}>GitHub</a>.
      </p>
    </Pagina>
  )
}

// Situazione per provincia: l'indicatore del logo per ogni provincia, con le segnalazioni delle ultime 24 ore.
export function Province() {
  const [dati, setDati] = useState<Map<string, Provincia> | null>(null)
  const [errore, setErrore] = useState(false)
  useEffect(() => void caricaProvince().then((r) => setDati(new Map(r.map((p) => [p.provincia, p]))), () => setErrore(true)), [])

  return (
    <Pagina titolo="Situazione per provincia">
      <p className="text-sm text-muted-foreground">
        Distributori con segnalazioni nelle ultime 24 ore. Più la lancetta va verso il verde, più distributori hanno carburante. Tocca una
        provincia per vedere i comuni senza carburante e senza beni della spesa, e condividere il bollettino.
      </p>
      {errore && <p>Non riesco a caricare i dati. Riprova tra poco.</p>}
      {!dati && !errore && <p className="text-muted-foreground">Caricamento…</p>}
      {dati &&
        REGIONI.map(([regione, province]) => (
          <section key={regione}>
            <h2>{regione}</h2>
            <ul className="mt-2 space-y-2">
              {Object.entries(province).map(([sigla, nome]) => {
                const p = dati.get(sigla)
                const conDati = p ? p.verde + p.giallo + p.rosso : 0
                const spesa = p && rigaSpesaProvincia(p)
                const contenuto = (
                  <>
                    <Indicatore valore={conDati ? (p!.verde + p!.giallo / 2) / conDati : null} className="h-9 w-11 shrink-0 text-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-semibold">{nome}</span>
                        {conDati > 0 && (
                          <span className="flex items-center gap-2 text-sm font-bold tabular-nums">
                            {(['verde', 'giallo', 'rosso'] as const).map((c) => (
                              <span key={c} className="flex items-center gap-0.5">
                                <SimboloStato colore={c} /> {p![c]}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="block text-[13px] text-muted-foreground">
                        {p ? `${conDati} su ${p.distributori} con notizie recenti` : 'nessun distributore'}
                      </span>
                      {spesa && <span className="block text-[13px] text-muted-foreground">{spesa}</span>}
                    </span>
                    {p && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                  </>
                )
                const classe = 'flex min-h-16 items-center gap-3 rounded-2xl border px-3 py-2.5 no-underline'
                return (
                  <li key={sigla}>
                    {p ? <Link href={`/province/${sigla}`} className={classe}>{contenuto}</Link> : <div className={classe}>{contenuto}</div>}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
    </Pagina>
  )
}
