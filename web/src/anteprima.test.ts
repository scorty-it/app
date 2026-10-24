import { test } from 'node:test'
import assert from 'node:assert/strict'
import { descrizioneProvincia, robots, sitemap, testa, titoloProvincia } from './anteprima.ts'

const SITO = 'https://scorty.it'

test('la testa di una provincia ha il suo indirizzo canonico e l’anteprima con indirizzi assoluti', () => {
  const h = testa({ titolo: titoloProvincia('Salerno'), descrizione: 'x', sito: SITO, percorso: '/province/SA' })
  assert.match(h, /<title>Carburante e spesa in provincia di Salerno, oggi – Scorty<\/title>/)
  assert.match(h, /<link rel="canonical" href="https:\/\/scorty\.it\/province\/SA" \/>/)
  assert.match(h, /<meta property="og:url" content="https:\/\/scorty\.it\/province\/SA" \/>/)
  assert.match(h, /<meta property="og:image" content="https:\/\/scorty\.it\/anteprima\.png" \/>/)
})

test('titolo e descrizione di una provincia parlano di carburante e di spesa', () => {
  assert.equal(titoloProvincia('Salerno'), 'Carburante e spesa in provincia di Salerno, oggi – Scorty')
  assert.equal(
    descrizioneProvincia('Salerno'),
    'I comuni senza carburante o senza beni essenziali in provincia di Salerno, dalle segnalazioni di chi è sul posto. Con il bollettino da condividere.',
  )
})

test('la testa generica non ha canonical: index.html risponde anche alle altre pagine', () => {
  const h = testa({ titolo: 'Scorty', descrizione: 'x', sito: SITO })
  assert.doesNotMatch(h, /canonical|og:url/)
  assert.match(h, /og:image/)
})

test('virgolette e parentesi angolari non escono dagli attributi', () => {
  const h = testa({ titolo: 'a "b" <c>', descrizione: 'd & "e"', sito: SITO })
  assert.match(h, /<title>a &quot;b&quot; &lt;c&gt;<\/title>/)
  assert.match(h, /content="d &amp; &quot;e&quot;"/)
})

test('robots.txt indica la sitemap, la sitemap gli indirizzi completi', () => {
  assert.match(robots(SITO), /^Sitemap: https:\/\/scorty\.it\/sitemap\.xml$/m)
  const s = sitemap(SITO, ['/', '/province/SA'])
  assert.match(s, /<loc>https:\/\/scorty\.it\/<\/loc>/)
  assert.match(s, /<loc>https:\/\/scorty\.it\/province\/SA<\/loc>/)
})
