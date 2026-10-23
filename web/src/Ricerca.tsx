import { ArrowLeft, Building2, Clock, Fuel, LoaderCircle, LocateFixed, MapPin, ShoppingCart, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { COLORE_STATO } from './aspetto.ts'
import { cerca, type Luogo, type Trovato } from './dati.ts'
import { formatoDistanza } from './posizione.ts'
import { SimboloStato } from './SchedaPunto.tsx'
import { passaggioMondo } from './mondo.ts'
import { NOME_PRODOTTO, tipoDi, type Mondo, type Posizione, type Prodotto, type TipoPunto } from './tipi.ts'

// Schermata di ricerca: comuni, indirizzi e distributori mentre si scrive.

type Recente = { tipo: 'luogo'; luogo: Luogo } | { tipo: 'distributore'; trovato: Trovato }
const CHIAVE = 'scorty-recenti'

function recenti(): Recente[] {
  try {
    return JSON.parse(localStorage.getItem(CHIAVE) ?? '[]')
  } catch {
    return []
  }
}
// Solo in questo browser, per comodità: le ultime 6 scelte.
function ricorda(r: Recente) {
  const chiave = (x: Recente) => (x.tipo === 'luogo' ? `l:${x.luogo.nome}:${x.luogo.lat}` : `d:${x.trovato.punto.id}`)
  try {
    localStorage.setItem(CHIAVE, JSON.stringify([r, ...recenti().filter((x) => chiave(x) !== chiave(r))].slice(0, 6)))
  } catch {
    // dati del sito bloccati: niente cronologia
  }
}

type Risultati = Awaited<ReturnType<typeof cerca>>

interface Props {
  centro: Posizione
  mondo: Mondo
  // Scelta di un altro mondo o di un prodotto nominato dalla frase («latte vomero»): l'app apre il mondo e applica il filtro.
  onCambiaMondo: (m: Mondo, prodotto: Prodotto | null) => void
  onChiudi: () => void
  onLuogo: (l: Luogo) => void
  onDistributore: (t: Trovato) => void
  onVicinoAMe: () => void
}

export function Ricerca({ centro, mondo, onCambiaMondo, onChiudi, onLuogo, onDistributore, onVicinoAMe }: Props) {
  const [testo, setTesto] = useState('')
  const [risultati, setRisultati] = useState<Risultati | null>(null)
  const [caricamento, setCaricamento] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const campo = useRef<HTMLInputElement>(null)
  const q = testo.trim()

  useEffect(() => campo.current?.focus(), [])

  // Si cerca 200 ms dopo l'ultimo tasto; la richiesta precedente si annulla.
  useEffect(() => {
    if (!q) return setRisultati(null)
    const annulla = new AbortController()
    const attesa = setTimeout(() => {
      setCaricamento(true)
      cerca(q, centro, tipoDi(mondo), annulla.signal)
        .then((r) => (setRisultati(r), setErrore(null)))
        .catch((e) => annulla.signal.aborted || setErrore(e.message))
        .finally(() => annulla.signal.aborted || setCaricamento(false))
    }, 200)
    return () => (clearTimeout(attesa), annulla.abort())
  }, [q, centro, mondo])

  // Il mondo della scelta (da un risultato o da una ricerca recente) e il prodotto nominato dalla frase.
  const passa = (tipo: TipoPunto) => {
    const p = passaggioMondo(mondo, tipo, risultati?.prodotto ?? null)
    if (p) onCambiaMondo(p.mondo, p.filtro)
  }
  const scegliLuogo = (l: Luogo) => (ricorda({ tipo: 'luogo', luogo: l }), passa(risultati?.tipo ?? tipoDi(mondo)), onLuogo(l))
  // I recenti salvati prima dei negozi non hanno `tipo`: erano distributori.
  const scegliDistributore = (t: Trovato) => (ricorda({ tipo: 'distributore', trovato: t }), passa(t.punto.tipo ?? 'distributore'), onDistributore(t))
  const primo = () => {
    if (risultati?.luoghi[0]) scegliLuogo(risultati.luoghi[0])
    else if (risultati?.distributori[0]) scegliDistributore(risultati.distributori[0])
  }

  const vuoto = risultati && !risultati.luoghi.length && !risultati.distributori.length
  const passati = q ? [] : recenti()
  const negozi = mondo === 'spesa'
  const tipoRisultati: TipoPunto = risultati?.tipo ?? tipoDi(mondo)
  const nomeDove = negozi ? 'supermercato' : 'distributore'

  return (
    <div role="dialog" aria-label="Cerca" className="fixed inset-0 z-40 flex flex-col bg-background md:inset-y-4 md:right-auto md:left-4 md:w-[440px] md:rounded-3xl md:border md:shadow-float">
      <form
        onSubmit={(e) => (e.preventDefault(), primo())}
        className="flex items-center gap-1 border-b px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2"
      >
        <button type="button" aria-label="Chiudi la ricerca" className="flex size-12 shrink-0 items-center justify-center rounded-full hover:bg-muted" onClick={onChiudi}>
          <ArrowLeft className="size-5" />
        </button>
        <div className="relative flex-1">
          <input
            ref={campo}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label={`Comune, indirizzo o ${nomeDove}`}
            placeholder={`Comune, indirizzo o ${nomeDove}`}
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onChiudi()}
            className="h-12 w-full rounded-full bg-muted pr-11 pl-4 text-base outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
          />
          {caricamento ? (
            <LoaderCircle className="absolute top-3.5 right-4 size-5 animate-spin text-muted-foreground" />
          ) : (
            testo && (
              <button type="button" aria-label="Cancella" className="absolute top-1 right-1 flex size-10 items-center justify-center rounded-full" onClick={() => (setTesto(''), campo.current?.focus())}>
                <X className="size-4" />
              </button>
            )
          )}
        </div>
      </form>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {!q && (
          <>
            <Riga icona={<LocateFixed className="size-5" />} titolo="Vicino a me" dettaglio={negozi ? 'I negozi intorno a dove sei' : 'I distributori intorno a dove sei'} onClick={onVicinoAMe} />
            {passati.length > 0 && <h2 className="px-3 pt-4 pb-1 text-xs font-bold tracking-wider text-muted-foreground uppercase">Ricerche recenti</h2>}
            {passati.map((r, i) =>
              r.tipo === 'luogo' ? (
                <Riga key={i} icona={<Clock className="size-5" />} titolo={r.luogo.nome} dettaglio={r.luogo.dettaglio} onClick={() => scegliLuogo(r.luogo)} />
              ) : (
                <Riga key={i} icona={<Clock className="size-5" />} titolo={r.trovato.punto.nome} dettaglio={dove(r.trovato)} onClick={() => scegliDistributore(r.trovato)} />
              ),
            )}
            <p className="px-3 pt-5 text-sm text-muted-foreground">
              {negozi
                ? 'Prova con un comune («Pozzuoli»), un indirizzo («via Toledo 256 Napoli») o un prodotto e un posto («latte Vomero»).'
                : 'Prova con un comune («Pozzuoli»), un indirizzo («via Toledo 256 Napoli») o un marchio e un posto («Eni Salerno»).'}
            </p>
          </>
        )}

        {errore && <p className="px-3 py-4 text-sm">{errore}</p>}
        {vuoto && !caricamento && (
          <p className="px-3 py-4 text-sm text-muted-foreground">Nessun risultato per «{q}». Prova con il nome del comune o della via.</p>
        )}

        {!!risultati?.luoghi.length && (
          <>
            <h2 className="px-3 pt-2 pb-1 text-xs font-bold tracking-wider text-muted-foreground uppercase">Luoghi</h2>
            {risultati.luoghi.map((l, i) => (
              <Riga
                key={i}
                icona={l.distributori != null && tipoRisultati === 'distributore' ? <Building2 className="size-5" /> : <MapPin className="size-5" />}
                titolo={l.nome}
                dettaglio={[l.dettaglio, l.distributori != null && tipoRisultati === 'distributore' && `${l.distributori} ${l.distributori === 1 ? 'distributore' : 'distributori'}`].filter(Boolean).join(' · ')}
                onClick={() => scegliLuogo(l)}
              />
            ))}
          </>
        )}

        {!!risultati?.distributori.length && (
          <>
            <h2 className="px-3 pt-3 pb-1 text-xs font-bold tracking-wider text-muted-foreground uppercase">{tipoRisultati === 'negozio' ? 'Negozi' : 'Distributori'}</h2>
            {risultati.distributori.map((t) => (
              <Riga key={t.punto.id} icona={tipoRisultati === 'negozio' ? <ShoppingCart className="size-5" /> : <Fuel className="size-5" />} titolo={t.punto.nome} dettaglio={dove(t)} onClick={() => scegliDistributore(t)}>
                <StatoBreve trovato={t} />
              </Riga>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

const dove = (t: Trovato) => [t.punto.indirizzo, t.punto.comune, formatoDistanza(t.metri)].filter(Boolean).join(' · ')

// Lo stato dei carburanti con notizie, già nei risultati: si vede prima ancora di aprire la scheda.
function StatoBreve({ trovato }: { trovato: Trovato }) {
  const noti = trovato.stato?.prodotti.filter((p) => p.affidabilita !== 'incerto') ?? []
  if (!noti.length) return null
  return (
    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
      {noti.map((p) => (
        <span key={p.prodotto} className="flex items-center gap-1">
          <SimboloStato colore={COLORE_STATO[p.stato]} /> {NOME_PRODOTTO[p.prodotto]}
        </span>
      ))}
    </span>
  )
}

function Riga({ icona, titolo, dettaglio, onClick, children }: {
  icona: React.ReactNode
  titolo: string
  dettaglio?: string | null
  onClick: () => void
  children?: React.ReactNode
}) {
  return (
    <button className={cn('flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-muted active:bg-muted')} onClick={onClick}>
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">{icona}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{titolo}</span>
        {dettaglio && <span className="block truncate text-[13px] text-muted-foreground">{dettaglio}</span>}
        {children}
      </span>
    </button>
  )
}
