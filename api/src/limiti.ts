// Limite di richieste per chiave (di solito l'IP) in una finestra scorrevole.
// Solo in memoria: niente su disco, e una chiave sparisce quando la finestra è passata.
export function creaLimite(max: number, finestraMs: number) {
  const colpi = new Map<string, number[]>()
  setInterval(() => {
    const limite = Date.now() - finestraMs
    for (const [k, v] of colpi) if (v[v.length - 1] <= limite) colpi.delete(k)
  }, 10 * 60 * 1000).unref()

  return (chiave: string, ora = Date.now()) => {
    const recenti = (colpi.get(chiave) ?? []).filter((t) => t > ora - finestraMs)
    const ok = recenti.length < max
    if (ok) recenti.push(ora)
    colpi.set(chiave, recenti)
    return ok
  }
}
