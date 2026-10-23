import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { navigate } from 'wouter/use-browser-location'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { affollato, alternative, quando, tempoFa, testoPersone } from './aspetto.ts'
import { CiVado } from './CiVado.tsx'
import { Correzione } from './Correzione.tsx'
import { apriScheda, inviaVisita } from './dati.ts'
import { DISTANZA_MAX, RAGGIO_SEGNALAZIONE, chiediPosizione, distanza, formatoDistanza } from './posizione.ts'
import {
  AggiornaPosizione, Intestazione, Notizie, PillolaStato, SceltaQuando, modoDi, type Props, type Quando,
} from './SchedaPunto.tsx'
import {
  BENI, NOME_CODA, NOME_PRODOTTO, nomeInFrase, nomeStato,
  type Bene, type LivelloCoda, type Punto, type Stato,
} from './tipi.ts'
import { corpoVisita } from './visita.ts'

// I tre pulsanti di ogni categoria: «No» è lo stato «esaurito», che nella pillola si legge «Finito».
const RISPOSTE: { stato: Stato; etichetta: string }[] = [
  { stato: 'disponibile', etichetta: '✓ C’è' },
  { stato: 'scarso', etichetta: '– Poco' },
  { stato: 'esaurito', etichetta: '✕ No' },
]

// Le tre risposte si riconoscono prima ancora di toccarle: il colore dello stato è accennato nel testo e nel bordo, e
// diventa pieno quando lo scegli. Pieni con le tonalità 700, le sole che con il testo bianco restano leggibili.
// Anche sotto il mouse (hover, normale e scuro) resta il colore della risposta, non il grigio del pulsante «outline».
const ACCENNO: Record<Stato, string> = {
  disponibile: 'border-green-600/40 text-green-800 hover:bg-green-600/10 hover:text-green-800 dark:border-green-400/40 dark:text-green-300 dark:hover:bg-green-400/10 dark:hover:text-green-300',
  scarso: 'border-amber-600/40 text-amber-800 hover:bg-amber-600/10 hover:text-amber-800 dark:border-amber-400/40 dark:text-amber-300 dark:hover:bg-amber-400/10 dark:hover:text-amber-300',
  esaurito: 'border-red-600/40 text-red-800 hover:bg-red-600/10 hover:text-red-800 dark:border-red-400/40 dark:text-red-300 dark:hover:bg-red-400/10 dark:hover:text-red-300',
}
const SCELTA: Record<Stato, string> = {
  disponibile: 'border-transparent bg-green-700 text-white hover:bg-green-700 hover:text-white dark:bg-green-700 dark:hover:bg-green-700',
  scarso: 'border-transparent bg-amber-700 text-white hover:bg-amber-700 hover:text-white dark:bg-amber-700 dark:hover:bg-amber-700',
  esaurito: 'border-transparent bg-red-700 text-white hover:bg-red-700 hover:text-white dark:bg-red-700 dark:hover:bg-red-700',
}

