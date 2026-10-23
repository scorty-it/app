import { Car, Check, ChevronRight, Eye, Footprints, Navigation, RefreshCw, TrendingUp, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { navigate } from 'wouter/use-browser-location'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import {
  COLORE_STATO, PILLOLA, type Colore, affollato, alternative, quando, tempoFa, testoPersone,
} from './aspetto.ts'
import { CiVado } from './CiVado.tsx'
import { SimboloStato } from './SimboloStato.tsx'
import { Correzione } from './Correzione.tsx'
import { SchedaNegozio } from './SchedaNegozio.tsx'
import { apriScheda, caricaPrezzi, segnala, segnalaCoda, vota, type Prezzo } from './dati.ts'
import { DISTANZA_MAX, RAGGIO_SEGNALAZIONE, chiediPosizione, distanza, formatoDistanza } from './posizione.ts'
import { useSchermoLargo } from './schermo.ts'
import {
  NOME_CODA, NOME_PRODOTTO, NOME_STATO, mondoDi, nomeInFrase, nomeStato,
  type LivelloCoda, type Mondo, type Posizione, type Prodotto, type Punto, type Stato, type StatoProdotto, type StatoPunto,
} from './tipi.ts'

export interface Props {
  punto: Punto | null
  punti: Punto[]
  stati: Map<number, StatoPunto>
  filtro: Prodotto | null
  posizione: Posizione | null
  onPosizione: (p: Posizione) => void
  onSeleziona: (p: Punto) => void
  onChiudi: () => void
  suModulo?: boolean // aperta dall'invito all'arrivo: il negozio porta subito a «Com'è lo scaffale?»
}

export function SchedaPunto(props: Props) {
  // Tiene l'ultimo punto mentre la scheda si chiude, così il contenuto non sparisce durante l'animazione.
  const ultimo = useRef(props.punto)
  if (props.punto) ultimo.current = props.punto
  const punto = ultimo.current

  // Sul telefono la scheda sale dal basso; sul computer è un pannello a sinistra, alto quanto lo schermo, e la mappa
  // accanto resta usabile (niente velo): si può toccare un altro distributore senza chiuderla.
  const largo = useSchermoLargo()
  return (
    <Drawer
      open={!!props.punto}
      onOpenChange={(aperto) => !aperto && props.onChiudi()}
      showSwipeHandle={!largo}
      swipeDirection={largo ? 'left' : 'down'}
      modal={!largo}
    >
      <DrawerContent
        className={cn(
          // Staccato dai bordi: niente fascia di colore verso il bordo dello schermo (after), che serve solo ai pannelli attaccati.
          largo && 'shadow-float [--drawer-inset:1rem] after:hidden data-[swipe-axis=x]:sm:[--drawer-content-width:440px] data-[swipe-direction=left]:rounded-3xl data-[swipe-direction=left]:border',
        )}
      >
        {largo && (
          <div className="flex justify-end px-3 pt-3">
            <DrawerClose aria-label="Chiudi la scheda" className="flex size-9 items-center justify-center rounded-full bg-muted transition-colors hover:bg-muted/70">
              <X className="size-4" />
            </DrawerClose>
          </div>
        )}
        {punto && (punto.tipo === 'negozio'
          ? <SchedaNegozio key={punto.id} {...props} punto={punto} />
          : <Contenuto key={punto.id} {...props} punto={punto} />)}
      </DrawerContent>
    </Drawer>
  )
}

type Esito = 'confermato' | 'smentito' | 'segnalato'
// Sul posto si fa tutto; a distanza solo segnalare com'era; troppo lontano si consulta e basta.
export type Modo = 'posto' | 'distanza' | 'troppo'

export const modoDi = (metri: number | null): Modo =>
  metri == null || metri <= RAGGIO_SEGNALAZIONE ? 'posto' : metri <= DISTANZA_MAX ? 'distanza' : 'troppo'

export const QUANDO = { 15: '15 min fa', 30: '30 min fa', 60: '1 ora fa', 120: '2 ore fa' } as const
export type Quando = keyof typeof QUANDO

function Contenuto({ punto, punti, stati, filtro, posizione, onPosizione, onSeleziona }: Props & { punto: Punto }) {
  const [esiti, setEsiti] = useState<Partial<Record<Prodotto | 'coda', Esito>>>({})
  const [segnalati, setSegnalati] = useState<Partial<Record<Prodotto, Stato>>>({})
  const [occupato, setOccupato] = useState(false)
  const [correzione, setCorrezione] = useState(false)
  const [quando, setQuando] = useState<Quando>(15)

  useEffect(() => void apriScheda(punto.id), [punto.id])
  const [prezzi, setPrezzi] = useState<{ prezzi: Prezzo[]; comunicati_il: string | null } | null>(null)
  useEffect(() => void caricaPrezzi(punto.id).then(setPrezzi, () => {}), [punto.id])
  const giorniPrezzi = prezzi?.comunicati_il ? Math.floor((Date.now() - Date.parse(prezzi.comunicati_il)) / 86_400_000) : null

  const stato = stati.get(punto.id)
  const righe = new Map(stato?.prodotti.map((p) => [p.prodotto, p]))
  const metri = posizione ? distanza(posizione, punto) : null
  const modo = modoDi(metri)
  const prodotti = [...punto.prodotti].sort((a, b) => +(b === filtro) - +(a === filtro))
  const finiti = prodotti.filter((p) => righe.get(p)?.stato === 'esaurito')
  const prodottoAlt = filtro && punto.prodotti.includes(filtro) ? filtro : (finiti[0] ?? null)
  const alt = affollato(stato) || finiti.length ? alternative(punto, prodottoAlt, punti, stati) : []

  // Il server ricontrolla le distanze: qui servono solo a non far partire richieste che verrebbero rifiutate.
  async function agisci(chiave: Prodotto | 'coda', esito: Esito, azione: (pos: Posizione) => Promise<unknown>, grazie: string, aDistanza = false) {
    setOccupato(true)
    try {
      const pos = await chiediPosizione()
      onPosizione(pos)
      const m = distanza(pos, punto)
      if (m > (aDistanza ? DISTANZA_MAX : RAGGIO_SEGNALAZIONE)) {
        if (!aDistanza && m <= DISTANZA_MAX) {
          // La scheda passa da sola alla modalità a distanza
          return void toast(`Sei a ${formatoDistanza(m)}`, { description: 'Se ci sei passato da poco, indica quando l’hai visto.' })
        }
        throw new Error(`Sei a ${formatoDistanza(m)}: si segnala solo entro ${DISTANZA_MAX / 1000} km.`)
      }
      await azione(pos)
      setEsiti((e) => ({ ...e, [chiave]: esito }))
      toast.success(grazie, esito === 'segnalato'
        ? { description: 'Hai dimenticato qualcosa? Per un’ora puoi completarla.', action: { label: 'Le tue segnalazioni', onClick: () => navigate('/mie') } }
        : undefined)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOccupato(false)
    }
  }

  const segnalaStato = (prodotto: Prodotto, s: Stato) =>
    agisci(prodotto, 'segnalato', async (pos) => {
      await segnala(punto.id, prodotto, s, pos, modo === 'distanza' ? quando : 0)
      setSegnalati((x) => ({ ...x, [prodotto]: s }))
    }, 'Grazie! La tua segnalazione è visibile a tutti.', modo === 'distanza')
  const coda = (l: LivelloCoda) =>
    agisci('coda', 'segnalato', (pos) => segnalaCoda(punto.id, l, pos), 'Grazie, coda segnalata.')

  return (
    <div className="overflow-y-auto overscroll-contain px-5 pt-2 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
      <Intestazione punto={punto} metri={metri} />

      <div className="space-y-3">
        <Notizie stato={stato} />
        {modo !== 'troppo' && <CiVado punto={punto} stato={stato} onPosizione={onPosizione} />}

        {modo === 'troppo' && (
          <div className="rounded-2xl bg-muted p-3.5 text-sm">
            Sei a {formatoDistanza(metri!)}: puoi consultare, ma si segnala solo entro {DISTANZA_MAX / 1000} km.{' '}
            <AggiornaPosizione onPosizione={onPosizione} />
          </div>
        )}
        {modo === 'distanza' && (
          <section className="space-y-3 rounded-2xl bg-muted p-4 text-sm">
            <div>
              <h3 className="text-base font-bold">Ci sei passato da poco?</h3>
              <p className="mt-0.5 text-muted-foreground">
                Sei a {formatoDistanza(metri!)}. Indica quando l’hai visto e com’era: a distanza la segnalazione conta la metà finché qualcuno
                sul posto non la conferma. <AggiornaPosizione onPosizione={onPosizione} />
              </p>
            </div>
            <SceltaQuando valore={quando} onCambia={setQuando} />
            <p className="flex items-center gap-2 font-medium">
              <Car className="size-4 shrink-0" /> Non usare il telefono mentre guidi: segnala quando sei fermo.
            </p>
          </section>
        )}
        {metri == null && (
          <p className="text-sm text-muted-foreground">
            Sei qui? Per segnalare ti chiederemo la posizione: serve solo a verificare quanto sei vicino, non la salviamo.
          </p>
        )}

        {prodotti.map((p) => (
          <RigaProdotto
            key={p}
            prodotto={p}
            riga={righe.get(p)}
            esito={esiti[p]}
            segnalato={segnalati[p]}
            modo={modo}
            prezzi={prezzi?.prezzi.filter((x) => x.prodotto === p) ?? []}
            occupato={occupato}
            onConferma={(r) => agisci(p, 'confermato', (pos) => vota(r.segnalazione_id, true, pos), 'Grazie per la conferma.')}
            onSmentisci={(r) => agisci(p, 'smentito', (pos) => vota(r.segnalazione_id, false, pos), 'Grazie. Com’è adesso?')}
            onSegnala={(s) => segnalaStato(p, s)}
            onCoda={esiti.coda ? undefined : coda}
          />
        ))}

        {giorniPrezzi != null && (
          <p className={cn('text-[13px]', giorniPrezzi > 30 ? 'rounded-2xl bg-amber-50 p-3.5 text-amber-950 dark:bg-amber-500/15 dark:text-amber-100' : 'text-muted-foreground')}>
            {giorniPrezzi > 30
              ? `Prezzi non aggiornati da ${giorniPrezzi} giorni: il distributore potrebbe essere chiuso.`
              : `Prezzi comunicati al Ministero ${dataPrezzi(prezzi!.comunicati_il!)}.`}
          </p>
        )}

        {modo === 'posto' && (
          <section className="rounded-2xl border p-4">
            <h3 className="font-bold">C’è coda adesso?</h3>
            {esiti.coda ? (
              <p className="mt-1 text-sm text-muted-foreground">Grazie, coda segnalata.</p>
            ) : (
              <Scelte opzioni={['nessuna', 'breve', 'lunga'] as const} nomi={NOME_CODA} disabled={occupato} onScegli={coda} />
            )}
          </section>
        )}

        {alt.length > 0 && (
          <section>
            <h3 className="font-bold">{prodottoAlt ? `Altri distributori con ${nomeInFrase(prodottoAlt)}` : 'Altri distributori con carburante'}</h3>
            <p className="text-[13px] text-muted-foreground">Entro 10 km, i meno affollati per primi.</p>
            <ul className="mt-2.5 space-y-2">
              {alt.map((a) => (
                <li key={a.punto.id}>
                  <button className="flex min-h-16 w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors active:bg-muted" onClick={() => onSeleziona(a.punto)}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{a.punto.nome}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {!prodottoAlt && `${NOME_PRODOTTO[a.stato.prodotto]} · `}a {formatoDistanza(a.metri)} · {tempoFa(a.stato.ultimo)}
                      </span>
                    </span>
                    <PillolaStato stato={a.stato.stato} />
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="rounded-2xl bg-muted p-3.5 text-sm">
          Se non ti serve subito, aspetta: i rifornimenti arrivano a ondate e così il carburante basta per tutti.
        </p>
        <Button variant="link" className="h-11 px-0 font-semibold text-muted-foreground" onClick={() => setCorrezione(true)}>
          Segnala un errore · Sei il gestore?
        </Button>
      </div>

      <Correzione punto={punto} aperto={correzione} onChiudi={() => setCorrezione(false)} />
    </div>
  )
}

function RigaProdotto({ prodotto, riga, esito, segnalato, modo, prezzi, occupato, onConferma, onSmentisci, onSegnala, onCoda }: {
  prodotto: Prodotto
  riga: StatoProdotto | undefined
  esito: Esito | undefined
  segnalato: Stato | undefined
  modo: Modo
  prezzi: Prezzo[]
  occupato: boolean
  onConferma: (r: StatoProdotto) => void
  onSmentisci: (r: StatoProdotto) => void
  onSegnala: (s: Stato) => void
  onCoda?: (l: LivelloCoda) => void
}) {
  const incerto = riga?.affidabilita === 'incerto'
  // A distanza si dice solo com'era: confermare e smentire valgono sul posto.
  const chiediStato = !riga || incerto || riga.mia || esito === 'smentito' || modo === 'distanza'

  let azioni = null
  if (esito === 'segnalato' && segnalato !== 'esaurito' && onCoda && modo === 'posto') {
    azioni = (
      <>
        <p className="mt-3 text-sm font-semibold">Grazie! C’è coda?</p>
        <Scelte opzioni={['nessuna', 'breve', 'lunga'] as const} nomi={NOME_CODA} disabled={occupato} onScegli={onCoda} />
      </>
    )
  } else if (esito === 'segnalato' || esito === 'confermato') {
    azioni = <p className="mt-2 text-sm text-muted-foreground">Grazie, registrato.</p>
  } else if (chiediStato) {
    azioni = (
      <>
        <p className="mt-3 text-sm font-semibold">
          {modo === 'distanza' ? 'Com’era?' : riga?.mia ? 'È la tua segnalazione. È cambiato qualcosa?' : 'Com’è adesso?'}
        </p>
        <Scelte opzioni={['disponibile', 'scarso', 'esaurito'] as const} nomi={NOME_STATO} colori disabled={occupato} onScegli={onSegnala} />
      </>
    )
  } else {
    azioni = (
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11 rounded-full text-sm font-semibold" disabled={occupato} onClick={() => onConferma(riga)}>
          <Check /> Confermo
        </Button>
        <Button variant="outline" className="h-11 rounded-full text-sm font-semibold" disabled={occupato} onClick={() => onSmentisci(riga)}>
          <X /> Non è vero
        </Button>
      </div>
    )
  }

  return (
    <section className="rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold">{NOME_PRODOTTO[prodotto]}</h3>
        {riga ? <PillolaStato stato={riga.stato} incerto={incerto} /> : <span className="text-sm text-muted-foreground">Nessun dato recente</span>}
      </div>
      {riga && (
        <p className="mt-1 text-[13px] text-muted-foreground">
          {testoPersone(riga)} · {riga.a_distanza && 'visto '}{quando(riga.ultimo)}
        </p>
      )}
      {prezzi.length > 0 && (
        <p className="mt-1 text-[13px] font-medium tabular-nums">
          {prezzi.length === 2 && prezzi[0].prezzo === prezzi[1].prezzo
            ? `${euro(prezzi[0].prezzo)} €/l self e servito`
            : prezzi.map((x) => `${euro(x.prezzo)} €/l ${x.self ? 'self' : 'servito'}`).join(' · ')}
        </p>
      )}
      {riga?.rifornito && (
        <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-green-700 dark:text-green-400">
          <RefreshCw className="size-3.5" /> Rifornito di recente
        </p>
      )}
      {modo !== 'troppo' && azioni}
    </section>
  )
}

// Nome, indirizzo e distanza: uguali per distributori e negozi.
export function Intestazione({ punto, metri }: { punto: Punto; metri: number | null }) {
  return (
    <div className="pb-4">
      {punto.marchio && <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{punto.marchio}</p>}
      <DrawerTitle className="text-[22px] leading-tight font-bold tracking-tight">{punto.nome}</DrawerTitle>
      <DrawerDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        {[punto.indirizzo, punto.comune].filter(Boolean).join(', ')}
        {metri != null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
            <Navigation className="size-3 fill-current" /> {formatoDistanza(metri)} da te
          </span>
        )}
      </DrawerDescription>
    </div>
  )
}

// Coda segnalata, stima delle persone in arrivo e schede aperte. Il blu vale «persone e stime»: mai verde, giallo o rosso.
export function Notizie({ stato }: { stato: StatoPunto | undefined }) {
  if (!stato || !(stato.coda || stato.interesse > 0 || stato.arrivi > 0 || stato.stima.coda_in_aumento)) return null
  const { arrivi, interesse } = stato
  const personeArrivi = `${arrivi === 1 ? '1 persona ha detto' : `${arrivi} persone hanno detto`} «Ci vado» nell’ultima ora`
  const basi = [
    arrivi > 0 && personeArrivi,
    interesse > 0 && `${interesse === 1 ? '1 scheda aperta' : `${interesse} schede aperte`} negli ultimi 30 min`,
  ].filter(Boolean)
  return (
    <div className={cn('space-y-1.5 rounded-2xl p-3.5 text-sm', affollato(stato) ? 'bg-blue-50 text-blue-950 dark:bg-blue-500/15 dark:text-blue-100' : 'bg-muted')}>
      {stato.coda && (
        <p className="flex gap-2">
          <Users className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">{stato.coda.livello === 'nessuna' ? 'Nessuna coda' : `Coda ${stato.coda.livello}`}</strong>
            {' · '}segnalata da {stato.coda.persone === 1 ? '1 persona' : `${stato.coda.persone} persone`} · {tempoFa(stato.coda.ultimo)}
          </span>
        </p>
      )}
      {stato.stima.coda_in_aumento && (
        <p className="flex gap-2">
          <TrendingUp className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">Coda in aumento</strong> · stima: {basi.join(' · ')}
          </span>
        </p>
      )}
      {arrivi > 0 && !stato.stima.coda_in_aumento && (
        <p className="flex gap-2 rounded-xl bg-blue-50 px-3 py-1.5 text-blue-950 dark:bg-blue-500/15 dark:text-blue-100">
          <Footprints className="mt-0.5 size-4 shrink-0" />
          <span>{personeArrivi}</span>
        </p>
      )}
      {interesse > 0 && !stato.stima.coda_in_aumento && (
        <p className="flex gap-2">
          <Eye className="mt-0.5 size-4 shrink-0" />
          <span>{interesse === 1 ? '1 persona l’ha guardato' : `${interesse} persone l’hanno guardato`} negli ultimi 30 min</span>
        </p>
      )}
    </div>
  )
}

// «Quando l'hai visto?» per chi segnala a distanza.
export function SceltaQuando({ valore, onCambia }: { valore: Quando; onCambia: (q: Quando) => void }) {
  return (
    <div role="group" aria-label="Quando l’hai visto?" className="grid grid-cols-4 gap-1 rounded-full bg-card p-1">
      {(Object.keys(QUANDO).map(Number) as Quando[]).map((q) => (
        <button
          key={q}
          aria-pressed={valore === q}
          onClick={() => onCambia(q)}
          className={cn('h-9 rounded-full text-[13px] font-semibold', valore === q ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
        >
          {QUANDO[q]}
        </button>
      ))}
    </div>
  )
}

export { SimboloStato }

export function PillolaStato({ stato, incerto = false, mondo = 'carburante' }: { stato: Stato; incerto?: boolean; mondo?: Mondo }) {
  const colore = incerto ? 'grigio' : COLORE_STATO[stato]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-sm font-semibold', PILLOLA[colore])}>
      <SimboloStato colore={colore} />
      {incerto ? 'Incerto' : nomeStato(stato, mondo)}
    </span>
  )
}

function Scelte<T extends string>({ opzioni, nomi, colori = false, disabled, onScegli }: {
  opzioni: readonly T[]
  nomi: Record<T, string>
  colori?: boolean
  disabled: boolean
  onScegli: (v: T) => void
}) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {opzioni.map((o) => {
        const colore = colori ? COLORE_STATO[o as Stato] : null
        return (
          <Button
            key={o}
            variant="outline"
            className={cn('h-12 rounded-full text-sm font-semibold', colore && cn(PILLOLA[colore], 'border-transparent'))}
            disabled={disabled}
            onClick={() => onScegli(o)}
          >
            {colore && <SimboloStato colore={colore} />}
            {nomi[o]}
          </Button>
        )
      })}
    </div>
  )
}

export function AggiornaPosizione({ onPosizione }: { onPosizione: (p: Posizione) => void }) {
  return (
    <button className="font-semibold text-foreground underline underline-offset-2" onClick={() => chiediPosizione().then(onPosizione, (e) => toast.error(e.message))}>
      Aggiorna posizione
    </button>
  )
}

const euro = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

// "oggi alle 7:30", "ieri alle 18:02", "il 15 ottobre"
function dataPrezzi(iso: string) {
  const d = new Date(iso)
  const giorni = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000)
  const ora = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  if (giorni === 0) return `oggi alle ${ora}`
  if (giorni === 1) return `ieri alle ${ora}`
  return `il ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}`
}
