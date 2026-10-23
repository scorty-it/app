import { cn } from '@/lib/utils'
import { barreAndamento, conGrafico, fraseAndamento, oraDi } from './andamento.ts'
import { COLORI } from './aspetto.ts'
import type { BollettinoProvincia } from './dati.ts'

// Le ultime 24 ore: la frase (adesso contro 6 ore fa) e una barra per ora. Un'ora senza fotografia resta vuota,
// un'ora con zero comuni è una linea grigia. Nella pagina della provincia e, compatto, nel widget per le testate.
export function Andamento({ b, compatto = false }: { b: BollettinoProvincia; compatto?: boolean }) {
  const frase = fraseAndamento(b)
  const grafico = conGrafico(b)
  if (!frase && !grafico) return null
  const barre = barreAndamento(b)
  const massimo = Math.max(...barre.map((x) => x.comuni ?? 0))
  const descrizione = barre.filter((x) => x.comuni !== null).map((x, i, note) => `${i === note.length - 1 ? 'adesso' : oraDi(x.ora)} ${x.comuni}`).join(', ')
  return (
    <section className={compatto ? 'space-y-1' : 'space-y-2'}>
      <h2 className={cn(compatto && 'text-sm font-extrabold')}>Ultime 24 ore</h2>
      {frase && <p className={cn(compatto && 'text-sm')}>{frase}</p>}
      {grafico && (
        <div>
          <svg viewBox="0 0 240 48" preserveAspectRatio="none" className={cn('w-full', compatto ? 'h-10' : 'h-14')} role="img" aria-label={`Comuni senza carburante ora per ora: ${descrizione}`}>
            {barre.map((x, i) =>
              x.comuni === null ? null : (
                <rect key={x.ora} x={i * 10 + 1.5} width={7} y={x.comuni ? 48 - Math.max(3, (x.comuni / massimo) * 48) : 46.5}
                  height={x.comuni ? Math.max(3, (x.comuni / massimo) * 48) : 1.5} fill={x.comuni ? COLORI.rosso : '#d4d6db'} />
              ),
            )}
          </svg>
          <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
            {[0, 6, 12, 18].map((i) => <span key={i}>{oraDi(barre[i].ora)}</span>)}
            <span>adesso</span>
          </div>
        </div>
      )}
    </section>
  )
}