export function SchedaNegozio({ punto, punti, stati, filtro, posizione, onPosizione, onSeleziona, suModulo }: Props & { punto: Punto }) {
  const [scelte, setScelte] = useState<Partial<Record<Bene, Stato>>>({})
  const [coda, setCoda] = useState<LivelloCoda | null>(null)
  const [quandoVisto, setQuandoVisto] = useState<Quando>(15)
  const [occupato, setOccupato] = useState(false)
  // Con le categorie la visita si completa da «Le tue segnalazioni»; la sola coda non vi compare.
  const [inviata, setInviata] = useState<false | 'categorie' | 'coda'>(false)
  const [correzione, setCorrezione] = useState(false)

  useEffect(() => void apriScheda(punto.id), [punto.id])
  const modulo = useRef<HTMLElement>(null)
  useEffect(() => void (suModulo && modulo.current?.scrollIntoView({ block: 'start' })), [suModulo, punto.id])

  const stato = stati.get(punto.id)
  const righe = new Map(stato?.prodotti.map((p) => [p.prodotto, p]))
  const metri = posizione ? distanza(posizione, punto) : null
  const modo = modoDi(metri)
  const beni = BENI.filter((b) => punto.prodotti.includes(b)).sort((a, b) => +(b === filtro) - +(a === filtro))
  const finiti = beni.filter((b) => righe.get(b)?.stato === 'esaurito')
  const prodottoAlt = filtro && beni.some((b) => b === filtro) ? filtro : (finiti[0] ?? null)
  const alt = affollato(stato) || finiti.length ? alternative(punto, prodottoAlt, punti, stati) : []

  // A distanza il server rifiuta la coda: il modulo non la chiede.
  const corpo = corpoVisita(scelte, modo === 'posto' ? coda : null)
  const numero = Object.keys(scelte).length + (modo === 'posto' && coda ? 1 : 0)

  const scegli = (b: Bene, s: Stato) =>
    setScelte((x) => {
      const { [b]: attuale, ...resto } = x
      return attuale === s ? resto : { ...resto, [b]: s } // un secondo tocco toglie la scelta
    })

  // Il server ricontrolla le distanze: qui servono solo a non far partire richieste che verrebbero rifiutate.
  async function invia() {
    if (!corpo) return
    setOccupato(true)
    try {
      const pos = await chiediPosizione()
      onPosizione(pos)
      const m = distanza(pos, punto)
      if (m > DISTANZA_MAX) throw new Error(`Sei a ${formatoDistanza(m)}: si segnala solo entro ${DISTANZA_MAX / 1000} km.`)
      const aDistanza = m > RAGGIO_SEGNALAZIONE
      if (aDistanza && modo === 'posto') {
        // La posizione è cambiata: la scheda passa da sola alla modalità a distanza, che non chiede la coda.
        return void toast(`Sei a ${formatoDistanza(m)}`, { description: 'Se ci sei passato da poco, indica quando l’hai visto.' })
      }
      await inviaVisita(punto.id, corpo, pos, aDistanza ? quandoVisto : 0)
      setInviata(corpo.risposte.length ? 'categorie' : 'coda')
      setScelte({})
      setCoda(null)
      if (corpo.risposte.length) {
        toast.success('Grazie! La tua visita è visibile a tutti.', {
          description: 'Hai dimenticato qualcosa? Per un’ora puoi completarla.',
          action: { label: 'Le tue segnalazioni', onClick: () => navigate('/mie') },
        })
      } else toast.success('Grazie! La coda è visibile a tutti.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOccupato(false)
    }
  }

  return (
    <div className="overflow-y-auto overscroll-contain px-5 pt-2 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
      <Intestazione punto={punto} metri={metri} />

      <div className="space-y-3">
        <Notizie stato={stato} />
        {modo !== 'troppo' && <CiVado punto={punto} stato={stato} onPosizione={onPosizione} />}

        {modo === 'troppo' && (
          <div className="rounded-2xl bg-muted p-3.5 text-sm">
            Sei a {formatoDistanza(metri!)}: puoi consultare, ma si segnala solo entro {DISTANZA_MAX / 1000} km. <AggiornaPosizione onPosizione={onPosizione} />
          </div>
        )}
        {metri == null && (
          <p className="text-sm text-muted-foreground">
            Sei qui? Per segnalare ti chiederemo la posizione: serve solo a verificare quanto sei vicino, non la salviamo.
          </p>
        )}

        <ul className="divide-y rounded-2xl border">
          {beni.map((b) => {
            const riga = righe.get(b)
            return (
              <li key={b} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold">{NOME_PRODOTTO[b]}</h3>
                  {riga
                    ? <PillolaStato stato={riga.stato} incerto={riga.affidabilita === 'incerto'} mondo="spesa" />
                    : <span className="text-sm text-muted-foreground">Nessun dato recente</span>}
                </div>
                {riga && (
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {testoPersone(riga)} · {riga.a_distanza && 'visto '}{quando(riga.ultimo)}
                  </p>
                )}
                {stato?.stima.potrebbe_finire.includes(b) && (
                  <p className="mt-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-[13px] text-blue-950 dark:bg-blue-500/15 dark:text-blue-100">
                    <strong className="font-semibold">Potrebbe finire</strong> · stima: {stato.arrivi_per[b] === 1 ? '1 persona ci sta andando' : `${stato.arrivi_per[b]} persone ci stanno andando`}
                  </p>
                )}
              </li>
            )
          })}
        </ul>

        {alt.length > 0 && (
          <section>
            <h3 className="font-bold">{prodottoAlt ? `Altri negozi con ${nomeInFrase(prodottoAlt)}` : 'Altri negozi con scorte'}</h3>
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
                    <PillolaStato stato={a.stato.stato} mondo="spesa" />
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {modo === 'distanza' && (
          <section className="space-y-3 rounded-2xl bg-muted p-4 text-sm">
            <div>
              <h3 className="text-base font-bold">Ci sei passato da poco?</h3>
              <p className="mt-0.5 text-muted-foreground">
                Sei a {formatoDistanza(metri!)}. Indica quando l’hai visto e com’era: a distanza la segnalazione conta la metà finché
                qualcuno sul posto non dice lo stesso. <AggiornaPosizione onPosizione={onPosizione} />
              </p>
            </div>
            <SceltaQuando valore={quandoVisto} onCambia={setQuandoVisto} />
          </section>
        )}

        {modo !== 'troppo' && (
          <section ref={modulo} className="scroll-mt-2 rounded-2xl border p-4">
            <h3 className="font-bold">Com’è lo scaffale?</h3>
            {inviata ? (
              <p className="mt-1 text-sm text-muted-foreground">Grazie, visita registrata.{inviata === 'categorie' && ' Per un’ora puoi completarla da «Le tue segnalazioni».'}</p>
            ) : (
              <>
                <p className="text-[13px] text-muted-foreground">Tocca solo le categorie che hai guardato.</p>
                {/* Ogni categoria nel suo riquadro: le righe di pulsanti non si confondono tra loro. */}
                <ul className="mt-3 space-y-2">
                  {beni.map((b) => (
                    <li key={b} className="rounded-xl bg-muted/60 px-3 py-2.5">
                      <p className="text-sm font-semibold">{NOME_PRODOTTO[b]}</p>
                      <div role="group" aria-label={NOME_PRODOTTO[b]} className="mt-1.5 grid grid-cols-3 gap-2">
                        {RISPOSTE.map(({ stato: s, etichetta }) => (
                          <Button
                            key={s}
                            variant="outline"
                            aria-pressed={scelte[b] === s}
                            aria-label={`${NOME_PRODOTTO[b]}: ${nomeStato(s, 'spesa')}`}
                            className={cn('h-12 rounded-full text-sm font-semibold', scelte[b] === s ? SCELTA[s] : ACCENNO[s])}
                            disabled={occupato}
                            onClick={() => scegli(b, s)}
                          >
                            {etichetta}
                          </Button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>

                {modo === 'posto' && (
                  <div className="mt-3 border-t pt-3">
                    <p className="text-sm font-semibold">C’è coda all’ingresso?</p>
                    <div className="mt-1.5 grid grid-cols-3 gap-2">
                      {(['nessuna', 'breve', 'lunga'] as const).map((l) => (
                        <Button
                          key={l}
                          variant="outline"
                          aria-pressed={coda === l}
                          className={cn('h-12 rounded-full text-sm font-semibold', coda === l && 'border-primary bg-primary text-primary-foreground hover:bg-primary')}
                          disabled={occupato}
                          onClick={() => setCoda(coda === l ? null : l)}
                        >
                          {NOME_CODA[l]}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <Button className="mt-4 h-12 w-full rounded-full text-base font-semibold" disabled={occupato || !corpo} onClick={invia}>
                  Invia{numero > 0 && ` (${numero})`}
                </Button>
                <p className="mt-2 text-center text-[13px] text-muted-foreground">Conta come una sola visita.</p>
              </>
            )}
          </section>
        )}

        <p className="rounded-2xl bg-muted p-3.5 text-sm">
          Se non ti serve subito, aspetta: i rifornimenti arrivano a ondate e così i negozi restano forniti per tutti.
        </p>
        <Button variant="link" className="h-11 px-0 font-semibold text-muted-foreground" onClick={() => setCorrezione(true)}>
          Segnala un errore · Sei il gestore?
        </Button>
      </div>

      <Correzione punto={punto} aperto={correzione} onChiudi={() => setCorrezione(false)} />
    </div>
  )
}
