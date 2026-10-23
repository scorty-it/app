import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codiceIframe, dominioDi, siglaDelWidget } from './incorpora.ts'

test('incorpora: il codice da incollare, nell’articolo e nella barra laterale', () => {
  assert.equal(
    codiceIframe('https://scorty.it', 'SA', 'Salerno', 'articolo'),
    '<iframe src="https://scorty.it/widget/province/SA" title="Carburante in provincia di Salerno – Scorty" width="100%" height="480" style="border:0;max-width:640px" loading="lazy"></iframe>',
  )
  assert.equal(
    codiceIframe('https://scorty.it', 'BT', 'Barletta-Andria-Trani', 'laterale'),
    '<iframe src="https://scorty.it/widget/province/BT" title="Carburante in provincia di Barletta-Andria-Trani – Scorty" width="300" height="600" style="border:0" loading="lazy"></iframe>',
  )
})

test('incorpora: le virgolette in un nome non rompono il codice', () => {
  assert.match(codiceIframe('https://scorty.it', 'AQ', 'Città "nuova"', 'laterale'), /title="Carburante in provincia di Città &quot;nuova&quot; – Scorty"/)
})

test('widget: il dominio del sito che lo ospita, dal referrer', () => {
  assert.equal(dominioDi('https://www.ilmattino.it/napoli/cronaca/articolo-123?x=1'), 'www.ilmattino.it')
  assert.equal(dominioDi('https://comune.salerno.it/'), 'comune.salerno.it')
  assert.equal(dominioDi(''), '') // il sito non lo dice: per il server è «sconosciuto»
  assert.equal(dominioDi('non è un indirizzo'), '')
})

test('widget: la sigla della provincia dall’indirizzo', () => {
  assert.equal(siglaDelWidget('/widget/province/SA'), 'SA')
  assert.equal(siglaDelWidget('/widget/province/sa'), 'SA')
  assert.equal(siglaDelWidget('/widget/province/'), null)
  assert.equal(siglaDelWidget('/widget/province/SALERNO'), null)
})
