import { Eye, Pencil, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { COLORE_STATO, PILLOLA, quando } from './aspetto.ts'
import { aggiungiCarburante, aggiungiCoda, annullaVisita, correggi, mieSegnalazioni } from './dati.ts'
import { Pagina } from './Pagine.tsx'
import { raggruppa, type Visita } from './visite.ts'
import { PillolaStato, SimboloStato } from './SchedaPunto.tsx'
import { MODIFICA_MINUTI, NOME_CODA, NOME_PRODOTTO, mondoDi, nomeStato, type LivelloCoda, type Stato } from './tipi.ts'

// Le tue segnalazioni, raggruppate per visita (stesso distributore o negozio entro un'ora).
// Per un'ora si possono completare e correggere anche lontano dal distributore; annullare, per 4 ore.

const MINUTO = 60_000
const t = (iso: string) => Date.parse(iso)
const ora = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

export function MieSegnalazioni() {
  const [visite, setVisite] = useState<Visita[] | null>(null)
  const [occupato, setOccupato] = useState(false)
  const [aperto, setAperto] = useState<string | null>(null) // quale carburante o categoria sta scegliendo un nuovo stato

  const carica = useCallback(() => mieSegnalazioni().then((r) => setVisite(raggruppa(r.segnalazioni, r.code)), (e) => toast.error(e.message)), [])
  useEffect(() => void carica(), [carica])

  async function esegui(azione: () => Promise<void>, fatto: string) {
    setOccupato(true)
    try {
      await azione()
      toast.success(fatto)
      setAperto(null)
      await carica()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOccupato(false)
    }
  }

  return (
    <Pagina titolo="Le tue segnalazioni">
      <p className="text-sm text-muted-foreground">
        Ultime 24 ore. Per un’ora dopo la visita puoi completarla o correggerla, anche se non sei più lì. «Vista da» conta le persone che
        hanno aperto la scheda dopo la tua segnalazione.
      </p>
      {visite === null ? (
        <p className="text-muted-foreground">Caricamento…</p>
      ) : !visite.length ? (
        <p>Non hai ancora fatto segnalazioni. Quando sei a un distributore o in un negozio, apri la sua scheda.</p>
      ) : (
        <ul className="space-y-3">
          {visite.map((v) => {
            const fino = t(v.creata_il) + MODIFICA_MINUTI * MINUTO
            const modificabile = Date.now() < fino
            const annullabile = Date.now() < t(v.creata_il) + 4 * 60 * MINUTO
            const mondo = mondoDi(v.punto.tipo)
            const negozio = mondo === 'spesa'
            return (
              <li key={`${v.punto.id}:${v.creata_il}`} className="space-y-3 rounded-2xl border p-4">
                <div>
                  <p className="font-bold">{v.punto.nome}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {[v.punto.indirizzo, v.punto.comune].filter(Boolean).join(', ')}
                    {[v.punto.indirizzo, v.punto.comune].some(Boolean) && ' · '}
                    {v.a_distanza ? 'vista a distanza ' : ''}
                    {quando(v.visto_il)}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium">
                    <Eye className="size-4" /> Vista da {v.viste === 1 ? '1 persona' : `${v.viste} persone`}
                  </p>
                </div>

                <ul className="divide-y rounded-2xl bg-muted/50">
                  {v.punto.prodotti.map((p) => {
                    const m = v.perProdotto.get(p)
                    const chiave = `${v.rif}:${p}`
                    return (
                      <li key={p} className="px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{NOME_PRODOTTO[p]}</span>
                          <span className="flex items-center gap-2">
                            {m ? <PillolaStato stato={m.stato} mondo={mondo} /> : <span className="text-[13px] text-muted-foreground">non segnalato</span>}
                            {modificabile && (
                              <Button variant="ghost" size="sm" className="h-8 rounded-full px-2.5" onClick={() => setAperto(aperto === chiave ? null : chiave)}>
                                {m ? <Pencil /> : <Plus />} {m ? 'Cambia' : 'Aggiungi'}
                              </Button>
                            )}
                          </span>
                        </div>
                        {aperto === chiave && (
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {(['disponibile', 'scarso', 'esaurito'] as Stato[]).map((s) => (
                              <Button
                                key={s}
                                variant="outline"
                                disabled={occupato || m?.stato === s}
                                className={cn('h-11 rounded-full border-transparent text-sm font-semibold', PILLOLA[COLORE_STATO[s]])}
                                onClick={() =>
                                  esegui(
                                    () => (m ? correggi(m.id, s) : aggiungiCarburante(v.rif, p, s)),
                                    m ? `${NOME_PRODOTTO[p]}: ora è «${nomeStato(s, mondo)}».` : negozio ? `Categoria aggiunta alla tua visita: ${NOME_PRODOTTO[p]}.` : `${NOME_PRODOTTO[p]} aggiunto alla tua segnalazione.`,
                                  )
                                }
                              >
                                <SimboloStato colore={COLORE_STATO[s]} /> {nomeStato(s, mondo)}
                              </Button>
                            ))}
                          </div>
                        )}
                      </li>
                    )
                  })}
                  {!v.a_distanza && (
                    <li className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">Coda</span>
                        <span className="text-[13px] text-muted-foreground">{v.coda ? NOME_CODA[v.coda].toLowerCase() : 'non indicata'}</span>
                      </div>
                      {modificabile && (
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {(['nessuna', 'breve', 'lunga'] as LivelloCoda[]).map((l) => (
                            <Button
                              key={l}
                              variant="outline"
                              disabled={occupato || v.coda === l}
                              className="h-10 rounded-full text-sm font-semibold"
                              onClick={() => esegui(() => aggiungiCoda(v.rif, l), 'Coda aggiunta alla tua segnalazione.')}
                            >
                              {NOME_CODA[l]}
                            </Button>
                          ))}
                        </div>
                      )}
                    </li>
                  )}
                </ul>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="text-muted-foreground">
                    {modificabile ? `Puoi completarla fino alle ${ora(new Date(fino).toISOString())}` : 'Non più modificabile'}
                  </span>
                  {annullabile && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full px-2.5 text-destructive"
                      disabled={occupato}
                      onClick={() =>
                        confirm(`Annullare la tua segnalazione per ${v.punto.nome}? Sparirà dalla mappa.`) &&
                        esegui(() => annullaVisita(v.rif), 'Segnalazione annullata.')
                      }
                    >
                      Annulla segnalazione
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Pagina>
  )
}
