import { BellRing, BookOpen, ChartColumn, Code, Database, Fuel, Heart, Info, Mail, Search, Smartphone, Megaphone, Moon, Navigation, Share2, Shield, ShoppingCart, Sun, SunMoon, UserRound, WifiOff, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { Link, Route, Switch, useLocation } from 'wouter'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { aspetto, type Colore } from './aspetto.ts'
import { useAggiornamento } from './aggiornamento.ts'
import { usePreferenzaAvviso, useAvvisoAlDistributore } from './avviso.ts'
import { ETICHETTA, conFonte } from './condividi.ts'
import { REPO_URL } from './config.ts'
import { ascolta, caricaMappa, caricaVicini, mioCiVado, prepara, type Luogo, type Trovato } from './dati.ts'
import { InvitoInstallazione, installabile } from './Installa.tsx'
import { Indicatore, Marchio } from './Marchio.tsx'
import { filtroValido, useMondo } from './mondo.ts'
import { Mappa, ZOOM_SPILLI, type Centro, type ControlliMappa } from './Mappa.tsx'
import { Moderazione } from './Moderazione.tsx'
import { Ricerca } from './Ricerca.tsx'
import { MieSegnalazioni } from './MieSegnalazioni.tsx'
import { PaginaAvvisi } from './Avvisi.tsx'
import { PaginaProvincia } from './PaginaProvincia.tsx'
import { ChiSiamo, ComeFunziona, Contatti, FontiDati, Legenda, Privacy, Province } from './Pagine.tsx'
import { RAGGIO_SEGNALAZIONE, chiediPosizione, distanza, formatoDistanza } from './posizione.ts'
import { SchedaPunto, SimboloStato } from './SchedaPunto.tsx'
import { Scorrevole } from './Scorrevole.tsx'
import { breve, geojson, riepilogo, type PuntoMappa } from './sintesi.ts'
import { impostaTema, useTema, type Tema } from './tema.ts'
import { NOME_PRODOTTO, PRODOTTI_DI, tipoDi, type Mondo, type Posizione, type Prodotto, type Punto, type StatoPunto } from './tipi.ts'

// Da vicino gli spilli dei distributori nella zona inquadrata, fino a VISIBILI; da lontano le bolle per zona (sintesi.ts).
// ponytail: su un telefono a Napoli centro con lo zoom 13 sono circa 50; uno schermo da computer inquadra un'area
// circa sei volte più grande e in città può superare 150: da rivedere con la versione per computer.
const VISIBILI = 150
const VICINI_PER_SEGNALARE = 20 // per cercare quelli entro 300 m bastano i più vicini
const STATI_FRESCHI = 5 * 60_000 // uno stato più recente di così resta anche se la mappa ricaricata non lo ha ancora

const VOCI_MENU: [string, string, typeof Info][] = [
  ['/mie', 'Le tue segnalazioni', UserRound],
  ['/province', 'Situazione per provincia', ChartColumn],
  ['/come-funziona', 'Come funziona', BookOpen],
  ['/fonti', 'Fonti e dati aperti', Database],
  ['/chi-siamo', 'Chi siamo', Heart],
  ['/privacy', 'Privacy', Shield],
  ['/contatti', 'Contatti e suggerimenti', Mail],
]

const MONDI: [Mondo, string, typeof Fuel][] = [['carburante', 'Carburante', Fuel], ['spesa', 'Spesa', ShoppingCart]]

const TEMI: [Tema, string, typeof Sun][] = [['auto', 'Auto', SunMoon], ['chiaro', 'Chiaro', Sun], ['scuro', 'Scuro', Moon]]

type Vicini = Awaited<ReturnType<typeof caricaVicini>>

export function App() {
  const [punti, setPunti] = useState<Punto[]>([])
  const [tutti, setTutti] = useState<PuntoMappa[]>([]) // per le bolle da lontano
  const [stati, setStati] = useState(new Map<number, StatoPunto>())
  const [caricamento, setCaricamento] = useState(true)
  const [mondo, setMondo] = useMondo()
  const [filtro, setFiltro] = useState<Prodotto | null>(null)
  const [selezionato, setSelezionato] = useState<number | null>(null)
  const [suModulo, setSuModulo] = useState(false) // la scheda del negozio si apre su «Com'è lo scaffale?»
  const [posizione, setPosizione] = useState<Posizione | null>(null)
  const [centro, setCentro] = useState<Centro | null>(null)
  const [menu, setMenu] = useState(false)
  const [legenda, setLegenda] = useState(false)
  const [ricerca, setRicerca] = useState(false)
  const [installaDalMenu, setInstallaDalMenu] = useState(false)
  const [entro300, setEntro300] = useState<{ punto: Punto; metri: number }[]>([])
  const controlli = useRef<ControlliMappa>(null)
  const online = useOnline()
  const { scelto, scuro } = useTema()
  const tipo = tipoDi(mondo)
  const spesa = mondo === 'spesa'
  const perId = useMemo(() => new Map(punti.map((p) => [p.id, p])), [punti])
  const lontano = centro != null && centro.zoom < ZOOM_SPILLI
  const sintesi = useMemo(() => geojson(tutti, stati, filtro), [tutti, stati, filtro])

  // Cambiando mondo il filtro dell'altro non vale più, la scheda si chiude e quello che si vedeva era dell'altro tipo.
  // Gli stati restano: arrivano per id e un id appartiene a un solo tipo.
  function cambiaMondo(m: Mondo, prodotto: Prodotto | null = null) {
    if (m !== mondo) {
      setPunti([])
      setTutti([])
      setEntro300([])
    }
    setMondo(m)
    setFiltro(filtroValido(prodotto ?? (m === mondo ? filtro : null), m))
    setSelezionato(null)
  }

  // Aprendo una pagina (per esempio "Le tue segnalazioni" dall'avviso) la scheda del distributore si chiude, altrimenti la coprirebbe.
  const [pagina] = useLocation()
  useEffect(() => {
    if (pagina !== '/') setSelezionato(null)
  }, [pagina])

  // Una versione nuova dell'app si carica da sola, ma solo quando non c'è niente di aperto da perdere.
  useAggiornamento(pagina === '/' && selezionato == null && !menu && !legenda && !ricerca && !entro300.length && !installaDalMenu)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', scuro)
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', scuro ? '#12141a' : '#ffffff')
  }, [scuro])

  // Da vicino si contano gli spilli, da lontano tutti i distributori della zona visibile.
  const conteggi = useMemo(() => {
    const c: Record<Colore, number> = { verde: 0, giallo: 0, rosso: 0, grigio: 0 }
    if (lontano && centro) {
      const r = riepilogo(tutti, stati, filtro, centro.limiti)
      return { verde: r.verde, giallo: r.giallo, rosso: r.rosso, grigio: r.distributori - r.verde - r.giallo - r.rosso }
    }
    const ora = Date.now()
    for (const p of punti) c[aspetto(stati.get(p.id), filtro, ora).colore]++
    return c
  }, [punti, tutti, stati, filtro, lontano, centro])
  const conDati = conteggi.verde + conteggi.giallo + conteggi.rosso
  const cerco = lontano ? !tutti.length : caricamento && !punti.length // niente ancora da mostrare
  const grandi = Math.max(conteggi.verde, conteggi.giallo, conteggi.rosso) >= 100
  const valoreZona = conDati ? (conteggi.verde + conteggi.giallo / 2) / conDati : null

  // Tra due versioni dello stesso punto vince la più recente: un aggiornamento in tempo reale
  // può arrivare prima della risposta a una richiesta partita prima.
  const piuNuovo = (prima: StatoPunto | undefined, dopo: StatoPunto) => (prima && prima.calcolato_il > dopo.calcolato_il ? prima : dopo)

  // Gli stati sono uno solo per spilli e bolle: quelli arrivati con i vicini si aggiungono, e un distributore
  // che per il server non ha più notizie le perde (se non è arrivato nel frattempo qualcosa di più nuovo).
  function mostra(r: Vicini) {
    setPunti(r.map((x) => x.punto))
    setStati((prima) => {
      const m = new Map(prima)
      for (const { punto, stato } of r) {
        if (stato) m.set(punto.id, piuNuovo(prima.get(punto.id), stato))
        else if (Date.now() - (prima.get(punto.id)?.calcolato_il ?? 0) > STATI_FRESCHI) m.delete(punto.id)
      }
      return m
    })
  }

  useEffect(() => {
    prepara().catch(() => {}) // identificativo anonimo pronto prima della prima segnalazione
    return ascolta((s) => setStati((m) => (piuNuovo(m.get(s.punto_id), s) === s ? new Map(m).set(s.punto_id, s) : m)))
  }, [])

  // La mappa da lontano: tutti i distributori e gli stati di quelli con notizie, ricaricati ogni 5 minuti
  // perché le notizie scadono dopo 24 ore; nel frattempo gli aggiornamenti arrivano in tempo reale.
  useEffect(() => {
    let valida = true // scarta la risposta del mondo che si è appena lasciato
    const carica = () =>
      caricaMappa(tipo)
        .then((r) => {
          if (!valida) return
          setTutti(r.punti)
          setStati((prima) => {
            const m = new Map(r.stati.map((s) => [s.punto_id, piuNuovo(prima.get(s.punto_id), s)] as const))
            for (const [id, s] of prima) if (!m.has(id) && Date.now() - s.calcolato_il < STATI_FRESCHI) m.set(id, s)
            return m
          })
        })
        .catch(() => {}) // senza rete restano le bolle di prima
    carica()
    const t = setInterval(carica, STATI_FRESCHI)
    return () => (valida = false, clearInterval(t))
  }, [tipo])

  // Con una scheda aperta la mappa resta com'è: si aggiorna alla chiusura.
  const schedaChiusa = selezionato == null
  useEffect(() => {
    if (!centro || !schedaChiusa) return
    if (centro.zoom < ZOOM_SPILLI) return (setPunti([]), setCaricamento(false))
    let valida = true // scarta le risposte arrivate dopo uno spostamento successivo
    setCaricamento(true)
    caricaVicini(centro, VISIBILI, filtro, tipo, centro.limiti).then((r) => valida && (mostra(r), setCaricamento(false)))
    return () => void (valida = false)
  }, [centro, filtro, tipo, schedaChiusa])

  function apri(p: Punto) {
    setSuModulo(false)
    setSelezionato(p.id)
    controlli.current?.vaiA(p)
  }

  // Dalla ricerca: un luogo sposta la mappa, un distributore apre la sua scheda anche se non era tra i 20 mostrati.
  const centroRicerca = useMemo(() => centro ?? { lat: 40.5, lon: 15.5, zoom: 6 }, [centro])
  function vaiAlLuogo(l: Luogo) {
    setRicerca(false)
    controlli.current?.volaA(l, l.zoom)
  }
  // Apre un distributore anche se non è tra i 20 sulla mappa.
  function mostraPunto(p: Punto, stato?: StatoPunto | null) {
    setPunti((prima) => (prima.some((x) => x.id === p.id) ? prima : [p, ...prima]))
    if (stato) setStati((m) => new Map(m).set(p.id, stato))
    apri(p)
  }
  function apriTrovato(t: Trovato) {
    setRicerca(false)
    mostraPunto(t.punto, t.stato)
  }

  // Fermo a un distributore con Scorty aperto, o al negozio dove hai detto «Ci vado»: un invito a dire com'è.
  const avviso = usePreferenzaAvviso()
  // Parte dopo la localizzazione iniziale della mappa (o dopo 8 s): due richieste di GPS insieme all'avvio si disturbano.
  const [mappaLocalizzata, setMappaLocalizzata] = useState(false)
  useEffect(() => void (posizione && setMappaLocalizzata(true)), [posizione])
  useEffect(() => {
    const t = setTimeout(() => setMappaLocalizzata(true), 8000)
    return () => clearTimeout(t)
  }, [])
  useAvvisoAlDistributore(avviso.attivo && mappaLocalizzata, () => mioCiVado()?.punto ?? null, (p) => {
    navigator.vibrate?.(150)
    const negozio = p.tipo === 'negozio'
    toast(`Sei da ${p.nome}${p.indirizzo ? ` – ${p.indirizzo}` : ''}?`, {
      description: negozio
        ? 'Dicci com’è lo scaffale: bastano pochi tocchi e aiuti chi cerca.'
        : 'Dicci com’è il carburante: bastano due tocchi e aiuti chi cerca.',
      action: {
        label: 'Segnala',
        onClick: () => {
          cambiaMondo(negozio ? 'spesa' : 'carburante')
          mostraPunto(p)
          setSuModulo(negozio)
        },
      },
      duration: 30_000,
    })
  })
  async function cambiaAvviso() {
    if (avviso.attivo) return avviso.imposta(false)
    try {
      await chiediPosizione() // chiede il permesso, se non c'è ancora
      avviso.imposta(true)
      toast.success('Avviso attivo', { description: 'Con Scorty aperto, quando sei fermo a un distributore ti chiediamo com’è.' })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function segnalaQui() {
    const attesa = toast.loading('Cerco la tua posizione…')
    try {
      const pos = await chiediPosizione()
      setPosizione(pos)
      const r = await caricaVicini(pos, VICINI_PER_SEGNALARE, null, tipo)
      const v = r.map(({ punto }) => ({ punto, metri: distanza(pos, punto) })).filter((v) => v.metri <= RAGGIO_SEGNALAZIONE)
      toast.dismiss(attesa)
      if (!v.length) {
        return toast(`Nessun ${spesa ? 'negozio' : 'distributore'} entro 300 m`, { description: `Per segnalare devi trovarti ${spesa ? 'in un negozio' : 'a un distributore'}. Puoi comunque consultare la mappa.` })
      }
      mostra(r)
      if (v.length === 1) apri(v[0].punto)
      else setEntro300(v)
    } catch (e) {
      toast.error((e as Error).message, { id: attesa })
    }
  }

  async function condividi() {
    // Si condivide la zona della mappa, non un singolo distributore: un messaggio inoltrato invecchia, la mappa no.
    const url = conFonte(`${location.origin}/?mondo=${mondo}${location.hash}`, ETICHETTA.zona)
    const text = spesa ? 'Spesa in questa zona, aggiornata in tempo reale' : 'Carburante in questa zona, aggiornato in tempo reale'
    if (navigator.share) return navigator.share({ title: 'Scorty', text, url }).catch(() => {})
    await navigator.clipboard.writeText(url)
    toast.success('Link copiato')
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <Mappa
        punti={punti}
        sintesi={sintesi}
        stati={stati}
        filtro={filtro}
        selezionato={selezionato}
        scuro={scuro}
        onSeleziona={(id) => perId.has(id) && apri(perId.get(id)!)}
        onCentro={setCentro}
        onPosizione={setPosizione}
        controlli={controlli}
      />

      {/* Sul computer menu, ricerca e filtri stanno nella colonna di sinistra, come il blocco in basso: il resto è mappa. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 space-y-2 px-3 pt-[max(env(safe-area-inset-top),0.75rem)] md:right-auto md:w-[472px] md:px-4 md:pt-4">
        <div className="flex items-center gap-2">
          <button
            aria-label="Menu"
            className="pointer-events-auto flex size-12 shrink-0 items-center justify-center rounded-full bg-card shadow-float transition-transform active:scale-95"
            onClick={() => setMenu(true)}
          >
            <Marchio className="size-9" />
          </button>
          <button
            className="pointer-events-auto flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-card px-4 text-left shadow-float transition-transform active:scale-[0.98]"
            onClick={() => setRicerca(true)}
          >
            <Search className="size-5 shrink-0" />
            <span className="truncate text-[15px] text-muted-foreground">Cerca comune, indirizzo o {spesa ? 'supermercato' : 'distributore'}</span>
          </button>
        </div>
        <div role="group" aria-label="Carburante o spesa" className="pointer-events-auto flex w-fit gap-0.5 rounded-full bg-card p-1 shadow-float">
          {MONDI.map(([m, nome, Icona]) => (
            <button
              key={m}
              aria-pressed={mondo === m}
              onClick={() => cambiaMondo(m)}
              className={cn(
                'flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors',
                mondo === m ? 'bg-primary text-primary-foreground' : 'text-foreground',
              )}
            >
              <Icona className="size-4" /> {nome}
            </button>
          ))}
        </div>
        {/* Mai una parola tagliata: sul telefono una riga che scorre, sfumata dove c'è altro (Scorrevole.tsx; due righe
            occupavano troppa mappa); sul computer la barra esce dalla colonna e mostra tutto. Le categorie sono il livello
            sotto il mondo: barra più bassa, rientrata e velata, senza ombra (scelta dell'utente, senza colori nuovi). */}
        <div className="flex pl-3 md:w-max md:max-w-[calc(100vw-2rem)]">
          <nav aria-label={spesa ? 'Filtra per categoria' : 'Filtra per carburante'} className="pointer-events-auto flex min-w-0 rounded-full bg-white/80 p-0.5 backdrop-blur-md dark:bg-white/10">
            <Scorrevole className="gap-0.5">
            {PRODOTTI_DI[mondo].map((p) => (
              <button
                key={p}
                aria-pressed={filtro === p}
                onClick={() => setFiltro(filtro === p ? null : p)}
                className={cn(
                  'flex h-[34px] shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-semibold transition-colors',
                  filtro === p ? 'bg-primary text-primary-foreground' : 'text-foreground',
                )}
              >
                {NOME_PRODOTTO[p]}
                {filtro === p && <X className="size-3.5" aria-label="togli il filtro" />}
              </button>
            ))}
            </Scorrevole>
          </nav>
        </div>
        {!online && (
          <p className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-card px-3.5 py-2.5 text-sm font-medium shadow-float">
            <WifiOff className="size-4 shrink-0" /> Sei offline: quello che vedi potrebbe non essere aggiornato.
          </p>
        )}
      </header>

      {/* Sul telefono, dall'alto: invito a installare, crediti e pulsanti tondi, barra. Sul computer invito e barra
          sono un blocco in basso a sinistra, l'uno sopra l'altra; crediti e pulsanti vanno all'angolo destro. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 grid px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] [grid-template-areas:'invito'_'riga'_'barra'] md:grid-cols-[440px_1fr] md:gap-x-4 md:px-4 md:[grid-template-areas:'invito_riga'_'barra_riga']">
        <div className="self-end [grid-area:invito]">
          <InvitoInstallazione forzato={installaDalMenu} onChiudi={() => setInstallaDalMenu(false)} />
        </div>
        <div className="mb-2.5 flex items-end justify-between gap-2 [grid-area:riga] md:mb-0 md:justify-end md:gap-3 md:self-end">
          <p className="pointer-events-auto rounded-full bg-card/80 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur">
            © <a href="https://openmaptiles.org">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ·{' '}
            <a href="https://openfreemap.org">OpenFreeMap</a>
          </p>
          <div className="pointer-events-auto flex flex-col rounded-full bg-card shadow-float">
            <BottoneTondo etichetta="Condividi questa zona" onClick={condividi}>
              <Share2 className="size-5" />
            </BottoneTondo>
            <span className="mx-3 h-px bg-border" />
            <BottoneTondo etichetta="Mostra la mia posizione" onClick={() => controlli.current?.trovaPosizione()}>
              <Navigation className="size-5 fill-current" />
            </BottoneTondo>
          </div>
        </div>

        {/* La barra della zona: l'indicatore del logo applicato ai distributori sulla mappa */}
        <div className="pointer-events-auto flex h-16 items-center gap-1 rounded-full bg-[#16181d] p-2 text-white shadow-float [grid-area:barra] dark:bg-card dark:ring-1 dark:ring-white/10">
          <button
            className={cn('flex h-12 min-w-0 flex-1 items-center rounded-full pr-2 pl-2 text-left transition-colors active:bg-white/10', grandi ? 'gap-1.5' : 'gap-2.5')}
            aria-label={`${lontano ? 'In questa zona' : 'Qui intorno'}: ${conteggi.verde} ${spesa ? 'con scorte' : 'disponibili'}, ${conteggi.giallo} ${spesa ? 'con poco' : 'scarsi o parziali'}, ${conteggi.rosso} ${spesa ? 'senza' : 'finiti'}. Apri la legenda`}
            onClick={() => setLegenda(true)}
          >
            {/* Oscilla solo finché non c'è niente da mostrare; poi la lancetta va dal valore precedente al nuovo */}
            <Indicatore valore={valoreZona} caricamento={cerco} className={cn('shrink-0', grandi ? 'h-8 w-9' : 'h-10 w-12')} />
            {cerco || !conDati ? (
              <span className="text-[13px] leading-tight font-semibold">
                {cerco ? (spesa ? 'Cerco i negozi…' : 'Cerco i distributori…')
                  : lontano ? `Nessuna notizia in questa zona. Sei ${spesa ? 'in un negozio' : 'a un distributore'}? Segnala!`
                  : `Ancora nessuna notizia qui. Sei ${spesa ? 'in un negozio' : 'a un distributore'}? Segnala!`}
              </span>
            ) : (
              // Da lontano i numeri possono arrivare alle centinaia: più piccoli, per restare accanto a «Segnala».
              <span className={cn('flex min-w-0 items-center overflow-hidden', grandi ? 'gap-2' : 'gap-3')}>
                {(['verde', 'giallo', 'rosso'] as const).map((c) => (
                  <span key={c} className={cn('flex items-center', grandi ? 'gap-0.5' : 'gap-1')}>
                    <SimboloStato colore={c} />
                    <span className={cn('font-extrabold tabular-nums', grandi ? 'text-[14px]' : 'text-[17px]')}>{breve(conteggi[c])}</span>
                  </span>
                ))}
              </span>
            )}
          </button>
          <button
            className={cn('flex h-12 shrink-0 items-center gap-2 rounded-full bg-white text-base font-bold text-[#16181d] transition-transform active:scale-95', grandi ? 'px-4' : 'px-5')}
            onClick={segnalaQui}
          >
            <Megaphone className="size-5" /> Segnala
          </button>
        </div>
      </div>

      {ricerca && (
        <Ricerca
          centro={centroRicerca}
          mondo={mondo}
          onCambiaMondo={cambiaMondo}
          onChiudi={() => setRicerca(false)}
          onLuogo={vaiAlLuogo}
          onDistributore={apriTrovato}
          onVicinoAMe={() => (setRicerca(false), controlli.current?.trovaPosizione())}
        />
      )}

      <SchedaPunto
        punto={selezionato != null ? (perId.get(selezionato) ?? null) : null}
        punti={punti}
        stati={stati}
        filtro={filtro}
        posizione={posizione}
        onPosizione={setPosizione}
        onSeleziona={apri}
        onChiudi={() => setSelezionato(null)}
        suModulo={suModulo}
      />

      <Drawer open={entro300.length > 0} onOpenChange={(o) => !o && setEntro300([])} showSwipeHandle>
        <DrawerContent>
          <div className="px-5 pt-2 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
            <DrawerTitle className="text-[22px] font-bold tracking-tight">Dove sei?</DrawerTitle>
            <DrawerDescription>{spesa ? 'Negozi' : 'Distributori'} entro {RAGGIO_SEGNALAZIONE} m da te</DrawerDescription>
            <ul className="mt-4 space-y-2">
              {entro300.map((v) => (
                <li key={v.punto.id}>
                  <button
                    className="flex min-h-16 w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors active:bg-muted"
                    onClick={() => (setEntro300([]), apri(v.punto))}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
                      {spesa ? <ShoppingCart className="size-5" /> : <Fuel className="size-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{v.punto.nome}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">{v.punto.indirizzo ?? v.punto.marchio}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{formatoDistanza(v.metri)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={legenda} onOpenChange={setLegenda} showSwipeHandle>
        <DrawerContent>
          <div className="space-y-3 overflow-y-auto px-5 pt-2 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
            <DrawerTitle className="text-[22px] font-bold tracking-tight">Legenda</DrawerTitle>
            <DrawerDescription>
              Da vicino vedi {spesa ? 'i negozi' : 'i distributori'} della zona inquadrata. Da lontano le bolle riassumono le zone: il numero dice quanti
              {spesa ? ' negozi' : ' distributori'} hanno notizie, l’anello come sono messi, e un cerchio vuoto è una zona senza notizie. Tocca una bolla per
              avvicinarti. Contano le segnalazioni delle ultime 24 ore; le più recenti pesano di più.
            </DrawerDescription>
            <div className="flex items-center gap-3 rounded-2xl bg-muted p-3.5 text-sm">
              <Indicatore valore={0.75} className="h-10 w-12 shrink-0 text-foreground" />
              <span>L’indicatore in basso riassume la zona: più la lancetta va verso il verde, più {spesa ? 'negozi hanno scorte' : 'distributori hanno carburante'}.</span>
            </div>
            <Legenda />
            <Link href="/come-funziona" onClick={() => setLegenda(false)} className="block py-2 text-sm font-semibold underline underline-offset-2">
              Come calcoliamo lo stato
            </Link>
          </div>
        </DrawerContent>
      </Drawer>

      <Sheet open={menu} onOpenChange={setMenu}>
        {/* Il menu scorre: su un telefono basso, con le barre del browser, il fondo (tema, contatti) non deve finire fuori. */}
        <SheetContent side="left" className="w-[85vw] max-w-sm overflow-y-auto">
          <SheetHeader className="flex-row items-center gap-3 pt-6">
            <Marchio className="size-12 shrink-0" />
            <div>
              <SheetTitle className="text-2xl font-extrabold tracking-tight">Scorty</SheetTitle>
              <SheetDescription>Mappa civica delle scorte</SheetDescription>
            </div>
          </SheetHeader>
          <nav className="flex flex-col gap-0.5 px-2">
            {VOCI_MENU.map(([href, testo, Icona]) => (
              <Link key={href} href={href} onClick={() => setMenu(false)} className="flex min-h-12 items-center gap-3 rounded-2xl px-3 text-base font-medium hover:bg-muted">
                <Icona className="size-5 text-muted-foreground" /> {testo}
              </Link>
            ))}
            {installabile() && (
              <button onClick={() => (setMenu(false), setInstallaDalMenu(true))} className="flex min-h-12 items-center gap-3 rounded-2xl px-3 text-left text-base font-medium hover:bg-muted">
                <Smartphone className="size-5 text-muted-foreground" /> Aggiungi alla schermata Home
              </button>
            )}
            <a href={REPO_URL} className="flex min-h-12 items-center gap-3 rounded-2xl px-3 text-base font-medium hover:bg-muted">
              <Code className="size-5 text-muted-foreground" /> Codice sorgente
            </a>
          </nav>
          <div className="mt-auto space-y-3 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <button role="switch" aria-checked={avviso.attivo} onClick={cambiaAvviso} className="flex w-full items-center gap-3 rounded-2xl bg-muted p-3.5 text-left">
              <BellRing className="size-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Avviso al distributore</span>
                <span className="block text-xs text-muted-foreground">Con Scorty aperto, quando sei fermo a un distributore</span>
              </span>
              <span className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', avviso.attivo ? 'bg-green-600' : 'bg-input')}>
                <span className={cn('absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform', avviso.attivo ? 'translate-x-5.5' : 'translate-x-0.5')} />
              </span>
            </button>
            <div role="group" aria-label="Tema" className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1">
              {TEMI.map(([t, nome, Icona]) => (
                <button
                  key={t}
                  aria-pressed={scelto === t}
                  onClick={() => impostaTema(t)}
                  className={cn('flex h-10 items-center justify-center gap-1.5 rounded-full text-sm font-semibold text-muted-foreground', scelto === t && 'bg-card text-foreground shadow-sm')}
                >
                  <Icona className="size-4" /> {nome}
                </button>
              ))}
            </div>
            <Link href="/contatti" onClick={() => setMenu(false)} className="block rounded-2xl bg-muted p-3.5 text-sm">
              <strong className="font-semibold">Hai un’idea o hai trovato un problema?</strong>{' '}
              <span className="underline underline-offset-2">Scrivici</span>
            </Link>
            <p className="text-xs text-muted-foreground">Progetto indipendente e no profit. Codice aperto con licenza AGPL-3.0.</p>
          </div>
        </SheetContent>
      </Sheet>

      <Switch>
        <Route path="/mie" component={MieSegnalazioni} />
        <Route path="/come-funziona" component={ComeFunziona} />
        <Route path="/fonti" component={FontiDati} />
        <Route path="/chi-siamo" component={ChiSiamo} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/contatti" component={Contatti} />
        <Route path="/admin" component={Moderazione} />
        <Route path="/avvisi" component={PaginaAvvisi} />
        <Route path="/province/:sigla" component={PaginaProvincia} />
        <Route path="/province" component={Province} />
      </Switch>
    </div>
  )
}

function BottoneTondo({ etichetta, onClick, children }: { etichetta: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={etichetta} className="flex size-12 items-center justify-center rounded-full transition-transform active:scale-95" onClick={onClick}>
      {children}
    </button>
  )
}

function useOnline() {
  return useSyncExternalStore(
    (cb) => (addEventListener('online', cb), addEventListener('offline', cb), () => (removeEventListener('online', cb), removeEventListener('offline', cb))),
    () => navigator.onLine,
  )
}
