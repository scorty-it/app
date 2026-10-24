import { cn } from '@/lib/utils'
import { barreAndamento, conGrafico, fraseAndamento, oraDi, titoloAndamento } from './andamento.ts'
import { COLORI } from './aspetto.ts'
import type { BollettinoProvincia } from './dati.ts'
import type { Mondo } from './tipi.ts'

// Le ultime 24 ore: la frase (adesso contro 6 ore fa) e una barra per ora. Un'ora senza fotografia resta vuota,
// un'ora con zero comuni è una linea grigia. Nella pagina della provincia e, compatto, nel widget per le testate.
// Un grafico per mondo, mai due serie insieme: quello della spesa conta i comuni senza almeno un bene (sta dentro la sezione «Spesa»,
// quindi il suo titolo è di un livello più in basso).
export function Andamento({ b, mondo = 'carburante', compatto = false }: { b: BollettinoProvincia; mondo?: Mondo; compatto?: boolean }) {
  const frase = fraseAndamento(b, mondo)
  const grafico = conGrafico(b, mondo)
  if (!frase && !grafico) return null
  const barre = barreAndamento(b, mondo)
  const Titolo = mondo === 'spesa' ? 'h3' : 'h2'
  const massimo = Math.max(...barre.map((x) => x.comuni ?? 0))
  const descrizione = barre.filter((x) => x.comuni !== null).map((x, i, note) => `${i === note.length - 1 ? 'adesso' : oraDi(x.ora)} ${x.comuni}`).join(', ')
  return (
    <section className={compatto ? 'space-y-1' : 'space-y-2'}>
      <Titolo className={cn(compatto && 'text-sm font-extrabold', mondo === 'spesa' && 'text-sm font-semibold text-muted-foreground')}>{titoloAndamento(mondo)}</Titolo>
      {frase && <p className={cn(compatto && 'text-sm')}>{frase}</p>}
      {grafico && (
        <div>
          <svg viewBox="0 0 240 48" preserveAspectRatio="none" className={cn('w-full', compatto ? 'h-10' : 'h-14')} role="img" aria-label={`${mondo === 'spesa' ? 'Comuni senza beni della spesa' : 'Comuni senza carburante'} ora per ora: ${descrizione}`}>
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
