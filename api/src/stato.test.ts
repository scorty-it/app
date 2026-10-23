import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fiducia, stimaArrivi, statoCoda, statoProdotto, type Opinione, type StatoProdotto } from './stato.ts'

const ORA = Date.parse('2026-10-22T12:00:00Z')
const fa = (min: number) => new Date(ORA - min * 60000)
let id = 1
const op = (dispositivo_id: string, stato: Opinione['stato'], min: number, altro: Partial<Opinione> = {}): Opinione => ({
  prodotto: 'gasolio', stato, afferma: true, dispositivo_id, il: fa(min), segnalazione_id: id++, a_distanza: false, ...altro,
})
const calcola = (ops: Opinione[], fiducie: Record<string, number> = {}) => statoProdotto(ops, new Map(Object.entries(fiducie)), ORA)!

test('una sola segnalazione è da confermare, due persone d’accordo la rendono affidabile', () => {
  assert.equal(calcola([op('a', 'disponibile', 5)]).affidabilita, 'da_confermare')
  const s = calcola([op('a', 'disponibile', 20), op('b', 'disponibile', 5)])
  assert.equal(s.affidabilita, 'affidabile')
  assert.equal(s.persone, 2)
})

test('ripetere dallo stesso telefono non aggiunge peso', () => {
  const s = calcola([op('a', 'disponibile', 30), op('a', 'disponibile', 20), op('a', 'disponibile', 5)])
  assert.equal(s.persone, 1)
  assert.equal(s.affidabilita, 'da_confermare')
})

test('il peso si dimezza ogni 3 ore: due persone di 2 ore fa contano più di una di adesso', () => {
  const s = calcola([op('a', 'disponibile', 120), op('b', 'disponibile', 120), op('c', 'esaurito', 0)])
  assert.equal(s.stato, 'disponibile')
})

test('affidabile solo con conferme delle ultime 4 ore: un verde vecchio resta da confermare', () => {
  assert.equal(calcola([op('a', 'disponibile', 360), op('b', 'disponibile', 300)]).affidabilita, 'da_confermare')
  assert.equal(calcola([op('a', 'disponibile', 300), op('b', 'disponibile', 30)]).affidabilita, 'da_confermare')
  assert.equal(calcola([op('a', 'disponibile', 200), op('b', 'disponibile', 30)]).affidabilita, 'affidabile')
})

test('la segnalazione recente prevale su una vecchia', () => {
  const s = calcola([op('a', 'disponibile', 180), op('b', 'esaurito', 5)])
  assert.equal(s.stato, 'esaurito')
  assert.equal(s.affidabilita, 'da_confermare')
})

test('segnalazioni contrastanti e smentite rendono lo stato incerto', () => {
  assert.equal(calcola([op('a', 'disponibile', 10), op('b', 'esaurito', 10)]).affidabilita, 'incerto')
  const smentita = calcola([op('a', 'disponibile', 10), op('b', 'disponibile', 5, { afferma: false })])
  assert.equal(smentita.affidabilita, 'incerto')
  assert.equal(smentita.smentite, 1)
  // Una smentita contro due conferme: resta affidabile, ma si vede
  const due = calcola([op('a', 'disponibile', 10), op('b', 'disponibile', 5), op('c', 'disponibile', 5, { afferma: false })])
  assert.equal(due.affidabilita, 'affidabile')
  assert.equal(due.smentite, 1)
})

test('le segnalazioni a distanza contano la metà', () => {
  const remote = (d: string) => op(d, 'disponibile', 10, { a_distanza: true })
  assert.equal(calcola([remote('a'), remote('b')]).affidabilita, 'da_confermare')
  assert.equal(calcola([remote('a'), remote('b')]).a_distanza, true)
  const conPosto = calcola([remote('a'), op('b', 'disponibile', 5)])
  assert.equal(conPosto.affidabilita, 'affidabile')
  assert.equal(conPosto.a_distanza, false)
})

test('due telefoni appena creati bastano, due screditati no', () => {
  const nuovo = fiducia({ eta_min: 5, conferme: 0, smentite: 0 })
  const screditato = fiducia({ eta_min: 600, conferme: 0, smentite: 6 })
  assert.equal(calcola([op('a', 'disponibile', 5), op('b', 'disponibile', 5)], { a: nuovo, b: nuovo }).affidabilita, 'affidabile')
  assert.equal(calcola([op('a', 'disponibile', 5), op('b', 'disponibile', 5)], { a: screditato, b: screditato }).affidabilita, 'da_confermare')
})

