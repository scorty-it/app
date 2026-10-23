import { ChevronDown, ChevronRight, Copy, Download, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Link } from 'wouter'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { titoloProvincia } from './anteprima.ts'
import { browserInterno, conNotizie, finitiSu, fraseVuota, gruppo, momento, nomeFile, oraNotizia, testoBollettino, valoreIndicatore } from './bollettino.ts'
import { disegnaBollettino } from './bollettino-immagine.ts'
import { creaPdf } from './bollettino-pdf.ts'
import { ETICHETTA, condividiTesto, conFonte } from './condividi.ts'
import { caricaBollettino, type BollettinoProvincia, type ComuneBollettino } from './dati.ts'
import { Andamento } from './GraficoAndamento.tsx'
import { Incorpora } from './Incorpora.tsx'
import { ZOOM_SPILLI } from './Mappa.tsx'
import { Indicatore } from './Marchio.tsx'
import { Pagina } from './Pagine.tsx'
import { nomeProvincia, provinciaNota } from './province.ts'
import { SimboloStato } from './SchedaPunto.tsx'

const ALLE_PROVINCE = { href: '/province', etichetta: 'Torna alle province' }
const APRI_NEL_BROWSER = 'Per scaricare il bollettino apri la pagina in Chrome o Safari'
const COLORI = ['verde', 'giallo', 'rosso'] as const
const sullaMappa = (zoom: number, p: { lat: number; lon: number }) => `/#${zoom}/${p.lat.toFixed(4)}/${p.lon.toFixed(4)}`

// La situazione di una provincia per enti e testate: in cima i comuni senza carburante, in fondo il bollettino da condividere.
// Un link fisso da salvare sul telefono (/province/SA); i dati si ricaricano ogni minuto mentre la pagina è visibile.
export function PaginaProvincia({ params }: { params: { sigla: string } }) {
  const sigla = params.sigla.toUpperCase()
  const nota = provinciaNota(sigla)
  const [b, setB] = useState<BollettinoProvincia | null>(null)
  const [errore, setErrore] = useState<'non_trovata' | 'rete' | null>(null)

  useEffect(() => {
    if (!nota) return
    let viva = true
    let ultima = 0 // conta solo la richiesta partita per ultima: una risposta vecchia può arrivare dopo una nuova
    const carica = () => {
      const n = ++ultima
      caricaBollettino(sigla).then(
        // Stessi dati di prima (stesso calcolo del server): niente nuovo disegno dell'immagine.
        (dati) => viva && n === ultima && (setB((prima) => (prima?.aggiornato_il === dati.aggiornato_il ? prima : dati)), setErrore(null)),
        // Il server risponde così solo se la provincia non ha distributori.
        (e: Error) => viva && n === ultima && setErrore(e.message === 'Provincia non trovata.' ? 'non_trovata' : 'rete'),
      )
    }
    const seVisibile = () => document.visibilityState === 'visible' && carica()
    carica()
    const ogni = setInterval(seVisibile, 60_000)
    document.addEventListener('visibilitychange', seVisibile)
    return () => {
      viva = false
      clearInterval(ogni)
      document.removeEventListener('visibilitychange', seVisibile)
    }
  }, [sigla, nota])

  if (!nota || errore === 'non_trovata') {
    return (
      <Pagina titolo="Provincia non trovata" indietro={ALLE_PROVINCE}>
        <p>
          Non abbiamo dati per questa provincia. <Link href="/province">Vedi tutte le province</Link>
        </p>
      </Pagina>
    )
  }

  const nome = nomeProvincia(sigla)
  return (
    <Pagina titolo={`Provincia di ${nome}`} titoloDocumento={titoloProvincia(nome)} indietro={ALLE_PROVINCE}>
      {!b && errore && <p>Non riesco a caricare i dati. Riprova tra poco.</p>}
      {!b && !errore && <p className="text-muted-foreground">Caricamento…</p>}
      {b && <Contenuto b={b} nome={nome} url={`${location.origin}/province/${sigla}`} />}
    </Pagina>
  )
}

