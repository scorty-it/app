// Condividere un testo deve riuscire sempre: nei browser dentro le app (per esempio Facebook su Android) può mancare
// la condivisione e gli appunti possono essere rifiutati. Allora il testo si mostra, da copiare a mano.
export type EsitoTesto = 'condiviso' | 'annullato' | 'copiato' | 'da_copiare'

// Le etichette dei link che l'app fa condividere: nelle statistiche dicono quanto porta il passaparola, e da dove.
// Solo dove il link si tocca: l'indirizzo stampato su immagine e PDF resta pulito, chi lo digita non scrive l'etichetta.
export const ETICHETTA = { zona: 'zona', bollettino: 'bollettino', qrPdf: 'pdf' } as const

// Il link con l'etichetta ?da= (vedi prepara in dati.ts, che la toglie all'arrivo). Il resto dell'indirizzo non cambia.
export function conFonte(url: string, fonte: string) {
  const u = new URL(url)
  u.searchParams.set('da', fonte)
  return u.toString()
}

export async function condividiTesto(
  testo: string,
  dove: { share?: (dati: { text: string }) => Promise<void>; copia?: (testo: string) => Promise<void> },
): Promise<EsitoTesto> {
  if (dove.share) {
    try {
      await dove.share({ text: testo })
      return 'condiviso'
    } catch (e) {
      if ((e as Error | null)?.name === 'AbortError') return 'annullato' // l'ha chiuso chi usa il telefono
    }
  }
  if (dove.copia) {
    try {
      await dove.copia(testo)
      return 'copiato'
    } catch {
      // appunti rifiutati: resta il testo da copiare a mano
    }
  }
  return 'da_copiare'
}
