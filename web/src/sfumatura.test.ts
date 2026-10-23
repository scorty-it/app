import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sfumatura } from './sfumatura.ts'

const DESTRA = 'linear-gradient(to right, #000 calc(100% - 40px), transparent)'
const SINISTRA = 'linear-gradient(to right, transparent, #000 40px)'
const ENTRAMBE = 'linear-gradient(to right, transparent, #000 40px, #000 calc(100% - 40px), transparent)'

test('sfumatura: niente se tutto entra', () => {
  assert.equal(sfumatura({ scrollLeft: 0, clientWidth: 366, scrollWidth: 366 }), undefined)
})

test('sfumatura: a destra finché c’è altro da scorrere, a sinistra quando si è scorso', () => {
  assert.equal(sfumatura({ scrollLeft: 0, clientWidth: 358, scrollWidth: 601 }), DESTRA)
  assert.equal(sfumatura({ scrollLeft: 100, clientWidth: 358, scrollWidth: 601 }), ENTRAMBE)
  assert.equal(sfumatura({ scrollLeft: 243, clientWidth: 358, scrollWidth: 601 }), SINISTRA)
  assert.equal(sfumatura({ scrollLeft: 242.5, clientWidth: 358, scrollWidth: 601 }), SINISTRA) // mezzi pixel dello schermo
})
