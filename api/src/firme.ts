import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// Token anonimo del dispositivo e sfida di calcolo per ottenerlo. Tutto firmato con il SEGRETO del server.

const b64 = (x: Buffer | string) => Buffer.from(x).toString('base64url')
const hmac = (segreto: string, testo: string) => createHmac('sha256', segreto).update(testo).digest()
const uguali = (firma: string, attesa: Buffer) => {
  const f = Buffer.from(firma, 'base64url')
  return f.length === attesa.length && timingSafeEqual(f, attesa)
}

// JWT HS256 minimo. L'header deve essere esattamente questo: niente alg "none" né altri algoritmi (RFC 8725).
const HEADER = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))

export function firmaToken(segreto: string, dispositivo: string) {
  const corpo = `${HEADER}.${b64(JSON.stringify({ sub: dispositivo, iat: Math.floor(Date.now() / 1000) }))}`
  return `${corpo}.${b64(hmac(segreto, corpo))}`
}

export function leggiToken(segreto: string, token: string): string | null {
  const [h, p, f, ...resto] = token.split('.')
  if (h !== HEADER || !p || !f || resto.length) return null
  if (!uguali(f, hmac(segreto, `${h}.${p}`))) return null
  try {
    const { sub } = JSON.parse(Buffer.from(p, 'base64url').toString())
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}

// Visitatori unici: al posto dell'identificativo del telefono un'impronta che vale per un solo giorno.
// Senza il segreto non si ricalcola, il giorno dopo lo stesso telefono ne ha un'altra, e non porta alle sue segnalazioni.
export const improntaVisitatore = (segreto: string, giorno: string, dispositivo: string) =>
  b64(hmac(segreto, `visitatore|${giorno}|${dispositivo}`)).slice(0, 22)

// Sfida: il telefono cerca un numero che, unito alla sfida, dia un hash SHA-256 con BIT zeri iniziali.
// ponytail: difficoltà fissa (~1-2 s su un telefono); da alzare se arrivano raffiche di dispositivi nuovi.
// Da sola non ferma un attacco da computer (lì il calcolo è molto più veloce): lavora insieme al limite per IP.
export const BIT = 15
const DURATA_SFIDA = 10 * 60 * 1000

export function nuovaSfida(segreto: string, ora = Date.now()) {
  const sfida = `${ora + DURATA_SFIDA}.${randomBytes(12).toString('hex')}`
  return { sfida, firma: b64(hmac(segreto, sfida)), bit: BIT }
}

export const scadenzaSfida = (sfida: string) => Number(sfida.split('.')[0])

export function zeriIniziali(h: Uint8Array) {
  let n = 0
  for (const b of h) {
    if (b) return n + Math.clz32(b) - 24
    n += 8
  }
  return n
}

export function sfidaRisolta(segreto: string, r: { sfida: string; firma: string; nonce: number }, ora = Date.now()) {
  return (
    uguali(r.firma, hmac(segreto, r.sfida)) &&
    scadenzaSfida(r.sfida) > ora &&
    zeriIniziali(createHash('sha256').update(r.sfida + r.nonce).digest()) >= BIT
  )
}
