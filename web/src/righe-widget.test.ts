import assert from 'node:assert/strict'
import { test } from 'node:test'
import { passoAdattamento, righeIniziali, type Righe } from './righe-widget.ts'

const MASSIMI = { comuni: 8, beni: 7 }
const sta = (alti = { comuni: 70, beni: 60 }, aCapo: string[] = []) => ({ esce: false, alti, aCapo })
const nonSta = (alti = { comuni: 70, beni: 60 }, aCapo: string[] = []) => ({ esce: true, alti, aCapo })
const r = (altro: Partial<Righe> = {}): Righe => ({ comuni: 1, beni: 1, nomi: {}, chiusi: [], provato: null, ...altro })

test('si parte da una riga per elenco, o da nessuna se l’elenco è vuoto', () => {
  assert.deepEqual(righeIniziali(MASSIMI), r())
  assert.deepEqual(righeIniziali({ comuni: 0, beni: 7 }), r({ comuni: 0 }))
  assert.deepEqual(righeIniziali({ comuni: 3, beni: 0 }), r({ beni: 0 }))
})

test('se sta, una riga in più all’elenco più basso (a parità, i comuni) e si segna quale', () => {
  assert.deepEqual(passoAdattamento(r(), MASSIMI, sta({ comuni: 70, beni: 60 })), r({ beni: 2, provato: 'beni' }))
  assert.deepEqual(passoAdattamento(r(), MASSIMI, sta({ comuni: 60, beni: 60 })), r({ comuni: 2, provato: 'comuni' }))
})

test('una riga che non sta si toglie, e quell’elenco è finito', () => {
  const dopo = passoAdattamento(r({ comuni: 2, provato: 'comuni' }), MASSIMI, nonSta())
  assert.deepEqual(dopo, r({ comuni: 1, chiusi: ['comuni'] }))
})

test('se nemmeno il minimo sta, si toglie una riga dall’elenco più alto', () => {
  assert.deepEqual(passoAdattamento(r(), MASSIMI, nonSta({ comuni: 70, beni: 60 })), r({ comuni: 0, chiusi: ['comuni'] }))
  assert.deepEqual(passoAdattamento(r(), MASSIMI, nonSta({ comuni: 50, beni: 60 })), r({ beni: 0, chiusi: ['beni'] }))
  // un elenco già a zero righe non si può accorciare: tocca all'altro
  assert.deepEqual(passoAdattamento(r({ comuni: 0 }), MASSIMI, nonSta({ comuni: 70, beni: 60 })), r({ comuni: 0, beni: 0, chiusi: ['beni'] }))
})

test('un elenco finito non cresce più; uno al massimo nemmeno', () => {
  assert.deepEqual(passoAdattamento(r({ chiusi: ['comuni'] }), MASSIMI, sta({ comuni: 10, beni: 99 })), r({ beni: 2, chiusi: ['comuni'], provato: 'beni' }))
  assert.deepEqual(passoAdattamento(r({ comuni: 8 }), MASSIMI, sta({ comuni: 10, beni: 99 })), r({ comuni: 8, beni: 2, provato: 'beni' }))
})

test('quando non c’è altro da provare si pulisce la riga provata e poi ci si ferma', () => {
  const finito = r({ comuni: 8, beni: 7, provato: 'beni' })
  assert.deepEqual(passoAdattamento(finito, MASSIMI, sta()), r({ comuni: 8, beni: 7 }))
  assert.equal(passoAdattamento(r({ comuni: 8, beni: 7 }), MASSIMI, sta()), null)
  assert.equal(passoAdattamento(r({ comuni: 3, beni: 2, chiusi: ['comuni', 'beni'] }), MASSIMI, sta()), null)
  // niente da togliere nemmeno quando non sta: si lascia com'è (la zona taglia, ma il ciclo non gira a vuoto)
  assert.equal(passoAdattamento(r({ comuni: 0, beni: 0, chiusi: ['comuni', 'beni'] }), MASSIMI, nonSta()), null)
})

test('una riga di bene che va a capo perde un comune nominato, prima di ogni altra cosa', () => {
  const dopo = passoAdattamento(r({ beni: 3 }), MASSIMI, nonSta({ comuni: 70, beni: 99 }, ['pane']), 3)
  assert.deepEqual(dopo, r({ beni: 3, nomi: { pane: 2 } }))
  assert.deepEqual(passoAdattamento(r({ beni: 3, nomi: { pane: 2 } }), MASSIMI, sta({ comuni: 70, beni: 99 }, ['pane']), 3), r({ beni: 3, nomi: { pane: 1 } }))
})

test('con un solo comune nominato una riga che va a capo non si accorcia più', () => {
  const ferma = r({ beni: 3, nomi: { pane: 1 } })
  assert.deepEqual(passoAdattamento(ferma, MASSIMI, sta({ comuni: 70, beni: 99 }, ['pane']), 3), r({ beni: 3, nomi: { pane: 1 }, comuni: 2, provato: 'comuni' }))
  // se ce n'è un'altra che si può accorciare, tocca a quella
  assert.deepEqual(passoAdattamento(r({ beni: 3, nomi: { pane: 1 } }), MASSIMI, sta(undefined, ['pane', 'latte']), 3), r({ beni: 3, nomi: { pane: 1, latte: 2 } }))
})

// Una pagina finta: la zona è alta `altezza`, un elenco occupa titolo + righe (+ una riga di riassunto se ne mancano).
// Il ciclo deve fermarsi da solo, con tutto dentro, e con una riga in più che non ci starebbe.
function simula(altezza: number, massimi: { comuni: number; beni: number }) {
  const alto = (k: 'comuni' | 'beni', n: number) => 24 + 22 * n + (n < massimi[k] ? 22 : 0)
  const misure = (x: Righe) => {
    const alti = { comuni: alto('comuni', x.comuni), beni: alto('beni', x.beni) }
    return { esce: alti.comuni + alti.beni + 10 > altezza, alti, aCapo: [] }
  }
  let x = righeIniziali(massimi)
  let passi = 0
  for (let prossimo = passoAdattamento(x, massimi, misure(x)); prossimo; prossimo = passoAdattamento(x, massimi, misure(x))) {
    x = prossimo
    assert.ok(++passi < 60, 'il ciclo non si ferma')
  }
  return x
}

test('il ciclo si ferma da solo: tutto dentro, e una riga in più non ci starebbe', () => {
  for (const altezza of [120, 150, 180, 240, 300, 600]) {
    const x = simula(altezza, MASSIMI)
    const alti = (c: number, b: number) => 24 + 22 * c + (c < 8 ? 22 : 0) + 24 + 22 * b + (b < 7 ? 22 : 0) + 10
    if (x.comuni + x.beni > 0 && altezza >= alti(1, 1)) assert.ok(alti(x.comuni, x.beni) <= altezza, `altezza ${altezza}: sta`)
    if (altezza >= alti(1, 1)) {
      if (x.comuni < 8) assert.ok(alti(x.comuni + 1, x.beni) > altezza, `altezza ${altezza}: un comune in più non ci sta`)
      if (x.beni < 7) assert.ok(alti(x.comuni, x.beni + 1) > altezza, `altezza ${altezza}: un bene in più non ci sta`)
    }
  }
  // dove c'è posto per tutto, si mostra tutto
  const tutto = simula(600, MASSIMI)
  assert.equal(tutto.comuni, 8)
  assert.equal(tutto.beni, 7)
})
