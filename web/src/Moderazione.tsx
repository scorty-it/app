import { Ban, Eye, EyeOff, LogOut, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { quando } from './aspetto.ts'
import { Pagina } from './Pagine.tsx'
import { PillolaStato } from './SchedaPunto.tsx'
import { Statistiche, type DatiStatistiche } from './Statistiche.tsx'
import { NOME_PRODOTTO, type Prodotto, type Stato } from './tipi.ts'

// Pannello di moderazione su /admin: non è nel menu. La password resta solo in questa scheda del browser.

const CHIAVE = 'scorty-admin'
const letta = () => {
  try {
    return sessionStorage.getItem(CHIAVE) ?? ''
  } catch {
    return ''
  }
}
const salva = (p: string) => {
  try {
    if (p) sessionStorage.setItem(CHIAVE, p)
    else sessionStorage.removeItem(CHIAVE)
  } catch {
    // dati del sito bloccati: si rientra a ogni ricarica
  }
}

async function chiama<T>(password: string, url: string, corpo?: object): Promise<T> {
  const r = await fetch(`/api/admin/${url}`, {
    method: corpo ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${password}`, ...(corpo && { 'content-type': 'application/json' }) },
    body: corpo && JSON.stringify(corpo),
  })
  if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => null))?.message ?? 'Errore del server'), { status: r.status })
  return r.json()
}

interface Riepilogo {
  dispositivi: number
  bloccati: number
  segnalazioni_24h: number
  anomalie_24h: number
  correzioni_aperte: number
  distributori: number
  distributori_aggiornati_il: string | null
}
interface Segnalazione {
  id: number
  visto_il: string
  prodotto: Prodotto
  stato: Stato
  a_distanza: boolean
  nascosta: boolean
  ritirata: boolean
  dispositivo_id: string | null
  bloccato: boolean
  nome: string
  comune: string | null
  conferme: number
  smentite: number
  anomalie: number
}
interface Anomalia {
  id: number
  tipo: 'velocita_impossibile' | 'fuori_raggio' | 'limite_superato'
  dettagli: Record<string, number | boolean>
  punto_tipo: 'distributore' | 'negozio' | null
  creata_il: string
  dispositivo_id: string | null
  bloccato: boolean
}
interface RichiestaCorrezione {
  id: number
  tipo: string
  marchio: string | null
  messaggio: string
  contatto: string | null
  creata_il: string
  chiusa_il: string | null
  nome: string
  comune: string | null
}

const SCHEDE = { statistiche: 'Statistiche', segnalazioni: 'Segnalazioni', anomalie: 'Anomalie', correzioni: 'Correzioni' } as const
type Scheda = keyof typeof SCHEDE

const TIPO_ANOMALIA = { velocita_impossibile: 'Spostamento impossibile', fuori_raggio: 'Fuori raggio', limite_superato: 'Limite orario superato' }
const TIPO_CORREZIONE: Record<string, string> = { dati_errati: 'Dati sbagliati', chiuso: 'Chiuso', gestore: 'Gestore', altro: 'Altro' }

function dettagliAnomalia(a: Anomalia) {
  const d = a.dettagli
  const luogo = a.punto_tipo === 'negozio' ? 'negozio' : 'distributore'
  if (a.tipo === 'velocita_impossibile') return `${d.km} km in ${d.minuti} min (punti ${d.da} → ${d.a})`
  if (a.tipo === 'fuori_raggio') return `a ${d.metri} m dal ${luogo} ${d.punto_id}`
  if (d.ci_vado) return 'più di 3 «Ci vado» in un’ora' // l'anomalia non conserva il punto
  return `${luogo} ${d.punto_id}`
}

export function Moderazione() {
  const [password, setPassword] = useState(letta)
  const [bozza, setBozza] = useState('')
  const [scheda, setScheda] = useState<Scheda>('statistiche')
  const [riepilogo, setRiepilogo] = useState<Riepilogo | null>(null)
  const [righe, setRighe] = useState<unknown[]>([])
  const [statistiche, setStatistiche] = useState<DatiStatistiche | null>(null)

  const esci = useCallback(() => {
    salva('')
    setPassword('')
    setRiepilogo(null)
  }, [])

  const carica = useCallback(async () => {
    if (!password) return
    try {
      const [r, dati] = await Promise.all([chiama<Riepilogo>(password, 'riepilogo'), chiama<unknown>(password, scheda)])
      setRiepilogo(r)
      if (scheda === 'statistiche') setStatistiche(dati as DatiStatistiche)
      else setRighe(dati as unknown[])
    } catch (e) {
      toast.error((e as Error).message)
      if ((e as { status?: number }).status === 401) esci()
    }
  }, [password, scheda, esci])

  useEffect(() => void carica(), [carica])

  async function azione(url: string, corpo: object, fatto: string) {
    try {
      await chiama(password, url, corpo)
      toast.success(fatto)
      await carica()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const bloccaTelefono = (id: string | null, bloccato: boolean) =>
    id && (
      <Button size="sm" variant={bloccato ? 'outline' : 'destructive'} className="h-9 rounded-full px-3" onClick={() => azione(`dispositivi/${id}`, { bloccato: !bloccato }, bloccato ? 'Telefono sbloccato' : 'Telefono bloccato')}>
        <Ban /> {bloccato ? 'Sblocca telefono' : 'Blocca telefono'}
      </Button>
    )
  const telefono = (id: string | null, bloccato: boolean) => (
    <span className={cn('font-mono text-xs', bloccato && 'text-destructive line-through')}>{id ? id.slice(0, 8) : 'anonimo (oltre 30 giorni)'}</span>
  )

  if (!password) {
    return (
      <Pagina titolo="Moderazione">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            salva(bozza)
            setPassword(bozza)
          }}
        >
          <label htmlFor="password" className="block text-sm font-semibold">Password del pannello</label>
          <Input id="password" type="password" autoComplete="current-password" value={bozza} onChange={(e) => setBozza(e.target.value)} className="h-12 rounded-2xl" />
          <Button type="submit" className="h-12 w-full rounded-full text-base font-bold" disabled={!bozza}>Entra</Button>
        </form>
      </Pagina>
    )
  }

  return (
    <Pagina titolo="Moderazione">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {riepilogo?.distributori_aggiornati_il ? `Distributori aggiornati ${quando(riepilogo.distributori_aggiornati_il)}` : 'Distributori non ancora aggiornati da OpenStreetMap'}
        </p>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" aria-label="Aggiorna" onClick={carica}><RefreshCw /></Button>
          <Button size="icon" variant="ghost" aria-label="Esci" onClick={esci}><LogOut /></Button>
        </div>
      </div>
      {riepilogo && (
        <dl className="grid grid-cols-3 gap-2 text-center">
          {([
            [riepilogo.segnalazioni_24h, 'segnalazioni in 24 h'],
            [riepilogo.anomalie_24h, 'anomalie in 24 h'],
            [riepilogo.correzioni_aperte, 'correzioni aperte'],
            [riepilogo.distributori, 'distributori attivi'],
            [riepilogo.dispositivi, 'telefoni'],
            [riepilogo.bloccati, 'bloccati'],
          ] as const).map(([n, testo]) => (
            <div key={testo} className="rounded-2xl bg-muted p-2.5">
              <dd className="text-xl font-extrabold tabular-nums">{n.toLocaleString('it-IT')}</dd>
              <dt className="text-xs text-muted-foreground">{testo}</dt>
            </div>
          ))}
        </dl>
      )}

      <div role="tablist" className="senza-barra flex gap-1 overflow-x-auto rounded-full bg-muted p-1">
        {(Object.keys(SCHEDE) as Scheda[]).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={scheda === s}
            onClick={() => (setRighe([]), setScheda(s))}
            className={cn('h-10 shrink-0 grow rounded-full px-3 text-sm font-semibold text-muted-foreground', scheda === s && 'bg-card text-foreground shadow-sm')}
          >
            {SCHEDE[s]}
          </button>
        ))}
      </div>

      {scheda === 'statistiche' ? (
        statistiche ? <Statistiche dati={statistiche} /> : <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : (
        !righe.length && <p className="text-sm text-muted-foreground">Niente da mostrare.</p>
      )}
      <ul className="space-y-2">
        {scheda === 'segnalazioni' &&
          (righe as Segnalazione[]).map((s) => (
            <li key={s.id} className={cn('space-y-2 rounded-2xl border p-3.5 text-sm', (s.nascosta || s.ritirata) && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{s.nome}{s.comune && ` · ${s.comune}`}</p>
                  <p className="text-xs text-muted-foreground">
                    {NOME_PRODOTTO[s.prodotto]} · {s.a_distanza ? 'a distanza, visto ' : ''}{quando(s.visto_il)} · ✓ {s.conferme} ✕ {s.smentite}
                  </p>
                </div>
                <PillolaStato stato={s.stato} />
              </div>
              <p className="flex flex-wrap items-center gap-x-2 text-xs">
                Telefono {telefono(s.dispositivo_id, s.bloccato)}
                {s.anomalie > 0 && <span className="font-semibold text-destructive">{s.anomalie} anomalie in 24 h</span>}
                {s.nascosta && <span className="font-semibold">nascosta</span>}
                {s.ritirata && <span className="font-semibold">corretta o annullata da chi l’ha fatta</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-9 rounded-full px-3" onClick={() => azione(`segnalazioni/${s.id}`, { nascosta: !s.nascosta }, s.nascosta ? 'Segnalazione di nuovo visibile' : 'Segnalazione nascosta')}>
                  {s.nascosta ? <Eye /> : <EyeOff />} {s.nascosta ? 'Mostra' : 'Nascondi'}
                </Button>
                {bloccaTelefono(s.dispositivo_id, s.bloccato)}
              </div>
            </li>
          ))}
        {scheda === 'anomalie' &&
          (righe as Anomalia[]).map((a) => (
            <li key={a.id} className="space-y-2 rounded-2xl border p-3.5 text-sm">
              <p className="font-semibold">{TIPO_ANOMALIA[a.tipo]}{a.dettagli.ci_vado ? ' («Ci vado»)' : ''}</p>
              <p className="text-xs text-muted-foreground">{dettagliAnomalia(a)} · {quando(a.creata_il)}</p>
              <p className="text-xs">Telefono {telefono(a.dispositivo_id, a.bloccato)}</p>
              {bloccaTelefono(a.dispositivo_id, a.bloccato)}
            </li>
          ))}
        {scheda === 'correzioni' &&
          (righe as RichiestaCorrezione[]).map((c) => (
            <li key={c.id} className={cn('space-y-1.5 rounded-2xl border p-3.5 text-sm', c.chiusa_il && 'opacity-60')}>
              <p className="font-semibold">
                {TIPO_CORREZIONE[c.tipo] ?? c.tipo} · {c.nome}{c.comune && ` · ${c.comune}`}
              </p>
              {c.marchio && <p>Marchio indicato: <strong>{c.marchio}</strong></p>}
              {c.messaggio && <p className="whitespace-pre-wrap">{c.messaggio}</p>}
              {c.contatto && <p className="text-xs">Contatto: <span className="select-all font-medium">{c.contatto}</span></p>}
              <p className="text-xs text-muted-foreground">{quando(c.creata_il)}{c.chiusa_il && ' · chiusa'}</p>
              {!c.chiusa_il && (
                <Button size="sm" variant="outline" className="h-9 rounded-full px-3" onClick={() => azione(`correzioni/${c.id}/chiudi`, {}, 'Richiesta chiusa')}>
                  Segna come gestita
                </Button>
              )}
            </li>
          ))}
      </ul>
    </Pagina>
  )
}
