// Il widget per i siti di testate ed enti: il riepilogo di una provincia dentro un iframe (/widget/province/XX).
// Pagina a parte, senza mappa: pesa poco e si carica in fretta dentro un articolo. Solo lettura, niente pulsanti che
// cambiano qualcosa; colori sempre chiari come immagine e PDF del bollettino; niente identificativi né cookie.
import { Fragment, StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/figtree'
import './index.css'
import { comuniSenzaBeni, conNotizie, fraseVuota, fraseVuotaSpesa, gruppo, indirizzoBollettino, momento, primi } from './bollettino.ts'
import type { BollettinoProvincia } from './dati.ts'
import { Andamento } from './GraficoAndamento.tsx'
import { dominioDi, siglaDelWidget } from './incorpora.ts'
import { nomeProvincia, provinciaNota } from './province.ts'
import { NOMI_PER_BENE, passoAdattamento, righeIniziali, type Righe } from './righe-widget.ts'
import { SimboloStato } from './SimboloStato.tsx'
import { NOME_PRODOTTO } from './tipi.ts'

const AGGIORNA = 5 * 60_000 // chi tiene aperto l'articolo vede i numeri nuovi; il server ricalcola al massimo ogni minuto
const COMUNI = 8 // quanti comuni senza carburante entrano nelle due misure del codice da incollare (incorpora.ts)
const COLORI = ['verde', 'giallo', 'rosso'] as const

// Si conta quante volte si apre, per sito: solo dentro un iframe di un altro sito (l'anteprima di «Incorpora» no).
function contaApertura() {
  const sito = dominioDi(document.referrer)
  if (window.top === window.self || sito === location.hostname) return
  fetch('/api/widget/aperto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sito }), keepalive: true })
    .catch(() => {})
}

// La misura dell'iframe e i font arrivati: cambiano ogni volta che le righe vanno contate da capo (il testo, arrivato il font, occupa altro spazio).
function useMisura() {
  const [misura, setMisura] = useState('')
  const [font, setFont] = useState(0)
  useEffect(() => {
    const aggiorna = () => setMisura(`${innerWidth}x${innerHeight}`)
    const arrivato = () => setFont((n) => n + 1)
    aggiorna()
    addEventListener('resize', aggiorna)
    document.fonts?.addEventListener('loadingdone', arrivato)
    document.fonts?.ready.then(arrivato)
    return () => {
      removeEventListener('resize', aggiorna)
      document.fonts?.removeEventListener('loadingdone', arrivato)
    }
  }, [])
  return `${misura}|${font}`
}

// I comuni senza carburante e, sotto, la spesa. L'altezza dell'iframe è fissa e non c'è barra di scorrimento: si misura la pagina
// vera (nomi lunghi, righe che vanno a capo, larghezza) e righe-widget.ts dice a ogni passo se aggiungere o togliere una riga.
// Quello che manca si riassume in «e altri N» e «+N beni».
function Elenchi({ b }: { b: BollettinoProvincia }) {
  const senza = gruppo(b, 'senza_carburante')
  const beni = b.spesa?.beni ?? []
  const vuotaSpesa = fraseVuotaSpesa(b)
  const massimi = { comuni: Math.min(COMUNI, senza.length), beni: vuotaSpesa ? 0 : beni.length }
  const [righe, setRighe] = useState<Righe>(() => righeIniziali(massimi))
  const zona = useRef<HTMLDivElement>(null)
  const carburante = useRef<HTMLElement>(null)
  const spesa = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const z = zona.current
    if (!z) return
    const aCapo = [...z.querySelectorAll<HTMLElement>('li[data-bene]')]
      .filter((li) => li.offsetHeight > 1.5 * parseFloat(getComputedStyle(li).lineHeight))
      .map((li) => li.dataset.bene!)
    const alti = { comuni: carburante.current?.offsetHeight ?? 0, beni: spesa.current?.offsetHeight ?? 0 }
    const prossimo = passoAdattamento(righe, massimi, { esce: z.scrollHeight - z.clientHeight > 1, alti, aCapo })
    if (prossimo) setRighe(prossimo)
  })
  const { mostrati, altri } = primi(senza, righe.comuni)
  const { mostrati: beniMostrati, altri: beniAltri } = primi(beni, righe.beni)
  return (
    <div ref={zona} className="min-h-0 flex-1 space-y-2.5 overflow-hidden">
      <section ref={carburante}>
        <h2 className="text-sm font-extrabold">Comuni senza carburante{senza.length > 0 && ` (${senza.length})`}</h2>
        {!senza.length && <p className="text-sm">{fraseVuota(b)}</p>}
        {/* Senza nemmeno un comune che ci sta, «e altri N» non direbbe niente più del numero nel titolo. */}
        {mostrati.length > 0 && (
          <ul className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 text-sm min-[420px]:grid-cols-2">
            {mostrati.map((c) => (
              <li key={c.comune} className="flex min-w-0 items-center gap-1.5">
                <SimboloStato colore="rosso" />
                <span className="min-w-0 font-semibold">{c.comune}</span>
                {!c.confermato && <span className="shrink-0 text-xs font-bold text-[#b45309]">da confermare</span>}
              </li>
            ))}
            {altri > 0 && <li className="text-muted-foreground">e altri {altri}</li>}
          </ul>
        )}
      </section>

      {b.spesa && (
        <section ref={spesa}>
          <h2 className="text-sm font-extrabold">Spesa{beni.length > 0 && !vuotaSpesa && `: comuni senza beni (${comuniSenzaBeni(b)})`}</h2>
          {vuotaSpesa ? (
            <>
              <p className="text-sm">{vuotaSpesa}</p>
              {b.spesa.con_notizie > 0 && <p className="text-sm text-muted-foreground">{b.spesa.con_notizie} su {b.spesa.negozi} negozi con notizie recenti</p>}
            </>
          ) : (
            <ul className="mt-1 space-y-0.5 text-sm">
              {beniMostrati.map((x) => {
                const { mostrati: nomi, altri: altriComuni } = primi(x.comuni, righe.nomi[x.bene] ?? NOMI_PER_BENE)
                return (
                  <li key={x.bene} data-bene={x.bene}>
                    <span className="font-semibold">{NOME_PRODOTTO[x.bene]}:</span>{' '}
                    {nomi.map((c, i) => (
                      <Fragment key={c.comune}>
                        {i > 0 && ', '}
                        <span className="whitespace-nowrap">{c.comune}</span>
                        {!c.confermato && <span className="text-xs font-bold text-[#b45309]"> (da confermare)</span>}
                      </Fragment>
                    ))}
                    {altriComuni > 0 && <span className="whitespace-nowrap"> +{altriComuni}</span>}
                  </li>
                )
              })}
              {beniAltri > 0 && <li className="text-muted-foreground">+{beniAltri} {beniAltri === 1 ? 'bene' : 'beni'}: vedi su scorty.it</li>}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function Widget({ sigla }: { sigla: string }) {
  const [b, setB] = useState<BollettinoProvincia | null>(null)
  const [errore, setErrore] = useState(false)
  useEffect(() => {
    const carica = () =>
      fetch(indirizzoBollettino(sigla, Date.now()))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((dati: BollettinoProvincia) => (setB(dati), setErrore(false)))
        .catch(() => setErrore(true))
    carica()
    const t = setInterval(carica, AGGIORNA)
    return () => clearInterval(t)
  }, [sigla])

  const nome = nomeProvincia(sigla)
  const link = `${location.origin}/province/${sigla}?da=widget`
  const quando = b && momento(b.aggiornato_il)
  // Gli elenchi si adattano all'altezza e alla larghezza dell'iframe: se cambiano (o arriva il font) si riparte da tutte le righe.
  const misura = useMisura()
  return (
    // Il bordo fa del widget un riquadro a sé, anche nella pagina bianca di un articolo.
    <main className="flex h-dvh flex-col gap-2.5 overflow-hidden rounded-2xl border border-[#e6e7eb] bg-white p-4 text-[#16181d]">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Un server vecchio non manda la spesa: il titolo non la promette. */}
          <h1 className="text-[17px] leading-tight font-extrabold">
            {b && !b.spesa ? `Carburante in provincia di ${nome}` : `Carburante e spesa, provincia di ${nome}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            {quando ? `${quando.giorno[0].toUpperCase()}${quando.giorno.slice(1)}, ore ${quando.ora}` : errore ? 'Dati non disponibili, riprovo tra poco' : 'Caricamento…'}
          </p>
        </div>
        <img src="/scorty-logo.png" alt="Scorty" width={822} height={280} className="h-6 w-auto shrink-0" />
      </header>

      {b && (
        <>
          <section>
            {conNotizie(b) > 0 && (
              <div className="flex gap-3 text-lg font-extrabold tabular-nums">
                {COLORI.map((c) => (
                  <span key={c} className="flex items-center gap-1">
                    <SimboloStato colore={c} /> {b[c]}
                  </span>
                ))}
              </div>
            )}
            <p className="text-sm text-muted-foreground">{conNotizie(b)} su {b.distributori} distributori con notizie recenti</p>
          </section>

          <Andamento b={b} compatto />

          <Elenchi key={`${b.aggiornato_il}|${misura}`} b={b} />
        </>
      )}

      <a href={link} target="_blank" rel="noopener" className="text-sm font-semibold">
        Situazione completa su scorty.it →
      </a>
    </main>
  )
}

const sigla = siglaDelWidget(location.pathname)
contaApertura()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {sigla && provinciaNota(sigla) ? (
      <Widget sigla={sigla} />
    ) : (
      <main className="p-4 text-sm">Provincia non trovata: l’indirizzo è /widget/province/ seguito dalla sigla, per esempio /widget/province/SA.</main>
    )}
  </StrictMode>,
)
