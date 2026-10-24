// I confini dei comuni dell'ISTAT, per mettere ogni negozio nel comune giusto (dalle sue coordinate).
// Si lancia a mano dalla macchina di sviluppo (serve `unzip`) quando l'ISTAT pubblica confini nuovi o Scorty copre
// regioni nuove: node src/confini.ts. Riscrive api/db/confini-comuni.json, da guardare nel diff prima del commit.
// Dati ISTAT con licenza CC BY 4.0.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Confini generalizzati al 1° gennaio 2025. Nonostante «WGS84» nel nome dei file, le coordinate sono in metri,
// UTM 32N (EPSG:32632).
const URL_CONFINI = 'https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2025/Limiti01012025_g.zip'
// I codici ISTAT delle regioni coperte: le stesse di web/src/province.ts (Campania, Puglia, Basilicata, Calabria, Sicilia).
const REGIONI_ISTAT = ['15', '16', '17', '18', '19']
const AGENTE = 'Scorty/1.0 (https://scorty.it, mappa civica delle scorte)'

export interface ConfineComune {
  codice: string // PRO_COM_T, il codice ISTAT del comune a sei cifre
  comune: string
  provincia: string // sigla
  anelli: [number, number][][] // UTM 32N, metri interi; i buchi sono anelli come gli altri
}

export interface FileConfini {
  fonte: string
  versione: string
  srid: 32632
  comuni: ConfineComune[]
}

const testo = new TextDecoder('utf-8')

// ponytail: un record cancellato (primo byte «*») si legge come gli altri, perché lo shp ha comunque la sua forma
// e le righe devono restare allineate per posizione. Se l'ISTAT cominciasse a pubblicarne, filtrarli qui insieme alla forma.
export function leggiDbf(dati: Uint8Array): Record<string, string>[] {
  if (dati.length < 33) throw new Error('dbf: file troppo corto')
  const v = new DataView(dati.buffer, dati.byteOffset, dati.byteLength)
  const righe = v.getUint32(4, true)
  const lunghezzaTesta = v.getUint16(8, true)
  const lunghezzaRecord = v.getUint16(10, true)
  if (lunghezzaTesta < 33 || lunghezzaTesta > dati.length || lunghezzaRecord < 1 || lunghezzaTesta + righe * lunghezzaRecord > dati.length) {
    throw new Error('dbf: intestazione non valida o file troncato')
  }
  const pulisci = (b: Uint8Array) => testo.decode(b).replace(/^[\s\0]+|[\s\0]+$/g, '')
  // Un descrittore da 32 byte per campo: nome (11 byte), tipo, indirizzo, larghezza in byte. Il fondo è 0x0D.
  const campi: { nome: string; da: number; a: number }[] = []
  let da = 1
  for (let p = 32; p + 32 <= lunghezzaTesta - 1 && dati[p] !== 0x0d; p += 32) {
    const larghezza = dati[p + 16]
    campi.push({ nome: pulisci(dati.subarray(p, p + 11)), da, a: da + larghezza })
    da += larghezza
  }
  if (da > lunghezzaRecord) throw new Error('dbf: i campi non stanno nel record')
  return Array.from({ length: righe }, (_, r) => {
    const inizio = lunghezzaTesta + r * lunghezzaRecord
    return Object.fromEntries(campi.map((c) => [c.nome, pulisci(dati.subarray(inizio + c.da, inizio + c.a))]))
  })
}

// Per ogni record dello shp i suoi anelli, divisi secondo le «parts». Solo poligoni (tipo 5) e forme nulle (tipo 0, nessun
// anello: la posizione resta). Gli anelli restano come sono nel file: ordine e verso non si toccano.
export function leggiShp(dati: Uint8Array): [number, number][][][] {
  if (dati.length < 100) throw new Error('shp: file troppo corto')
  const v = new DataView(dati.buffer, dati.byteOffset, dati.byteLength)
  if (v.getInt32(0) !== 9994) throw new Error('shp: non è uno shapefile')
  const fine = v.getInt32(24) * 2 // lunghezza del file in parole da 16 bit
  if (fine < 100 || fine > dati.length) throw new Error('shp: file troncato')
  const forme: [number, number][][][] = []
  let p = 100
  while (p < fine) {
    if (p + 12 > fine) throw new Error('shp: record fuori dal file')
    const lunghezza = v.getInt32(p + 4) * 2
    const inizio = p + 8
    if (lunghezza < 4 || inizio + lunghezza > fine) throw new Error('shp: record fuori dal file')
    const tipo = v.getInt32(inizio, true)
    if (tipo === 0) forme.push([])
    else if (tipo !== 5) throw new Error(`shp: tipo di forma ${tipo} non gestito (solo poligoni)`)
    else {
      if (lunghezza < 44) throw new Error('shp: record fuori dal file')
      const numParts = v.getInt32(inizio + 36, true)
      const numPoints = v.getInt32(inizio + 40, true)
      if (numParts < 0 || numPoints < 0 || 44 + 4 * numParts + 16 * numPoints > lunghezza) throw new Error('shp: record fuori dal file')
      const punti = inizio + 44 + 4 * numParts
      const parti = Array.from({ length: numParts }, (_, i) => v.getInt32(inizio + 44 + 4 * i, true))
      forme.push(parti.map((da, i) => {
        const a = parti[i + 1] ?? numPoints
        if (da < 0 || a < da || a > numPoints) throw new Error('shp: parti non valide')
        return Array.from({ length: a - da }, (_, k): [number, number] => [v.getFloat64(punti + 16 * (da + k), true), v.getFloat64(punti + 16 * (da + k) + 8, true)])
      }))
    }
    p = inizio + lunghezza
  }
  return forme
}

