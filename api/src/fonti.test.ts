import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fonteDellaVisita, sitoDelWidget } from './fonti.ts'

// Valgono qualunque sia la regola scelta: le etichette che useremo davvero passano, il resto non entra nelle statistiche così com'è.

test('le etichette dei nostri link si contano così come sono', () => {
  for (const da of ['whatsapp', 'facebook', 'telegram', 'qr']) assert.equal(fonteDellaVisita(da), da)
})

test('senza etichetta, o con un’etichetta vuota, non si conta niente', () => {
  assert.equal(fonteDellaVisita(undefined), null)
  assert.equal(fonteDellaVisita(''), null)
  assert.equal(fonteDellaVisita('   '), null)
})

test('nelle statistiche finiscono solo lettere minuscole, cifre e trattini, al massimo 32', () => {
  for (const da of ['<script>alert(1)</script>', 'a b', 'fonte:altro', 'x'.repeat(64), 'whatsapp\n', 'perché', '../admin', 'WhatsApp']) {
    const f = fonteDellaVisita(da)
    if (f !== null) assert.match(f, /^[a-z0-9-]{1,32}$/, `«${da}» è diventata «${f}»`)
  }
})

test('widget: il sito che lo ospita è il suo dominio, senza www e senza maiuscole', () => {
  assert.equal(sitoDelWidget('www.IlMattino.it'), 'ilmattino.it')
  assert.equal(sitoDelWidget(' comune.napoli.it '), 'comune.napoli.it')
  assert.equal(sitoDelWidget('xn--citt-6oa.it'), 'xn--citt-6oa.it') // i domini con accenti arrivano già convertiti
})

test('widget: senza referrer il sito è «sconosciuto»; un dominio non valido non si conta', () => {
  assert.equal(sitoDelWidget(undefined), 'sconosciuto')
  assert.equal(sitoDelWidget(''), 'sconosciuto')
  for (const s of ['localhost', 'esempio.it:8080', 'https://esempio.it', '<script>.it', 'a..it', '-a.it', 'widget:altro.it', `${'a'.repeat(64)}.it`]) {
    assert.equal(sitoDelWidget(s), null, s)
  }
})
