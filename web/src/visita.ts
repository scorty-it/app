import { BENI, type Bene, type LivelloCoda, type Stato } from './tipi.ts'

// Il corpo di POST /api/visite dalle scelte del modulo «Com’è lo scaffale?»; null se non c’è niente da inviare.
// Le risposte seguono l’ordine delle categorie, così la richiesta non dipende da quale si è toccata per prima.
export function corpoVisita(scelte: Partial<Record<Bene, Stato>>, coda: LivelloCoda | null) {
  const risposte = BENI.flatMap((prodotto) => {
    const stato = scelte[prodotto]
    return stato ? [{ prodotto, stato }] : []
  })
  if (!risposte.length && !coda) return null
  return coda ? { risposte, coda } : { risposte }
}
