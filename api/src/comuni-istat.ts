// I comuni dell'ISTAT, per scrivere il comune dei distributori con il nome ufficiale di oggi (comuni.ts).
// Si lancia a mano dalla macchina di sviluppo (serve `unzip`) quando l'ISTAT pubblica variazioni o Scorty copre
// regioni nuove: node src/comuni-istat.ts. Riscrive api/db/comuni-istat.json, da guardare nel diff prima del commit.
// Dati ISTAT con licenza CC BY 4.0.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ISTAT = 'https://www.istat.it/storage/codici-unita-amministrative/'
// ponytail: le variazioni in CSV arrivano a fine 2024 (dopo l'ISTAT pubblica solo l'xlsx). Una fusione più recente
// finisce tra i comuni non riconosciuti nel log dell'import; se capita spesso, il servizio SITUAS dell'ISTAT.
const VARIAZIONI = `${ISTAT}Variazioni-amministrative-e-territoriali-dal-1991.zip`
const ELENCO = `${ISTAT}Elenco-comuni-italiani.csv`
const AGENTE = 'Scorty/1.0 (https://scorty.it, mappa civica delle scorte)'

export interface TabelleComuni {
  attuali: Record<string, string[]> // sigla della provincia → comuni di oggi
  vecchi: Record<string, Record<string, string>> // sigla → nome vecchio (soppresso o cambiato dal 1991) → comune di oggi
  province: Record<string, string> // sigla → nome della provincia («Provincia di Salerno» negli avvisi)
  regioni: Record<string, string> // sigla → regione: gli avvisi vanno nel canale della regione (avvisi.ts)
}

// Punto e virgola tra i campi; tra virgolette possono esserci punti e virgola e a capo, "" è una virgoletta.
export function leggiCsv(testo: string) {
  const righe: string[][] = []
  let riga: string[] = []
  let campo = ''
  let virgolette = false
  const chiudiRiga = () => {
    riga.push(campo)
    if (riga.some(Boolean)) righe.push(riga)
    riga = []
    campo = ''
  }
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i]
    if (virgolette) {
      if (c === '"' && testo[i + 1] === '"') (campo += '"'), i++
      else if (c === '"') virgolette = false
      else campo += c
    } else if (c === '"') virgolette = true
    else if (c === ';') riga.push(campo), (campo = '')
    else if (c === '\n') chiudiRiga()
    else if (c !== '\r') campo += c
  }
  if (campo || riga.length) chiudiRiga()
  return righe
}

// Le colonne si cercano per nome (spazi e a capo non contano): se l'ISTAT cambia formato, meglio fermarsi.
function colonne<N extends string>(intestazione: string[], nomi: Record<N, string>) {
  const pulite = intestazione.map((h) => h.replace(/\s+/g, ' ').trim())
  const mancanti = Object.values<string>(nomi).filter((n) => !pulite.includes(n))
  if (mancanti.length) throw new Error(`ISTAT: mancano le colonne ${mancanti.map((n) => `«${n}»`).join(', ')}`)
  return Object.fromEntries(Object.entries<string>(nomi).map(([k, n]) => [k, pulite.indexOf(n)])) as Record<N, number>
}

const ordinate = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, 'it')))

