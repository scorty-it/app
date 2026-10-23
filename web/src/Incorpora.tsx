import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { codiceIframe, type Formato } from './incorpora.ts'

const FORMATI: [Formato, string][] = [
  ['articolo', 'Dentro un articolo'],
  ['laterale', 'In una barra laterale (300 × 600)'],
]

// Per redazioni ed enti: il widget della provincia (widget.tsx) da incollare nel proprio sito, con l'anteprima vera.
export function Incorpora({ sigla, nome, aperto, onChiudi }: { sigla: string; nome: string; aperto: boolean; onChiudi: () => void }) {
  async function copia(codice: string) {
    try {
      await navigator.clipboard.writeText(codice)
      toast('Codice copiato')
    } catch {
      toast('Seleziona il codice e copialo')
    }
  }
  return (
    <Drawer open={aperto} onOpenChange={(o) => !o && onChiudi()} showSwipeHandle>
      <DrawerContent>
        {/* Una colonna che scorre: niente si deve restringere, l'anteprima deve avere l'altezza vera del codice. */}
        <div className="flex flex-col gap-4 overflow-y-auto px-5 pt-2 pb-[max(env(safe-area-inset-bottom),1.25rem)] *:shrink-0">
          <div>
            <DrawerTitle className="text-[22px] font-bold tracking-tight">Incorpora nel tuo sito</DrawerTitle>
            <DrawerDescription>
              Il riepilogo della provincia di {nome}, che si aggiorna da solo, per il sito di una testata o di un ente.
            </DrawerDescription>
          </div>
          {aperto && (
            <iframe src={`/widget/province/${sigla}`} title={`Anteprima: carburante in provincia di ${nome}`} height={480} className="w-full max-w-[640px] shrink-0" />
          )}
          {FORMATI.map(([formato, titolo]) => {
            const codice = codiceIframe(location.origin, sigla, nome, formato)
            return (
              <div key={formato} className="grid gap-2">
                <p className="text-sm font-semibold">{titolo}</p>
                <textarea readOnly rows={3} value={codice} aria-label={`Codice da incollare: ${titolo.toLowerCase()}`} onFocus={(e) => e.target.select()}
                  className="w-full rounded-xl border bg-muted p-2 font-mono text-xs" />
                <Button type="button" variant="outline" className="h-11 gap-2 rounded-full font-semibold" onClick={() => copia(codice)}>
                  <Copy className="size-4" /> Copia il codice
                </Button>
              </div>
            )
          })}
          <p className="text-xs text-muted-foreground">
            Il riquadro non usa cookie e non sa chi lo guarda: contiamo solo quante volte si apre, per sito.
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
