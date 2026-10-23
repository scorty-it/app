import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { BIT, firmaToken, improntaVisitatore, leggiToken, nuovaSfida, sfidaRisolta, zeriIniziali } from './firme.ts'

const SEGRETO = 'x'.repeat(32)
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')

test('il token del dispositivo si legge solo se integro e firmato con HS256', () => {
  const t = firmaToken(SEGRETO, 'abc')
  assert.equal(leggiToken(SEGRETO, t), 'abc')
  assert.equal(leggiToken('y'.repeat(32), t), null)
  const [h, , f] = t.split('.')
  assert.equal(leggiToken(SEGRETO, `${h}.${b64({ sub: 'altro' })}.${f}`), null)
  assert.equal(leggiToken(SEGRETO, `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'abc' })}.`), null)
})

function risolvi(sfida: string) {
  for (let n = 0; ; n++) if (zeriIniziali(createHash('sha256').update(sfida + n).digest()) >= BIT) return n
}

test('la sfida vale solo risolta, firmata e non scaduta', () => {
  const s = nuovaSfida(SEGRETO)
  const nonce = risolvi(s.sfida)
  assert.equal(sfidaRisolta(SEGRETO, { ...s, nonce }), true)
  assert.equal(sfidaRisolta(SEGRETO, { ...s, nonce, firma: nuovaSfida(SEGRETO).firma }), false)
  assert.equal(sfidaRisolta(SEGRETO, { ...s, nonce }, Date.now() + 11 * 60 * 1000), false)
  const sbagliato = [...Array(50).keys()].find((n) => zeriIniziali(createHash('sha256').update(s.sfida + n).digest()) < BIT)!
  assert.equal(sfidaRisolta(SEGRETO, { ...s, nonce: sbagliato }), false)
})

test('impronta dei visitatori: stessa per telefono e giorno, diversa il giorno dopo, senza l’identificativo dentro', () => {
  const id = '6f1c0b9e-1f2a-4c3b-9d8e-7a6b5c4d3e2f'
  const oggi = improntaVisitatore(SEGRETO, '2026-10-22', id)
  assert.equal(improntaVisitatore(SEGRETO, '2026-10-22', id), oggi)
  assert.notEqual(improntaVisitatore(SEGRETO, '2026-10-23', id), oggi)
  assert.notEqual(improntaVisitatore(SEGRETO, '2026-10-22', '00000000-0000-0000-0000-000000000000'), oggi)
  assert.notEqual(improntaVisitatore('y'.repeat(32), '2026-10-22', id), oggi) // senza il segreto non si ricalcola
  assert.doesNotMatch(oggi, /[0-9a-f]{8}-/)
})
