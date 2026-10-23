import { Footprints } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { annullaCiVado, ciVado, mioCiVado } from './dati.ts'
import { DISTANZA_MAX, chiediPosizione, distanza, formatoDistanza } from './posizione.ts'
import { BENI, NOME_PRODOTTO, type Bene, type Posizione, type Punto, type StatoPunto } from './tipi.ts'

// «Ci vado»: un segnale di intenzione, vale un'ora e uno per telefono. Nel negozio si scelgono le categorie,
// al distributore basta un tocco (nessuna scelta di carburante: non serve a stimare nulla).
// Il server ricontrolla tutto (30 km, 409 su categorie finite, 3 all'ora): qui si evitano solo richieste che verrebbero rifiutate.
export function CiVado({ punto, stato, onPosizione }: { punto: Punto; stato: StatoPunto | undefined; onPosizione: (p: Posizione) => void }) {
  const [attivo, setAttivo] = useState(() => mioCiVado()?.punto.id === punto.id)
  // Una segnalazione qui chiude il «Ci vado» (lo dice il server, dati.ts lo toglie): la scheda aperta si allinea al nuovo stato.
  useEffect(() => setAttivo(mioCiVado()?.punto.id === punto.id), [stato, punto.id])
  const [scegliendo, setScegliendo] = useState(false)
  const [scelti, setScelti] = useState<Bene[]>([])
  const [occupato, setOccupato] = useState(false)
  const negozio = punto.tipo === 'negozio'

  // Non si sceglie ciò che è osservato finito (e non contrastante): è la stessa regola del 409 del server.
  const finito = (b: Bene) => stato?.prodotti.some((p) => p.prodotto === b && p.stato === 'esaurito' && p.affidabilita !== 'incerto') ?? false
  const beni = BENI.filter((b) => punto.prodotti.includes(b))
  const arrivi = stato?.arrivi ?? 0

  async function invia(prodotti: Bene[]) {
    setOccupato(true)
    try {
      const pos = await chiediPosizione()
      onPosizione(pos)
      const m = distanza(pos, punto)
      if (m > DISTANZA_MAX) throw new Error(`Sei a ${formatoDistanza(m)}: «Ci vado» vale entro ${DISTANZA_MAX / 1000} km.`)
      await ciVado(punto.id, prodotti, pos)
      setAttivo(true)
      setScegliendo(false)
      setScelti([])
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOccupato(false)
    }
  }

  async function annulla() {
    setOccupato(true)
    try {
      await annullaCiVado()
      setAttivo(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOccupato(false)
    }
  }

  if (attivo) {
    return (
      <section className="rounded-2xl bg-blue-50 p-4 text-blue-950 dark:bg-blue-500/15 dark:text-blue-100">
        <h3 className="flex items-center gap-2 font-bold"><Footprints className="size-4" /> Fatto, ti aspettano</h3>
        <p className="mt-0.5 text-sm">Il tuo «Ci vado» vale un’ora. Se cambi idea, toglilo.</p>
        <Button variant="outline" className="mt-3 h-11 w-full rounded-full font-semibold" disabled={occupato} onClick={annulla}>
          Annulla «Ci vado»
        </Button>
      </section>
    )
  }

  if (!negozio || !scegliendo) {
    return (
      <Button
        variant="outline"
        className="h-12 w-full rounded-full text-base font-semibold"
        disabled={occupato}
        onClick={() => (negozio ? setScegliendo(true) : invia([]))}
      >
        <Footprints /> Ci vado
      </Button>
    )
  }

  const scegli = (b: Bene) => setScelti((x) => (x.includes(b) ? x.filter((y) => y !== b) : [...x, b]))
  return (
    <section className="rounded-2xl border p-4">
      <h3 className="font-bold">Per cosa ci vai?</h3>
      <p className="text-[13px] text-muted-foreground">Tocca le categorie che ti servono. Quelle finite non si possono scegliere.</p>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        {beni.map((b) => (
          <Button
            key={b}
            variant="outline"
            aria-pressed={scelti.includes(b)}
            className={cn('h-12 rounded-full text-sm font-semibold', scelti.includes(b) && 'border-transparent bg-blue-50 text-blue-950 hover:bg-blue-50 dark:bg-blue-500/15 dark:text-blue-100')}
            disabled={occupato || finito(b)}
            onClick={() => scegli(b)}
          >
            {NOME_PRODOTTO[b]}{finito(b) && ' · finito'}
          </Button>
        ))}
      </div>
      <p className="mt-3 rounded-2xl bg-blue-50 p-3.5 text-sm text-blue-950 dark:bg-blue-500/15 dark:text-blue-100">
        Prendi quello che ti serve per questi giorni
        {arrivi > 0 && `: dopo di te ${arrivi === 1 ? 'sta arrivando un’altra persona' : `stanno arrivando altre ${arrivi} persone`}`}.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12 rounded-full font-semibold" disabled={occupato} onClick={() => setScegliendo(false)}>
          Indietro
        </Button>
        <Button className="h-12 rounded-full font-semibold" disabled={occupato || !scelti.length} onClick={() => invia(scelti)}>
          Ci vado{scelti.length > 0 && ` (${scelti.length})`}
        </Button>
      </div>
    </section>
  )
}
