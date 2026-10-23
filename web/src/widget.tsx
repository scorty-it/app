// Il widget per i siti di testate ed enti: il riepilogo di una provincia dentro un iframe (/widget/province/XX).
// Pagina a parte, senza mappa: pesa poco e si carica in fretta dentro un articolo. Solo lettura, niente pulsanti che
// cambiano qualcosa; colori sempre chiari come immagine e PDF del bollettino; niente identificativi né cookie.
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/figtree'
import './index.css'
import { conNotizie, fraseVuota, gruppo, indirizzoBollettino, momento, primi } from './bollettino.ts'
import type { BollettinoProvincia } from './dati.ts'
import { Andamento } from './GraficoAndamento.tsx'
import { dominioDi, siglaDelWidget } from './incorpora.ts'
import { nomeProvincia, provinciaNota } from './province.ts'
import { SimboloStato } from './SimboloStato.tsx'

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
  const senza = b ? gruppo(b, 'senza_carburante') : []
  const { mostrati, altri } = primi(senza, COMUNI)
  const quando = b && momento(b.aggiornato_il)
  return (
    // Il bordo fa del widget un riquadro a sé, anche nella pagina bianca di un articolo.
    <main className="flex h-dvh flex-col gap-3 overflow-hidden rounded-2xl border border-[#e6e7eb] bg-white p-4 text-[#16181d]">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[17px] leading-tight font-extrabold">Carburante in provincia di {nome}</h1>
          <p className="text-sm text-muted-foreground">
            {quando ? `${quando.giorno[0].toUpperCase()}${quando.giorno.slice(1)}, ore ${quando.ora}` : errore ? 'Dati non disponibili, riprovo tra poco' : 'Caricamento…'}
          </p>
        </div>
        <img src="/scorty-logo.png" alt="Scorty" className="h-6 shrink-0" />
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

          <section className="min-h-0 flex-1 overflow-hidden">
            <h2 className="text-sm font-extrabold">Comuni senza carburante{senza.length > 0 && ` (${senza.length})`}</h2>
            {senza.length ? (
              <ul className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 text-sm min-[420px]:grid-cols-2">
                {mostrati.map((c) => (
                  <li key={c.comune} className="flex min-w-0 items-center gap-1.5">
                    <SimboloStato colore="rosso" />
                    <span className="truncate font-semibold">{c.comune}</span>
                    {!c.confermato && <span className="shrink-0 text-xs font-bold text-[#b45309]">da confermare</span>}
                  </li>
                ))}
                {altri > 0 && <li className="text-muted-foreground">e altri {altri}</li>}
              </ul>
            ) : (
              <p className="text-sm">{fraseVuota(b)}</p>
            )}
          </section>
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
