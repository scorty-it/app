import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ETICHETTA, condividiTesto, conFonte } from './condividi.ts'
import { matriceQr } from './qr.ts'

const errore = (name: string) => new DOMException('no', name)

test('condivisione riuscita: non si copia niente', async () => {
  let copiato = false
  assert.equal(await condividiTesto('t', { share: async () => {}, copia: async () => void (copiato = true) }), 'condiviso')
  assert.equal(copiato, false)
})

test('chi annulla la condivisione non si ritrova il testo copiato', async () => {
  let copiato = false
  assert.equal(await condividiTesto('t', { share: async () => { throw errore('AbortError') }, copia: async () => void (copiato = true) }), 'annullato')
  assert.equal(copiato, false)
})

test('condivisione rifiutata dal browser: si copia negli appunti', async () => {
  let copiato = ''
  assert.equal(await condividiTesto('t', { share: async () => { throw errore('NotAllowedError') }, copia: async (x) => void (copiato = x) }), 'copiato')
  assert.equal(copiato, 't')
})

test('né condivisione né appunti: il testo va mostrato da copiare a mano', async () => {
  assert.equal(await condividiTesto('t', { copia: async () => { throw errore('NotAllowedError') } }), 'da_copiare')
  assert.equal(await condividiTesto('t', {}), 'da_copiare')
})

test('il link condiviso porta l’etichetta e tiene la zona della mappa', () => {
  assert.equal(conFonte('https://scorty.it/#12/40.6/14.27', ETICHETTA.zona), 'https://scorty.it/?da=zona#12/40.6/14.27')
  assert.equal(conFonte('https://scorty.it/province/SA', ETICHETTA.bollettino), 'https://scorty.it/province/SA?da=bollettino')
  assert.equal(conFonte('https://scorty.it/?da=vecchia', 'nuova'), 'https://scorty.it/?da=nuova')
})

test('il link del QR nel PDF sta nei 42 byte del QR, anche in sviluppo', () => {
  for (const origine of ['https://scorty.it', 'http://localhost:5173', 'http://127.0.0.1:8180']) {
    assert.ok(matriceQr(conFonte(`${origine}/province/BT`, ETICHETTA.qrPdf)), origine)
  }
})