function Contenuto({ b, nome, url }: { b: BollettinoProvincia; nome: string; url: string }) {
  const senza = gruppo(b, 'senza_carburante')
  const conDati = gruppo(b, 'con_notizie')
  const senzaDati = gruppo(b, 'senza_notizie')
  const vuota = fraseVuota(b)
  return (
    <>
      <p className="text-sm text-muted-foreground">Aggiornata alle {momento(b.aggiornato_il).ora}</p>

      <section className="flex items-center gap-4 rounded-2xl bg-muted px-4 py-3">
        <Indicatore valore={valoreIndicatore(b)} className="h-14 w-17 shrink-0 text-foreground" />
        <div className="min-w-0 space-y-1">
          {conNotizie(b) > 0 && (
            <div className="flex gap-3 text-lg font-extrabold tabular-nums">
              {COLORI.map((c) => (
                <span key={c} className="flex items-center gap-1">
                  <SimboloStato colore={c} /> {b[c]}
                </span>
              ))}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {conNotizie(b)} su {b.distributori} distributori con notizie recenti
          </p>
          <a href={sullaMappa(10, b)} className="text-sm font-semibold">
            Vedi sulla mappa
          </a>
        </div>
      </section>

      <Andamento b={b} />
      <p className="text-sm">
        <Link href="/avvisi" className="font-semibold">Ricevi un avviso quando la situazione peggiora</Link>
        <span className="text-muted-foreground"> · Telegram e feed RSS, per enti e redazioni</span>
      </p>

      <section>
        <h2 className="flex items-center gap-2">
          Comuni senza carburante
          {senza.length > 0 && <span className="rounded-full bg-[#dc2626] px-2 text-[13px] font-extrabold text-white no-underline">{senza.length}</span>}
        </h2>
        {senza.length ? (
          <ul className="mt-2 space-y-2">
            {senza.map((c) => (
              <li key={c.comune}>
                <RigaComune c={c} b={b} />
              </li>
            ))}
          </ul>
        ) : (
          <p>{vuota}</p>
        )}
      </section>

      <Elenco titolo={`Comuni con notizie (${conDati.length})`}>
        {conDati.map((c) => (
          <li key={c.comune}>
            <a href={sullaMappa(ZOOM_SPILLI, c)} className="flex min-h-11 items-center gap-3 no-underline">
              <span className="min-w-0 flex-1 font-semibold">{c.comune}</span>
              <span className="flex gap-2 text-sm font-bold tabular-nums">
                {COLORI.map((colore) => (
                  <span key={colore} className="flex items-center gap-0.5">
                    <SimboloStato colore={colore} /> {c[colore]}
                  </span>
                ))}
              </span>
            </a>
          </li>
        ))}
      </Elenco>

      <Elenco titolo={`Comuni senza notizie (${senzaDati.length})`}>
        {senzaDati.map((c) => (
          <li key={c.comune}>
            <a href={sullaMappa(ZOOM_SPILLI, c)} className="flex min-h-11 items-center no-underline">
              {c.comune}
            </a>
          </li>
        ))}
      </Elenco>

      <BarraCondivisione b={b} nome={nome} url={url} />
    </>
  )
}

function RigaComune({ c, b }: { c: ComuneBollettino; b: BollettinoProvincia }) {
  return (
    <a href={sullaMappa(ZOOM_SPILLI, c)} className="flex min-h-15 items-center gap-3 rounded-2xl border px-3 py-2 no-underline">
      <SimboloStato colore="rosso" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{c.comune}</span>
        <span className="block text-[13px] text-muted-foreground">
          {finitiSu(c)}
          {c.ultima && ` · ultima notizia ${oraNotizia(c.ultima, b.aggiornato_il)}`}
        </span>
        {!c.confermato && (
          <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            da confermare
          </span>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </a>
  )
}

function Elenco({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border">
      <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between px-3 font-semibold">
        {titolo}
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ul className="divide-y border-t px-3">{children}</ul>
    </details>
  )
}

function scarica(blob: Blob, nome: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}

// Un file preparato appena arrivano i dati, prima del tocco: sull'iPhone la condivisione deve partire subito, dentro il tocco.
function usePreparato(prepara: () => Promise<Blob>, chiavi: unknown[]) {
  const [file, setFile] = useState<Blob | 'errore' | null>(null)
  useEffect(() => {
    let attuale = true
    prepara().then((blob) => attuale && setFile(blob), () => attuale && setFile('errore'))
    return () => void (attuale = false)
  }, chiavi)
  return file
}

// Sul telefono il file si condivide (WhatsApp, email, salva); sul computer si scarica, come ci si aspetta da un PDF.
const telefono = () => matchMedia('(pointer: coarse)').matches

// Immagine, PDF e testo del bollettino.
function BarraCondivisione({ b, nome, url }: { b: BollettinoProvincia; nome: string; url: string }) {
  const immagine = usePreparato(() => disegnaBollettino(b, nome, url), [b, nome, url])
  const pdf = usePreparato(() => creaPdf(b, nome, url), [b, nome, url])

  function condividi(preparato: Blob | 'errore' | null, estensione: 'png' | 'pdf', alternative: string) {
    if (browserInterno(navigator.userAgent)) return void toast(APRI_NEL_BROWSER)
    if (preparato === 'errore') return void toast(`Non riesco a preparare il file su questo telefono: usa ${alternative}`)
    if (!preparato) return
    const file = new File([preparato], nomeFile(b, estensione), { type: preparato.type })
    if (telefono() && navigator.canShare?.({ files: [file] })) {
      return void navigator.share({ files: [file], title: `Bollettino carburante, provincia di ${nome}` }).catch(() => {})
    }
    scarica(preparato, file.name)
  }

  const [daCopiare, setDaCopiare] = useState<string | null>(null)
  async function testo() {
    const t = testoBollettino(b, nome, conFonte(url, ETICHETTA.bollettino))
    const esito = await condividiTesto(t, {
      share: navigator.share && ((dati) => navigator.share(dati)),
      copia: navigator.clipboard && ((x) => navigator.clipboard.writeText(x)),
    })
    if (esito === 'copiato') toast('Testo copiato')
    if (esito === 'da_copiare') {
      setDaCopiare(t)
      toast('Seleziona il testo e copialo')
    }
  }
  const [incorpora, setIncorpora] = useState(false)
  const pulsante = 'h-12 gap-2 rounded-2xl px-4 text-base font-semibold'
  return (
    <div className="sticky bottom-0 -mx-4 space-y-2 border-t bg-background/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)] backdrop-blur">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold text-muted-foreground">Condividi il bollettino</p>
        <button type="button" className="text-[13px] font-semibold underline underline-offset-2" onClick={() => setIncorpora(true)}>
          Incorpora nel tuo sito
        </button>
      </div>
      <Incorpora sigla={b.provincia} nome={nome} aperto={incorpora} onChiudi={() => setIncorpora(false)} />
      <div className="flex gap-2">
        <button type="button" className={cn(buttonVariants(), pulsante, 'flex-1')} disabled={!immagine} onClick={() => condividi(immagine, 'png', 'PDF o Testo')}>
          <Share2 className="size-5" /> Immagine
        </button>
        <button type="button" className={cn(buttonVariants({ variant: 'outline' }), pulsante)} disabled={!pdf} onClick={() => condividi(pdf, 'pdf', 'Immagine o Testo')}>
          <Download className="size-5" /> PDF
        </button>
        <button type="button" className={cn(buttonVariants({ variant: 'outline' }), pulsante)} onClick={testo}>
          <Copy className="size-5" /> Testo
        </button>
      </div>
      {daCopiare && (
        <textarea
          readOnly
          aria-label="Testo del bollettino da copiare"
          value={daCopiare}
          rows={5}
          className="w-full rounded-xl border bg-background p-2 text-sm"
          ref={(t) => t?.select()}
        />
      )}
    </div>
  )
}
