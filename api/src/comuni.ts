// Il comune di un distributore con il nome ufficiale dell'ISTAT di oggi: le fonti scrivono ancora comuni fusi
// («Rossano» per Corigliano-Rossano) e grafie loro («Pomigliano D'Arco»). Tabelle da comuni-istat.ts.
import { readFile } from 'node:fs/promises'
import type { TabelleComuni } from './comuni-istat.ts'

const tabelle: TabelleComuni = JSON.parse(await readFile(new URL('../db/comuni-istat.json', import.meta.url), 'utf8'))

// Senza accenti, maiuscole e punteggiatura, come scorty_norm; «j» vale «i» (Jonico, Ionico).
const chiave = (nome: string, provincia: string) =>
  `${nome.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/j/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim()}|${provincia}`

// Prima i nomi vecchi, poi quelli di oggi: un comune che esiste ancora vince su un nome vecchio uguale.
const comuni = new Map<string, string>()
for (const [p, nomi] of Object.entries(tabelle.vecchi)) for (const [vecchio, oggi] of Object.entries(nomi)) comuni.set(chiave(vecchio, p), oggi)
for (const [p, nomi] of Object.entries(tabelle.attuali)) for (const nome of nomi) comuni.set(chiave(nome, p), nome)

export function comuneUfficiale(comune: string | null, provincia: string | null) {
  return (comune && provincia && comuni.get(chiave(comune, provincia))) || null
}

export function comuniIgnoti(impianti: { comune: string | null; provincia: string | null }[]) {
  const ignoti = impianti.filter((i) => i.comune && !comuneUfficiale(i.comune, i.provincia)).map((i) => `${i.comune} (${i.provincia})`)
  return [...new Set(ignoti)].sort((a, b) => a.localeCompare(b, 'it'))
}

export const regioneDi = (sigla: string): string | null => tabelle.regioni[sigla] ?? null
export const nomeProvincia = (sigla: string): string | null => tabelle.province[sigla] ?? null