export function tabelleComuni(elenco: string, variazioni: string): TabelleComuni {
  const [testa, ...comuni] = leggiCsv(elenco)
  const e = colonne(testa, {
    codice: 'Codice Comune formato alfanumerico', nome: 'Denominazione in italiano', sigla: 'Sigla automobilistica',
    uts: "Codice dell'Unità territoriale sovracomunale (valida a fini statistici)", regione: 'Denominazione Regione',
    provincia: "Denominazione dell'Unità territoriale sovracomunale (valida a fini statistici)",
  })
  const nomeDi = new Map(comuni.map((r) => [r[e.codice], r[e.nome].trim()]))
  const siglaDi = new Map(comuni.map((r) => [r[e.uts], r[e.sigla]]))
  const attuali: Record<string, string[]> = {}
  for (const r of comuni) (attuali[r[e.sigla]] ??= []).push(r[e.nome].trim())
  for (const nomi of Object.values(attuali)) nomi.sort((a, b) => a.localeCompare(b, 'it'))

  const [testaV, ...righe] = leggiCsv(variazioni)
  const v = colonne(testaV, {
    anno: 'Anno', tipo: 'Tipo variazione', uts: 'Codice Unità territoriale sovracomunale', codice: 'Codice Comune formato alfanumerico',
    nome: 'Denominazione Comune', dopo: 'Codice del Comune associato alla variazione o nuovo codice Istat del Comune',
  })
  const tipo = (r: string[]) => r[v.tipo].trim()
  // Dove è finito un codice: ES estinto dentro un altro comune, AP passato a un'altra provincia con un codice nuovo.
  // Un comune diviso tra più comuni ha più destinazioni: nessun comune di oggi unico.
  const destinazioni = new Map<string, Set<string>>()
  for (const r of righe) {
    if ((tipo(r) === 'ES' || tipo(r) === 'AP') && r[v.dopo].trim()) {
      destinazioni.set(r[v.codice], (destinazioni.get(r[v.codice]) ?? new Set()).add(r[v.dopo].trim()))
    }
  }
  const oggi = (codice: string) => {
    for (let passi = 0; passi < 20; passi++) {
      if (nomeDi.has(codice)) return nomeDi.get(codice)
      const dove = destinazioni.get(codice)
      if (dove?.size !== 1) return undefined
      codice = [...dove][0]
    }
  }
  // ES: il nome del comune estinto; CD: il nome di prima di un cambio. Tra due variazioni dello stesso nome vale l'ultima.
  const vecchi: Record<string, Record<string, string>> = {}
  for (const r of righe.toSorted((a, b) => +a[v.anno] - +b[v.anno])) {
    if (tipo(r) !== 'ES' && tipo(r) !== 'CD') continue
    const sigla = siglaDi.get(r[v.uts])
    const nome = r[v.nome].trim()
    const adesso = oggi(r[v.codice])
    if (sigla && adesso && adesso !== nome) (vecchi[sigla] ??= {})[nome] = adesso
  }
  return {
    attuali: ordinate(attuali),
    vecchi: ordinate(Object.fromEntries(Object.entries(vecchi).map(([s, n]) => [s, ordinate(n)]))),
    province: ordinate(Object.fromEntries(comuni.map((r) => [r[e.sigla], r[e.provincia].trim()]))),
    regioni: ordinate(Object.fromEntries(comuni.map((r) => [r[e.sigla], r[e.regione].trim()]))),
  }
}

if (process.argv[1] === import.meta.filename) {
  const scarica = async (url: string) => {
    const r = await fetch(url, { headers: { 'user-agent': AGENTE }, signal: AbortSignal.timeout(120_000) })
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  const testo = (b: Uint8Array) => new TextDecoder('windows-1252').decode(b)
  const cartella = await mkdtemp(join(tmpdir(), 'istat-'))
  try {
    const zip = join(cartella, 'variazioni.zip')
    await writeFile(zip, await scarica(VARIAZIONI))
    const t = tabelleComuni(testo(await scarica(ELENCO)), testo(execFileSync('unzip', ['-p', zip, '*.csv'])))
    // Una provincia per riga: nel diff si vede subito che cosa è cambiato.
    const righe = (o: object) => Object.entries(o).map(([k, x]) => `    ${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(',\n')
    await writeFile(new URL('../db/comuni-istat.json', import.meta.url),
      `{\n  "attuali": {\n${righe(t.attuali)}\n  },\n  "vecchi": {\n${righe(t.vecchi)}\n  },\n  "province": {\n${righe(t.province)}\n  },\n  "regioni": {\n${righe(t.regioni)}\n  }\n}\n`)
    const conta = (o: Record<string, object>) => Object.values(o).reduce((n, x) => n + Object.keys(x).length, 0)
    console.log(`comuni-istat.json: ${conta(t.attuali)} comuni di oggi, ${conta(t.vecchi)} nomi vecchi`)
  } finally {
    await rm(cartella, { recursive: true })
  }
}
