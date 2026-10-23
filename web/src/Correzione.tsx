import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { inviaCorrezione } from './dati.ts'
import { MARCHI, marchioNoto, type Correzione as TipoCorrezione, type Punto } from './tipi.ts'

const TIPI = (luogo: 'distributore' | 'negozio'): [TipoCorrezione['tipo'], string][] => [
  ['dati_errati', 'Nome, indirizzo o posizione sbagliati'],
  ['chiuso', luogo === 'negozio' ? 'Il negozio è chiuso' : 'Il distributore è chiuso'],
  ['gestore', 'Sono il gestore'],
  ['altro', 'Altro, o una segnalazione falsa'],
]

export function Correzione({ punto, aperto, onChiudi }: { punto: Punto; aperto: boolean; onChiudi: () => void }) {
  const [tipo, setTipo] = useState<TipoCorrezione['tipo']>('dati_errati')
  const [marchio, setMarchio] = useState(() => marchioNoto(punto))
  const [messaggio, setMessaggio] = useState('')
  const [contatto, setContatto] = useState('')
  const [invio, setInvio] = useState(false)
  const gestore = tipo === 'gestore'
  const negozio = punto.tipo === 'negozio'
  // I marchi dell'elenco sono di carburanti: per un negozio non si chiede.
  const conMarchio = !negozio && (gestore || tipo === 'dati_errati')

  async function invia(e: React.FormEvent) {
    e.preventDefault()
    setInvio(true)
    try {
      await inviaCorrezione({ punto_id: punto.id, tipo, marchio: conMarchio ? marchio || null : null, messaggio, contatto })
      toast.success('Richiesta inviata. Grazie!')
      setMessaggio('')
      setContatto('')
      onChiudi()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setInvio(false)
    }
  }

  return (
    <Drawer open={aperto} onOpenChange={(o) => !o && onChiudi()} showSwipeHandle>
      <DrawerContent>
        <form onSubmit={invia} className="flex flex-col gap-4 overflow-y-auto px-5 pt-2 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          <div>
            <DrawerTitle className="text-[22px] font-bold tracking-tight">Segnala un errore</DrawerTitle>
            <DrawerDescription>{[punto.nome, punto.indirizzo, punto.comune].filter(Boolean).join(' · ')}</DrawerDescription>
          </div>
          <RadioGroup value={tipo} onValueChange={(v) => setTipo(v as TipoCorrezione['tipo'])} className="gap-2">
            {TIPI(punto.tipo).map(([valore, testo]) => (
              <Label key={valore} className="flex min-h-13 items-center gap-3 rounded-2xl border px-3.5 font-medium has-data-checked:border-primary has-data-checked:bg-muted">
                <RadioGroupItem value={valore} />
                {testo}
              </Label>
            ))}
          </RadioGroup>
          {conMarchio && (
            <div className="grid gap-2">
              <Label htmlFor="marchio">{gestore ? 'Il marchio del tuo distributore' : 'Marchio giusto'}</Label>
              <select
                id="marchio"
                value={marchio}
                onChange={(e) => setMarchio(e.target.value)}
                className="h-12 rounded-2xl border border-input bg-background px-3.5 text-base font-medium"
              >
                <option value="">Scegli il marchio…</option>
                {MARCHI.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="messaggio">{gestore ? (negozio ? 'Note (facoltative)' : 'Note (facoltative, per esempio il marchio se non è nell’elenco)') : 'Cosa non va?'}</Label>
            <Textarea id="messaggio" required={!gestore} maxLength={2000} rows={3} value={messaggio} onChange={(e) => setMessaggio(e.target.value)} className="rounded-2xl" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="contatto">Email o telefono {gestore ? '' : '(facoltativo)'}</Label>
            <Input id="contatto" required={gestore} maxLength={200} value={contatto} onChange={(e) => setContatto(e.target.value)} className="h-12 rounded-2xl" />
            <p className="text-xs text-muted-foreground">
              {gestore ? 'Ti contatteremo per verificare. ' : 'Solo se vuoi una risposta. '}
              Lo usiamo solo per questa richiesta e lo cancelliamo 90 giorni dopo averla chiusa.
            </p>
          </div>
          <Button type="submit" className="h-12 rounded-full text-base font-bold" disabled={invio}>
            Invia
          </Button>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
