import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Prodotto, Stato } from './db.ts'
import {
  comuniDelBollettino, finitoConfermato, numeriSpesa, spesaDelBollettino,
  type ColoreDistributore, type ComuneBollettino, type DistributoreBollettino, type NegozioBollettino,
} from './bollettino.ts'

const d = (comune: string | null, colore: ColoreDistributore, altro: Partial<DistributoreBollettino> = {}): DistributoreBollettino =>
  ({ comune, colore, confermato: false, ultimo: colore ? '2026-10-22T12:00:00.000Z' : null, lat: 40, lon: 15, ...altro })
const gruppi = (c: ComuneBollettino[]) => c.map((x) => [x.comune, x.gruppo])

test('senza carburante: nessun verde o giallo e almeno un rosso; chi non ha notizie non lo impedisce', () => {
  assert.deepEqual(gruppi(comuniDelBollettino([d('Eboli', 'rosso'), d('Eboli', null), d('Sarno', 'rosso'), d('Sarno', 'giallo')])),
    [['Eboli', 'senza_carburante'], ['Sarno', 'con_notizie']])
})

test('senza notizie: nessun distributore con stato (gli incerti arrivano con colore null)', () => {
  const [a] = comuniDelBollettino([d('Agropoli', null), d('Agropoli', null)])
  assert.deepEqual([a.gruppo, a.distributori, a.ultima], ['senza_notizie', 2, null])
})

test('confermato se almeno un finito del comune è confermato; fuori dai senza carburante vale false', () => {
  const c = comuniDelBollettino([d('Eboli', 'rosso'), d('Eboli', 'rosso', { confermato: true }), d('Sarno', 'rosso'),
    d('Salerno', 'rosso', { confermato: true }), d('Salerno', 'verde')])
  assert.deepEqual(c.map((x) => [x.comune, x.confermato]), [['Eboli', true], ['Sarno', false], ['Salerno', false]])
})

test('ordine: confermati, poi più finiti, poi notizia più recente; poi con notizie per distributori; poi senza notizie per nome', () => {
  const c = comuniDelBollettino([
    d('Sarno', 'rosso'), d('Eboli', 'rosso'), d('Eboli', 'rosso'), d('Sala Consilina', 'rosso', { confermato: true }),
    d('Pagani', 'rosso', { ultimo: '2026-10-22T13:00:00.000Z' }),
    d('Battipaglia', 'verde'), d('Salerno', 'verde'), d('Salerno', null), d('Salerno', null),
    d('Vietri sul Mare', null), d('Amalfi', null),
  ])
  assert.deepEqual(c.map((x) => x.comune), ['Sala Consilina', 'Eboli', 'Pagani', 'Sarno', 'Salerno', 'Battipaglia', 'Amalfi', 'Vietri sul Mare'])
})

test('a parità di tutto, i comuni senza carburante vanno in ordine alfabetico (non cambiano posto a ogni aggiornamento)', () => {
  assert.deepEqual(comuniDelBollettino([d('Sarno', 'rosso'), d('Amalfi', 'rosso')]).map((x) => x.comune), ['Amalfi', 'Sarno'])
})

test('conteggi, ultima notizia e posizione media del comune', () => {
  const [e] = comuniDelBollettino([d('Eboli', 'rosso', { lat: 40, lon: 15, ultimo: '2026-10-22T10:00:00.000Z' }),
    d('Eboli', 'verde', { lat: 41, lon: 16, ultimo: '2026-10-22T11:00:00.000Z' }), d('Eboli', null, { lat: 42, lon: 17 })])
  assert.deepEqual([e.distributori, e.verde, e.giallo, e.rosso, e.ultima, e.lat, e.lon], [3, 1, 0, 1, '2026-10-22T11:00:00.000Z', 41, 16])
})

