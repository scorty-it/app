import { MODIFICA_MINUTI, type LivelloCoda, type MiaCiVado, type MiaCoda, type MiaSegnalazione, type Prodotto, type Punto } from './tipi.ts'

// Le tue segnalazioni raggruppate per visita: stesso distributore entro un'ora.

export interface Visita {
  punto: Punto
  creata_il: string
  visto_il: string
  a_distanza: boolean
  viste: number
  perProdotto: Map<Prodotto, MiaSegnalazione>
  coda: LivelloCoda | null
  rif: number // una segnalazione della visita: le azioni sulla visita partono da lei
}

const MINUTO = 60_000
const t = (iso: string) => Date.parse(iso)

export function raggruppa(segnalazioni: MiaSegnalazione[], code: MiaCoda[]): Visita[] {
  const visite: Visita[] = []
  for (const m of [...segnalazioni].sort((a, b) => t(a.creata_il) - t(b.creata_il))) {
    const v = visite.find((v) => v.punto.id === m.punto.id && Math.abs(t(m.creata_il) - t(v.creata_il)) < MODIFICA_MINUTI * MINUTO)
    if (v) {
      v.perProdotto.set(m.prodotto, m)
      v.viste = Math.max(v.viste, m.viste)
    } else {
      visite.push({
        punto: m.punto, creata_il: m.creata_il, visto_il: m.visto_il, a_distanza: m.a_distanza, viste: m.viste,
        perProdotto: new Map([[m.prodotto, m]]), coda: null, rif: m.id,
      })
    }
  }
  // Le code arrivano dalla più recente: la prima che cade nella visita è quella che conta.
  for (const c of code) {
    const v = visite.find((v) => v.punto.id === c.punto_id && t(c.creata_il) >= t(v.visto_il) - 5 * MINUTO && t(c.creata_il) <= t(v.creata_il) + MODIFICA_MINUTI * MINUTO)
    if (v && !v.coda) v.coda = c.livello
  }
  return visite.reverse()
}


// Il server chiude il «Ci vado» di un telefono dopo una segnalazione, una coda, un voto o una visita su quel punto:
// il telefono lo toglie subito, senza aspettare di rileggere /api/mie.
export const ciVadoSuperstite = (attuale: MiaCiVado | null, puntoId: number) => (attuale?.punto.id === puntoId ? null : attuale)