test('la fiducia sale con le conferme e scende con le smentite, entro dei limiti', () => {
  assert.equal(fiducia({ eta_min: 600, conferme: 0, smentite: 0 }), 1)
  assert.equal(fiducia({ eta_min: 600, conferme: 50, smentite: 0 }), 1.5)
  assert.equal(fiducia({ eta_min: 600, conferme: 0, smentite: 50 }), 0.25)
  // Tante segnalazioni, quasi tutte confermate: poche smentite non lo affossano
  assert.equal(fiducia({ eta_min: 600, conferme: 90, smentite: 4 }), 1.5)
})

test('rifornito: era finito ed è tornato disponibile', () => {
  assert.equal(calcola([op('a', 'esaurito', 90), op('b', 'disponibile', 10), op('c', 'disponibile', 5)]).rifornito, true)
  assert.equal(calcola([op('b', 'disponibile', 10)]).rifornito, false)
})

test('coda: vince il livello più recente e più sostenuto', () => {
  const c = (d: string, livello: 'nessuna' | 'breve' | 'lunga', min: number) => ({ dispositivo_id: d, livello, il: fa(min) })
  const s = statoCoda([c('a', 'nessuna', 55), c('b', 'lunga', 5), c('c', 'lunga', 10)], new Map(), ORA)!
  assert.equal(s.livello, 'lunga')
  assert.equal(s.persone, 2)
})

// Stime da «Ci vado» e schede aperte: campi a parte, non cambiano mai lo stato osservato.
const stima = (a: Partial<Parameters<typeof stimaArrivi>[0]> = {}) =>
  stimaArrivi({ tipo: 'negozio', ci_vado: 0, per_prodotto: {}, interesse: 0, coda: null, prodotti: [], ...a })
const prodotto = (p: StatoProdotto['prodotto'], stato: StatoProdotto['stato']) => ({ prodotto: p, stato }) as StatoProdotto

test('potrebbe finire: da 10 «Ci vado» sullo stesso prodotto, non prima', () => {
  assert.deepEqual(stima({ per_prodotto: { latte: 9 } }).potrebbe_finire, [])
  assert.deepEqual(stima({ per_prodotto: { latte: 10 } }).potrebbe_finire, ['latte'])
})

test('potrebbe finire: non per un prodotto già visto finito, né per un distributore', () => {
  assert.deepEqual(stima({ per_prodotto: { latte: 12 }, prodotti: [prodotto('latte', 'esaurito')] }).potrebbe_finire, [])
  assert.deepEqual(stima({ per_prodotto: { latte: 12 }, prodotti: [prodotto('latte', 'disponibile')] }).potrebbe_finire, ['latte'])
  assert.deepEqual(stima({ tipo: 'distributore', per_prodotto: { gasolio: 12 } }).potrebbe_finire, [])
})

test('potrebbe finire: un esaurito incerto non lo spegne, come per il «Ci vado» (409)', () => {
  const esaurito = (affidabilita: StatoProdotto['affidabilita']) => ({ prodotto: 'latte', stato: 'esaurito', affidabilita }) as StatoProdotto
  assert.deepEqual(stima({ per_prodotto: { latte: 12 }, prodotti: [esaurito('incerto')] }).potrebbe_finire, ['latte'])
  assert.deepEqual(stima({ per_prodotto: { latte: 12 }, prodotti: [esaurito('affidabile')] }).potrebbe_finire, [])
  assert.deepEqual(stima({ per_prodotto: { latte: 12 }, prodotti: [esaurito('da_confermare')] }).potrebbe_finire, [])
})

test('coda in aumento: un «Ci vado» pesa 2, una scheda aperta 1, soglia 10', () => {
  assert.equal(stima({ ci_vado: 5 }).coda_in_aumento, true)
  assert.equal(stima({ interesse: 10 }).coda_in_aumento, true)
  assert.equal(stima({ ci_vado: 4, interesse: 1 }).coda_in_aumento, false)
})

test('coda in aumento: una coda segnalata sul posto vince, anche «nessuna»', () => {
  assert.equal(stima({ ci_vado: 8, coda: { livello: 'nessuna' } }).coda_in_aumento, false)
  assert.equal(stima({ ci_vado: 8, coda: { livello: 'lunga' } }).coda_in_aumento, false)
})
