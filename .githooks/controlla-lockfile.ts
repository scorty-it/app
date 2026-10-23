// Ogni pacchetto di un package-lock.json deve arrivare dal registro ufficiale di npm, con il suo nome e la sua versione.
// npm ci scarica da qualsiasi "resolved" e confronta l'integrity scritta nello stesso file: senza questo controllo una
// modifica al lockfile porta in produzione codice preso da un altro indirizzo o da un altro pacchetto.
// Si legge il file con JSON.parse come fa npm, così una chiave ripetuta vale qui come lì. Chiave e versione devono essere
// un nome e una versione veri: npm normalizza percorsi e URL (.., #), e un confronto tra stringhe da solo non basta.
// Uso: node .githooks/controlla-lockfile.ts <package-lock.json>...   (- legge da stdin; il nome dopo serve nei messaggi)
import { readFileSync } from 'node:fs'

type Pacchetto = { version?: string; resolved?: string; link?: boolean }

// Un segmento di nome npm: niente punto o trattino basso all'inizio, niente / # ? % \ (le maiuscole esistono nei nomi vecchi).
const SEGMENTO = '[A-Za-z0-9~-][A-Za-z0-9._~-]*'
const NOME = `(?:@${SEGMENTO}/)?${SEGMENTO}`
const CHIAVE = new RegExp(`^node_modules/${NOME}(?:/node_modules/${NOME})*$`)
const VERSIONE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const REGISTRO = 'https://registry.npmjs.org'

function problema(percorso: string, p: Pacchetto): string | null {
  // "inBundle" non salta niente: con i lockfile v2/v3 npm lo ignora e scarica comunque dal resolved.
  if (p.link) return 'collegamento locale'
  if (!CHIAVE.test(percorso)) return 'chiave che non è un nome di pacchetto'
  if (!p.version || !VERSIONE.test(p.version)) return `versione non valida: ${p.version}`
  const nome = percorso.slice(percorso.lastIndexOf('node_modules/') + 'node_modules/'.length)
  const percorsoAtteso = `/${nome}/-/${nome.split('/').pop()}-${p.version}.tgz`
  let url: URL
  try {
    url = new URL(p.resolved ?? '')
  } catch {
    return `resolved non valido: ${p.resolved ?? 'mancante'}`
  }
  const ok = url.origin === REGISTRO && url.pathname === percorsoAtteso && !url.search && !url.hash && url.href === p.resolved
  return ok ? null : `${p.resolved} invece di ${REGISTRO}${percorsoAtteso}`
}

export function problemiLockfile(testo: string): string[] {
  const lock = JSON.parse(testo) as { lockfileVersion?: number; packages?: Record<string, Pacchetto> }
  if (!lock.packages || (lock.lockfileVersion ?? 0) < 2) return ['formato vecchio: rigeneralo con npm 7 o più recente']
  const problemi: string[] = []
  for (const [percorso, p] of Object.entries(lock.packages)) {
    if (percorso === '') continue // la radice: il progetto stesso
    const errore = problema(percorso, p)
    if (errore) problemi.push(`${percorso}: ${errore}`)
  }
  return problemi
}

let ok = true
const argomenti = process.argv.slice(2)
for (let i = 0; i < argomenti.length; i++) {
  const stdin = argomenti[i] === '-'
  const nome = stdin ? (argomenti[++i] ?? 'stdin') : argomenti[i]
  let problemi: string[]
  try {
    problemi = problemiLockfile(readFileSync(stdin ? 0 : nome, 'utf8'))
  } catch (e) {
    problemi = [`illeggibile: ${(e as Error).message}`]
  }
  for (const p of problemi) console.error(`${nome}: ${p}`)
  if (problemi.length) ok = false
}
process.exit(ok ? 0 : 1)
