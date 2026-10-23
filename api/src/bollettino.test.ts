import assert from 'node:assert/strict'
import { test } from 'node:test'
import { comuniDelBollettino, finitoConfermato, type ColoreDistributore, type ComuneBollettino, type DistributoreBollettino } from './bollettino.ts'

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