// comuni e forme vanno in parallelo (la riga n del dbf è il record n dello shp). Si tengono i comuni delle regioni
// coperte, con la sigla presa dalle province tramite COD_UTS e le coordinate arrotondate al metro.
export function confiniCoperti(comuni: Record<string, string>[], province: Record<string, string>[], forme: [number, number][][][], regioni: string[]): ConfineComune[] {
  if (forme.length !== comuni.length) throw new Error(`confini: ${comuni.length} comuni nel dbf ma ${forme.length} forme nello shp`)
  // Se l'ISTAT rinomina un campo, meglio fermarsi che scrivere un file vuoto.
  const servono = (righe: Record<string, string>[], nomi: string[]) => {
    const mancanti = nomi.filter((n) => righe.length && !(n in righe[0]))
    if (mancanti.length) throw new Error(`confini: mancano i campi ${mancanti.join(', ')}`)
  }
  servono(comuni, ['COD_REG', 'COD_UTS', 'PRO_COM_T', 'COMUNE'])
  servono(province, ['COD_UTS', 'SIGLA'])
  const siglaDi = new Map(province.map((r) => [r.COD_UTS, r.SIGLA]))
  return comuni.flatMap((c, i) => {
    if (!regioni.includes(c.COD_REG)) return []
    const provincia = siglaDi.get(c.COD_UTS)
    if (!provincia) throw new Error(`confini: nessuna provincia per ${c.COMUNE} (COD_UTS ${c.COD_UTS})`)
    const anelli = forme[i].map((anello) => anello.map(([x, y]): [number, number] => [Math.round(x), Math.round(y)]))
    return [{ codice: c.PRO_COM_T, comune: c.COMUNE, provincia, anelli }]
  })
}

if (process.argv[1] === import.meta.filename) {
  const cartella = await mkdtemp(join(tmpdir(), 'confini-'))
  try {
    const r = await fetch(URL_CONFINI, { headers: { 'user-agent': AGENTE }, signal: AbortSignal.timeout(300_000) })
    if (!r.ok) throw new Error(`${URL_CONFINI}: HTTP ${r.status}`)
    const zip = join(cartella, 'confini.zip')
    await writeFile(zip, Buffer.from(await r.arrayBuffer()))
    // Lo zip è un dato non fidato: i tre file si leggono per nome con `unzip -p`, senza estrarre niente su disco.
    const apri = (nome: string) => new Uint8Array(execFileSync('unzip', ['-p', zip, nome], { maxBuffer: 256 * 1024 * 1024 }))
    const comuni = leggiDbf(apri('*/Com01012025_g_WGS84.dbf'))
    const province = leggiDbf(apri('*/ProvCM01012025_g_WGS84.dbf'))
    const forme = leggiShp(apri('*/Com01012025_g_WGS84.shp'))
    const coperti = confiniCoperti(comuni, province, forme, REGIONI_ISTAT).sort((a, b) => (a.codice < b.codice ? -1 : a.codice > b.codice ? 1 : 0))
    if (!coperti.length) throw new Error('confini: nessun comune nelle regioni coperte')
    const file: FileConfini = { fonte: URL_CONFINI, versione: '2025-01-01', srid: 32632, comuni: coperti }
    const json = JSON.stringify(file)
    await writeFile(new URL('../db/confini-comuni.json', import.meta.url), json + '\n')
    const punti = coperti.reduce((n, c) => n + c.anelli.reduce((m, a) => m + a.length, 0), 0)
    console.log(`confini-comuni.json: ${coperti.length} comuni, ${punti} punti, ${(json.length / 1e6).toFixed(1)} MB`)
  } finally {
    await rm(cartella, { recursive: true })
  }
}
