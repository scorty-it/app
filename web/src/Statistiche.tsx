import { useState } from 'react'
import { cn } from '@/lib/utils'
import { COLORE_STATO } from './aspetto.ts'
import { nomeProvincia } from './province.ts'
import { SimboloStato } from './SchedaPunto.tsx'
import { NOME_PRODOTTO, TUTTI_I_PRODOTTI, type Prodotto, type Stato } from './tipi.ts'

// Statistiche del pannello di moderazione: solo numeri aggregati per giorno, mai chi.

export interface Giorno {
  giorno: string // AAAA-MM-GG
  visite: number
  visite_app: number
  visitatori: number
  ricerche: number
  schede: number
  segnalazioni: number
  a_distanza: number
  conferme: number
  smentite: number
  code: number
  ci_vado: number
  nuovi_telefoni: number
}

export interface DatiStatistiche {
  collegati: number
  giorni: Giorno[]
  province: { provincia: string; segnalazioni: number }[]
  prodotti: { prodotto: Prodotto; stato: Stato; n: number }[]
  ore: number[]
  totali: { telefoni: number; segnalazioni: number; voti: number; visite: number }
  fonti: { fonte: string; visite: number }[]
  widget: { sito: string; aperture: number }[]
}

const data = (g: string) => new Date(`${g}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
const numero = (n: number) => n.toLocaleString('it-IT')

export function Statistiche({ dati }: { dati: DatiStatistiche }) {
  const oggi = dati.giorni[dati.giorni.length - 1]
  const somma = (k: keyof Giorno) => dati.giorni.reduce((t, g) => t + (g[k] as number), 0)

  return (
    <div className="space-y-5">
      <section>
        <h2>Oggi</h2>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
          <Riquadro n={dati.collegati} testo="con la mappa aperta adesso" />
          <Riquadro n={oggi.visitatori} testo="visitatori" />
          <Riquadro n={oggi.visite} testo={`visite, ${numero(oggi.visite_app)} dall’app`} />
          <Riquadro n={oggi.segnalazioni} testo={`segnalazioni, ${numero(oggi.a_distanza)} a distanza`} />
          <Riquadro n={oggi.conferme + oggi.smentite} testo="conferme e smentite" />
          <Riquadro n={oggi.ricerche} testo="ricerche" />
        </dl>
      </section>

      <section>
        <h2>Ultimi 30 giorni</h2>
        <p className="text-sm text-muted-foreground">
          {numero(somma('visite'))} visite · {numero(somma('segnalazioni'))} segnalazioni · {numero(somma('nuovi_telefoni'))} telefoni nuovi ·{' '}
          {numero(somma('schede'))} schede aperte
        </p>
        {/* Scale diverse: due grafici separati, non due assi sullo stesso */}
        <Barre titolo="Visitatori al giorno" valori={dati.giorni.map((g) => ({ etichetta: data(g.giorno), valore: g.visitatori }))} />
        <Barre titolo="Segnalazioni al giorno" valori={dati.giorni.map((g) => ({ etichetta: data(g.giorno), valore: g.segnalazioni }))} />
        <Barre titolo="«Ci vado» al giorno" valori={dati.giorni.map((g) => ({ etichetta: data(g.giorno), valore: g.ci_vado }))} />
      </section>

      <section>
        <h2>A che ora si segnala</h2>
        <Barre titolo="Segnalazioni per ora, ultimi 30 giorni" valori={dati.ore.map((n, h) => ({ etichetta: `${h}:00–${h + 1}:00`, valore: n }))} assi={['0', '6', '12', '18', '24']} />
      </section>

      {dati.province.length > 0 && (
        <section>
          <h2>Dove si segnala di più</h2>
          <Elenco voci={dati.province.map((p) => ({ nome: nomeProvincia(p.provincia), n: p.segnalazioni }))} />
        </section>
      )}

      {dati.fonti.length > 0 && (
        <section>
          <h2>Da quali link si arriva</h2>
          <p className="text-sm text-muted-foreground">Visite degli ultimi 30 giorni arrivate da un link con l’etichetta ?da=…</p>
          <Elenco voci={dati.fonti.map((f) => ({ nome: f.fonte, n: f.visite }))} />
        </section>
      )}

      {dati.widget?.length > 0 && (
        <section>
          <h2>Il widget nei siti</h2>
          <p className="text-sm text-muted-foreground">Quante volte si è aperto il riepilogo della provincia nei siti che lo incorporano, ultimi 30 giorni.</p>
          <Elenco voci={dati.widget.map((w) => ({ nome: w.sito, n: w.aperture }))} />
        </section>
      )}

      <section>
        <h2>Cosa si segnala</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-left font-medium">Ultimi 30 giorni</th>
              {(['disponibile', 'scarso', 'esaurito'] as const).map((s) => (
                <th key={s} className="py-1 text-right font-medium">
                  <span className="inline-flex items-center justify-end gap-1">
                    <SimboloStato colore={COLORE_STATO[s]} /> {{ disponibile: 'Disponibile', scarso: 'Scarso', esaurito: 'Finito' }[s]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TUTTI_I_PRODOTTI.map((p) => (
              <tr key={p} className="border-t">
                <td className="py-1.5 font-semibold">{NOME_PRODOTTO[p]}</td>
                {(['disponibile', 'scarso', 'esaurito'] as const).map((s) => (
                  <td key={s} className="py-1.5 text-right tabular-nums">{numero(dati.prodotti.find((x) => x.prodotto === p && x.stato === s)?.n ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Da sempre</h2>
        <p className="text-sm">
          {numero(dati.totali.visite)} visite · {numero(dati.totali.telefoni)} telefoni · {numero(dati.totali.segnalazioni)} segnalazioni ·{' '}
          {numero(dati.totali.voti)} conferme e smentite
        </p>
      </section>

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Tabella giorno per giorno</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-right tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {['Giorno', 'Visite', 'Visitatori', 'Segnalazioni', 'A distanza', 'Conferme', 'Smentite', 'Code', 'Ci vado', 'Ricerche', 'Schede', 'Telefoni nuovi'].map((t) => (
                  <th key={t} className="px-1.5 py-1 font-medium whitespace-nowrap first:text-left">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...dati.giorni].reverse().map((g) => (
                <tr key={g.giorno} className="border-t">
                  <td className="px-1.5 py-1 text-left whitespace-nowrap">{data(g.giorno)}</td>
                  {[g.visite, g.visitatori, g.segnalazioni, g.a_distanza, g.conferme, g.smentite, g.code, g.ci_vado, g.ricerche, g.schede, g.nuovi_telefoni].map((n, i) => (
                    <td key={i} className="px-1.5 py-1">{numero(n)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="text-xs text-muted-foreground">
        Contiamo solo quanti, mai chi: niente cookie, niente IP salvati, niente strumenti di terze parti. I visitatori unici si calcolano
        dall’identificativo anonimo dei telefoni, che per le statistiche resta solo fino a fine giornata.
      </p>
    </div>
  )
}

function Riquadro({ n, testo }: { n: number; testo: string }) {
  return (
    <div className="rounded-2xl bg-muted p-2.5">
      <dd className="text-xl font-extrabold tabular-nums">{numero(n)}</dd>
      <dt className="text-xs leading-tight text-muted-foreground">{testo}</dt>
    </div>
  )
}

// Un elenco già in ordine, con la barra rispetto al primo.
function Elenco({ voci }: { voci: { nome: string; n: number }[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {voci.map((v) => (
        <li key={v.nome} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2 text-sm">
          <span className="truncate">{v.nome}</span>
          <span className="h-2 rounded-full bg-muted">
            <span className="block h-2 rounded-full bg-foreground/70" style={{ width: `${(v.n / voci[0].n) * 100}%` }} />
          </span>
          <span className="text-right font-semibold tabular-nums">{numero(v.n)}</span>
        </li>
      ))}
    </ul>
  )
}

// Barre sottili con un solo colore neutro; toccando o passando su una barra se ne legge il valore.
function Barre({ titolo, valori, assi }: { titolo: string; valori: { etichetta: string; valore: number }[]; assi?: string[] }) {
  const [attiva, setAttiva] = useState<number | null>(null)
  const massimo = Math.max(1, ...valori.map((v) => v.valore))
  const scelta = attiva != null ? valori[attiva] : null
  return (
    <figure className="mt-3">
      <figcaption className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{titolo}</span>
        <span className="text-muted-foreground tabular-nums">{scelta ? `${scelta.etichetta}: ${numero(scelta.valore)}` : `massimo ${numero(massimo)}`}</span>
      </figcaption>
      <div className="mt-2 flex h-24 items-end gap-[2px] border-b" onMouseLeave={() => setAttiva(null)}>
        {valori.map((v, i) => (
          <button
            key={i}
            aria-label={`${v.etichetta}: ${v.valore}`}
            className="flex h-full flex-1 items-end"
            onMouseEnter={() => setAttiva(i)}
            onFocus={() => setAttiva(i)}
            onClick={() => setAttiva(i)}
          >
            <span
              className={cn('block w-full rounded-t-[4px] transition-colors', i === attiva ? 'bg-foreground' : 'bg-foreground/60')}
              style={{ height: v.valore ? `${Math.max(4, (v.valore / massimo) * 100)}%` : 0 }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        {(assi ?? [valori[0]?.etichetta, valori[valori.length - 1]?.etichetta]).map((a, i) => (
          <span key={i}>{a}</span>
        ))}
      </div>
    </figure>
  )
}