test('senza comune non compaiono; grafie diverse dello stesso comune si uniscono', () => {
  const c = comuniDelBollettino([d(null, 'rosso'), d("Cava De' Tirreni", 'verde'), d("Cava De' Tirreni", 'verde'), d(" cava de' tirreni ", 'rosso')])
  assert.deepEqual(c.map((x) => [x.comune, x.distributori]), [["Cava De' Tirreni", 3]])
})

test('finito confermato: basta un carburante esaurito e affidabile', () => {
  assert.equal(finitoConfermato([{ stato: 'esaurito', affidabilita: 'affidabile' }, { stato: 'esaurito', affidabilita: 'da_confermare' }]), true)
  assert.equal(finitoConfermato([{ stato: 'esaurito', affidabilita: 'da_confermare' }]), false)
  assert.equal(finitoConfermato([{ stato: 'disponibile', affidabilita: 'affidabile' }]), false)
})

const n = (comune: string | null, ...beni: [Prodotto, Stato, boolean?][]): NegozioBollettino =>
  ({ comune, ultimo: null, beni: beni.map(([bene, stato, confermato = false]) => ({ bene, stato, confermato })) })

test('spesa: senza acqua se nessun negozio del comune ce l’ha e almeno uno l’ha finita; chi non ha notizie non lo impedisce', () => {
  assert.deepEqual(spesaDelBollettino([n('Afragola', ['acqua', 'esaurito']), n('Afragola', ['pane', 'disponibile'])]).beni,
    [{ bene: 'acqua', comuni: [{ comune: 'Afragola', confermato: false }] }])
  assert.deepEqual(spesaDelBollettino([n('Afragola', ['acqua', 'esaurito']), n('Afragola', ['acqua', 'scarso'])]).beni, [])
})
test('spesa: confermato se almeno un negozio l’ha finita con due persone d’accordo', () => {
  assert.equal(spesaDelBollettino([n('Casoria', ['pane', 'esaurito', true]), n('Casoria', ['pane', 'esaurito'])]).beni[0].comuni[0].confermato, true)
})
test('spesa: i beni nell’ordine di BENI; nei comuni prima i confermati, poi in ordine alfabetico', () => {
  const s = spesaDelBollettino([n('Pozzuoli', ['pane', 'esaurito']), n('Casoria', ['pane', 'esaurito']), n('Volla', ['pane', 'esaurito', true]), n('Volla', ['acqua', 'esaurito'])])
  assert.deepEqual(s.beni.map((b) => [b.bene, b.comuni.map((c) => c.comune)]), [['acqua', ['Volla']], ['pane', ['Volla', 'Casoria', 'Pozzuoli']]])
})
test('spesa: i negozi senza comune contano nei totali, non tra i comuni', () => {
  assert.deepEqual(spesaDelBollettino([n(null, ['acqua', 'esaurito']), n('Afragola'), n('Afragola', ['latte', 'disponibile'])]),
    { negozi: 3, con_notizie: 2, beni: [] })
})
test('spesa: i numeri per la fotografia oraria', () => {
  const s = spesaDelBollettino([n('Volla', ['acqua', 'esaurito', true], ['pane', 'esaurito']), n('Casoria', ['pane', 'esaurito'])])
  assert.deepEqual(numeriSpesa(s), { comuni_senza: 2, comuni_senza_confermati: 1, beni: { acqua: 1 } })
})
test('spesa: lo stesso comune scritto in modi diversi è uno solo, con la grafia più usata', () => {
  const s = spesaDelBollettino([n('Casoria', ['pane', 'esaurito']), n(' casoria ', ['latte', 'esaurito']), n('Casoria', ['acqua', 'esaurito'])])
  assert.deepEqual(s.beni.map((b) => b.comuni), Array(3).fill([{ comune: 'Casoria', confermato: false }]))
  assert.deepEqual(spesaDelBollettino([n('Casoria', ['pane', 'esaurito']), n(' casoria ', ['pane', 'scarso'])]).beni, [])
})
