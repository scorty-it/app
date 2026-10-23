import { Share, SquarePlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Marchio } from './Marchio.tsx'

// Invito ad aggiungere Scorty alla schermata Home.
// Android (Chrome, Edge, Samsung): il browser offre l'installazione e noi la proponiamo con un pulsante.
// iPhone: i siti non possono installarsi da soli, quindi spieghiamo i due tocchi in Safari.
// Computer (Chrome, Edge): lo stesso pulsante di Android, ma in una riga sola e senza parlare di schermata Home.

interface EventoInstallazione extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const CHIAVE = 'scorty-installa-chiuso'
const PAUSA = 14 * 24 * 60 * 60 * 1000 // chi chiude l'invito non lo rivede per due settimane
const ATTESA = 25_000 // non appena si apre: prima si guarda la mappa

export const giaInstallata = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const suIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const suComputer = () => matchMedia('(hover: hover) and (pointer: fine)').matches // mouse, non dito

function chiusoDaPoco() {
  try {
    return Date.now() - Number(localStorage.getItem(CHIAVE) ?? 0) < PAUSA
  } catch {
    return false
  }
}
function ricordaChiuso() {
  try {
    localStorage.setItem(CHIAVE, String(Date.now()))
  } catch {
    // dati del sito bloccati: l'invito tornerà alla prossima visita
  }
}

// L'evento di Android arriva presto, anche prima che l'invito sia visibile: lo teniamo da parte.
let eventoAndroid: EventoInstallazione | null = null
const inAttesa = new Set<() => void>()
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  eventoAndroid = e as EventoInstallazione
  inAttesa.forEach((f) => f())
})

export const installabile = () => !giaInstallata() && (!!eventoAndroid || suIphone())

// `forzato`: aperto dal menu, ignora attesa e pausa.
export function InvitoInstallazione({ forzato, onChiudi }: { forzato: boolean; onChiudi: () => void }) {
  const [pronto, setPronto] = useState(false)
  const [android, setAndroid] = useState(!!eventoAndroid)

  useEffect(() => {
    const aggiorna = () => setAndroid(!!eventoAndroid)
    inAttesa.add(aggiorna)
    const t = setTimeout(() => setPronto(true), ATTESA)
    return () => (inAttesa.delete(aggiorna), clearTimeout(t))
  }, [])

  const iphone = !android && suIphone()
  const visibile = !giaInstallata() && (android || iphone) && (forzato || (pronto && !chiusoDaPoco()))
  if (!visibile) return null

  const chiudi = () => (ricordaChiuso(), onChiudi(), setPronto(false))
  async function installa() {
    if (!eventoAndroid) return
    await eventoAndroid.prompt()
    await eventoAndroid.userChoice
    eventoAndroid = null
    chiudi()
  }

  if (android && suComputer()) {
    return (
      <div role="dialog" aria-label="Installa Scorty sul computer" className="pointer-events-auto mb-2 flex items-center gap-3 rounded-full bg-card py-2 pr-2 pl-3 shadow-float">
        <Marchio className="size-8 shrink-0" />
        <p className="min-w-0 flex-1 text-[13px] leading-snug">
          <span className="font-bold">Installa Scorty sul computer</span>
          <span className="text-muted-foreground">: si apre in una finestra sua.</span>
        </p>
        <button className="h-9 shrink-0 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground" onClick={installa}>
          Installa
        </button>
        <button aria-label="Non ora" className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted" onClick={chiudi}>
          <X className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div role="dialog" aria-label="Aggiungi Scorty alla schermata Home" className="pointer-events-auto mb-2.5 rounded-3xl bg-card p-4 shadow-float">
      <div className="flex items-start gap-3">
        <Marchio className="size-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">Tieni Scorty a portata di mano</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {android
              ? 'Aggiungila alla schermata Home: si apre come un’app, a schermo intero.'
              : 'Aggiungila alla schermata Home e si aprirà come un’app.'}
          </p>
        </div>
        <button aria-label="Non ora" className="-mt-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted" onClick={chiudi}>
          <X className="size-4" />
        </button>
      </div>
      {android ? (
        <button className="mt-3 h-11 w-full rounded-full bg-primary text-[15px] font-bold text-primary-foreground" onClick={installa}>
          Installa Scorty
        </button>
      ) : (
        <ol className="mt-3 space-y-1.5 rounded-2xl bg-muted p-3 text-sm">
          <li className="flex items-center gap-2">
            <span className="font-bold">1.</span> In Safari tocca <Share className="size-4" aria-label="Condividi" /> <strong>Condividi</strong>
          </li>
          <li className="flex items-center gap-2">
            <span className="font-bold">2.</span> Scegli <SquarePlus className="size-4" aria-hidden="true" /> <strong>Aggiungi alla schermata Home</strong>
          </li>
        </ol>
      )}
    </div>
  )
}
