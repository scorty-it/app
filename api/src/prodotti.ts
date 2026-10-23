import type { Prodotto, TipoPunto } from './db.ts'

// L'ordine è quello della maschera di bit di /api/mappa: non cambiarlo.
export const CARBURANTI: Prodotto[] = ['benzina', 'gasolio', 'gpl', 'metano']
export const BENI: Prodotto[] = ['acqua', 'latte', 'pane', 'frutta_verdura', 'pasta_riso', 'carne_pesce', 'neonati']
export const TUTTI_I_PRODOTTI: Prodotto[] = [...CARBURANTI, ...BENI]
export const PRODOTTI_DEL_TIPO: Record<TipoPunto, Prodotto[]> = { distributore: CARBURANTI, negozio: BENI }

// I nomi che leggono le persone, per i messaggi dell'API (l'app ha i suoi).
export const NOME_PRODOTTO: Record<Prodotto, string> = {
  benzina: 'benzina', gasolio: 'gasolio', gpl: 'GPL', metano: 'metano',
  acqua: 'acqua', latte: 'latte', pane: 'pane', frutta_verdura: 'frutta e verdura', pasta_riso: 'pasta e riso', carne_pesce: 'carne e pesce', neonati: 'prodotti per neonati',
}
