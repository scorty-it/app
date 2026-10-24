// Quante righe di ogni elenco stanno nel widget, che ha un'altezza fissa (480 o 600 px nel codice incollato dalle testate)
// e nessuna barra di scorrimento. Il widget misura la pagina vera e chiede qui il passo dopo: si parte da una riga per elenco,
// si aggiunge una riga alla volta all'elenco più basso e, quando una non sta più, la si toglie e quell'elenco è finito.
// Funzioni pure: il ciclo e le misure stanno in widget.tsx.

export const NOMI_PER_BENE = 3 // al più quanti comuni nominare nella riga di un bene (meno se non stanno su una riga): gli altri sono «+N»

export type Elenco = 'comuni' | 'beni'
const ELENCHI: Elenco[] = ['comuni', 'beni']

export interface Righe {
  comuni: number // comuni senza carburante mostrati
  beni: number // beni della spesa mostrati
  nomi: Record<string, number> // comuni nominati nella riga di ogni bene (se manca, quelli di `nomiPerBene`)
  chiusi: Elenco[] // gli elenchi a cui un'altra riga non sta più
  provato: Elenco | null // l'elenco a cui si è appena aggiunta una riga, ancora da controllare
}

export interface Misure {
  esce: boolean // il contenuto è più alto della zona
  alti: Record<Elenco, number> // l'altezza di ogni elenco com'è disegnato adesso
  aCapo: string[] // i beni la cui riga va a capo
}

export const righeIniziali = (massimi: Record<Elenco, number>): Righe => ({
  comuni: Math.min(1, massimi.comuni), beni: Math.min(1, massimi.beni), nomi: {}, chiusi: [], provato: null,
})

// Il passo dopo, o null se non c'è più niente da fare. Prima le righe di bene che vanno a capo (un comune nominato in meno);
// poi, se il contenuto esce, via l'ultima riga provata (se nemmeno il minimo sta, una dall'elenco più alto); altrimenti
// una riga in più all'elenco più basso, a parità i comuni. Ogni passo toglie o aggiunge qualcosa: il ciclo finisce sempre.
export function passoAdattamento(righe: Righe, massimi: Record<Elenco, number>, { esce, alti, aCapo }: Misure, nomiPerBene = NOMI_PER_BENE): Righe | null {
  const nomiDi = (bene: string) => righe.nomi[bene] ?? nomiPerBene
  const daAccorciare = aCapo.find((bene) => nomiDi(bene) > 1)
  if (daAccorciare) return { ...righe, nomi: { ...righe.nomi, [daAccorciare]: nomiDi(daAccorciare) - 1 } }
  if (esce) {
    const k = righe.provato ?? ELENCHI.filter((x) => righe[x] > 0).sort((x, y) => alti[y] - alti[x])[0]
    return k ? { ...righe, [k]: righe[k] - 1, chiusi: [...righe.chiusi, k], provato: null } : null
  }
  const k = ELENCHI.filter((x) => !righe.chiusi.includes(x) && righe[x] < massimi[x]).sort((x, y) => alti[x] - alti[y])[0]
  if (k) return { ...righe, [k]: righe[k] + 1, provato: k }
  return righe.provato ? { ...righe, provato: null } : null
}
