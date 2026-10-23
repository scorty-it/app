import { useEffect, useState } from 'react'
import { caricaCanaliAvvisi, type CanaleAvvisi } from './dati.ts'
import { Pagina } from './Pagine.tsx'
import { REGIONI } from './province.ts'

// Per enti e redazioni: dove arrivano gli avvisi quando una provincia peggiora (api/src/avvisi.ts). Scorty non raccoglie
// niente: ci si iscrive su Telegram o nel proprio lettore di feed.
export function PaginaAvvisi() {
  const [canali, setCanali] = useState<CanaleAvvisi[] | null>(null)
  useEffect(() => void caricaCanaliAvvisi().then(setCanali, () => setCanali([])), [])

  return (
    <Pagina titolo="Avvisi per enti e redazioni">
      <p>
        Quando in una provincia aumentano i comuni senza carburante confermati, cioè con almeno due persone d’accordo, Scorty scrive un
        avviso nel canale Telegram della regione e nel feed RSS della provincia. Un altro messaggio arriva quando la situazione torna a
        migliorare. Al massimo un avviso ogni 6 ore per provincia; di notte, dalle 23 alle 7, i messaggi arrivano senza suono.
      </p>

      <h2>Canali Telegram</h2>
      {canali === null ? (
        <p className="text-muted-foreground">Caricamento…</p>
      ) : canali.length ? (
        <ul className="space-y-1">
          {canali.map((c) => (
            <li key={c.regione}>
              <a href={c.link} target="_blank" rel="noopener">{c.regione}</a> <span className="text-muted-foreground">{c.canale}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>I canali non sono ancora attivi: intanto c’è il feed di ogni provincia, qui sotto.</p>
      )}

      <h2>Feed RSS per provincia</h2>
      <p className="text-sm text-muted-foreground">
        Da aggiungere a un lettore di feed, oppure da collegare a Slack, Teams o all’email della redazione. Contiene gli avvisi degli
        ultimi 30 giorni.
      </p>
      {REGIONI.map(([regione, province]) => (
        <section key={regione}>
          <h3 className="font-bold">{regione}</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(province).map(([sigla, nome]) => (
              <li key={sigla}>
                <a href={`/api/province/${sigla}/avvisi.rss`}>{nome}</a>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="text-sm text-muted-foreground">
        Scorty non sa chi segue i canali o i feed. Su Telegram valgono le regole di Telegram.
      </p>
    </Pagina>
  )
}
