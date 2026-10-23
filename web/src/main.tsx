import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/figtree'
import { Toaster } from '@/components/ui/sonner'
import { App } from './App.tsx'
import { useTema } from './tema.ts'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Fuori dal contenitore dell'app, così le notifiche stanno sopra le schede aperte */}
    <Notifiche />
  </StrictMode>,
)

function Notifiche() {
  const { scuro } = useTema()
  return <Toaster position="top-center" theme={scuro ? 'dark' : 'light'} />
}
