// Un risultato ricalcolato al massimo una volta ogni `ms`, per chiave. Chi arriva mentre si calcola aspetta lo stesso
// calcolo: quando la cache scade durante uno sciopero non partono tanti calcoli uguali insieme. Gli errori non restano.
export function inCache<T>(ms: number, ora = Date.now) {
  const voci = new Map<string, { valore: Promise<T>; il: number }>()
  return (chiave: string, calcola: () => Promise<T>) => {
    const voce = voci.get(chiave)
    if (voce && ora() - voce.il <= ms) return voce.valore
    const valore = calcola()
    voci.set(chiave, { valore, il: ora() })
    valore.catch(() => voci.get(chiave)?.valore === valore && voci.delete(chiave))
    return valore
  }
}
