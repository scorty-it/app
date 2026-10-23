import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alternative, aspetto, descriviSpillo } from './aspetto.ts'
import { nomeIcona } from './icone.ts'
import { marchioNoto, type Punto, type StatoProdotto, type StatoPunto } from './tipi.ts'

const ORA = Date.parse('2026-10-21T12:00:00Z')
const fa = (min: number) => new Date(ORA - min * 60000).toISOString()
const riga = (r: Partial<StatoProdotto>): StatoProdotto => ({
  prodotto: 'gasolio', stato: 'disponibile', affidabilita: 'affidabile', persone: 2, smentite: 0, ultimo: fa(10), segnalazione_id: 1, ...r,
})
const stato = (prodotti: StatoProdotto[], altro: Partial<StatoPunto> = {}): StatoPunto => ({ punto_id: 1, tipo: 'distributore', prodotti, coda: null, interesse: 0, arrivi: 0, arrivi_per: {}, stima: { coda_in_aumento: false, potrebbe_finire: [] }, calcolato_il: ORA, ...altro })

test('senza dati il marker è grigio', () => {
  assert.equal(aspetto(undefined, null, ORA).colore, 'grigio')
  assert.equal(aspetto(stato([]), null, ORA).colore, 'grigio')
})

test('senza filtro: tutto disponibile verde, tutto finito rosso, misto giallo', () => {
  const benzina = riga({ prodotto: 'benzina' })
  assert.equal(aspetto(stato([benzina, riga({})]), null, ORA).colore, 'verde')
  assert.equal(aspetto(stato([riga({ stato: 'esaurito' })]), null, ORA).colore, 'rosso')
  assert.equal(aspetto(stato([benzina, riga({ stato: 'esaurito' })]), null, ORA).colore, 'giallo')
})

test('con filtro conta solo quel prodotto', () => {
  const s = stato([riga({ prodotto: 'benzina' }), riga({ stato: 'esaurito' })])
  assert.equal(aspetto(s, 'gasolio', ORA).colore, 'rosso')
  assert.equal(aspetto(s, 'gpl', ORA).colore, 'grigio')
})

test('da confermare è vuoto, oltre un’ora è sbiadito, solo incerti mostra ?', () => {
  assert.equal(aspetto(stato([riga({ persone: 1, affidabilita: 'da_confermare' })]), null, ORA).pieno, false)
  assert.equal(aspetto(stato([riga({ ultimo: fa(61) })]), null, ORA).vecchio, true)
  const a = aspetto(stato([riga({ affidabilita: 'incerto' })]), null, ORA)
  assert.equal(a.colore, 'grigio')
  assert.equal(a.incerto, true)
})

test('affollato con coda lunga o coda in aumento stimata dal server', () => {
  assert.equal(aspetto(stato([], { coda: { livello: 'lunga', persone: 1, ultimo: fa(5) } }), null, ORA).affollato, true)
  assert.equal(aspetto(stato([], { stima: { coda_in_aumento: true, potrebbe_finire: [] } }), null, ORA).affollato, true)
  // Decide il server: tante schede aperte da sole non bastano.
  assert.equal(aspetto(stato([], { interesse: 12 }), null, ORA).affollato, false)
})

test('alternative: niente finiti, incerti o lontani; affollati in fondo', () => {
  const p = (id: number, lon: number): Punto => ({ id, tipo: 'distributore', nome: `P${id}`, marchio: null, indirizzo: null, comune: null, lat: 40.85, lon, prodotti: ['gasolio'] })
  const qui = p(1, 14.25)
  const punti = [qui, p(2, 14.26), p(3, 14.27), p(4, 14.28), p(5, 14.29), p(6, 14.6)]
  const stati = new Map<number, StatoPunto>([
    [2, stato([riga({})], { stima: { coda_in_aumento: true, potrebbe_finire: [] } })], // vicinissimo ma con la coda in aumento
    [3, stato([riga({})])],
    [4, stato([riga({ stato: 'esaurito' })])],
    [5, stato([riga({ affidabilita: 'incerto' })])],
    [6, stato([riga({})])], // oltre 10 km
  ])
  assert.deepEqual(alternative(qui, 'gasolio', punti, stati).map((a) => a.punto.id), [3, 2])
})

test('il marchio del distributore si riconosce nei nomi di OpenStreetMap', () => {
  const m = (marchio: string | null, nome: string) => marchioNoto({ marchio, nome })
  assert.equal(m('Agip Eni', 'Agip Eni'), 'Eni')
  assert.equal(m('Enilive', 'Enilive'), 'Eni')
  assert.equal(m('Api-Ip', 'Api-Ip'), 'IP')
  assert.equal(m(null, 'Total Erg'), 'TotalErg')
  assert.equal(m('Pompe Bianche', 'Distributore'), 'Pompa bianca')
  assert.equal(m('Q8 Easy', 'Q8 Easy'), 'Q8')
  assert.equal(m(null, 'Gb Petroli'), '')
  assert.equal(m(null, 'Distributore Esposito'), '') // "esso" dentro una parola non conta
})

const negozio = (prodotti: StatoProdotto[]) => stato(prodotti, { tipo: 'negozio' })
const cat = (prodotto: StatoProdotto['prodotto'], r: Partial<StatoProdotto> = {}) => riga({ prodotto, ...r })

test('negozio senza filtro: colore pieno solo con almeno 3 categorie concordi', () => {
  assert.equal(aspetto(negozio([cat('acqua', { stato: 'esaurito' })]), null, ORA).colore, 'giallo')
  assert.equal(aspetto(negozio([cat('acqua'), cat('latte')]), null, ORA).colore, 'giallo')
  const finite = (['acqua', 'latte', 'pane'] as const).map((p) => cat(p, { stato: 'esaurito' }))
  assert.equal(aspetto(negozio(finite), null, ORA).colore, 'rosso')
  assert.equal(aspetto(negozio([cat('acqua'), cat('latte'), cat('pane')]), null, ORA).colore, 'verde')
  assert.equal(aspetto(negozio([cat('acqua'), cat('latte'), cat('pane', { stato: 'esaurito' })]), null, ORA).colore, 'giallo')
  assert.equal(aspetto(negozio([cat('acqua'), cat('latte'), cat('pane', { affidabilita: 'incerto' })]), null, ORA).colore, 'giallo')
})

test('negozio con filtro: una categoria finita è rossa', () => {
  assert.equal(aspetto(negozio([cat('latte', { stato: 'esaurito' }), cat('acqua')]), 'latte', ORA).colore, 'rosso')
})

test('distributore: un solo carburante finito resta rosso', () => {
  assert.equal(aspetto(stato([riga({ stato: 'esaurito' })]), null, ORA).colore, 'rosso')
})

test('la forma cambia il nome dell’icona', () => {
  const base = { colore: 'verde', incerto: false, pieno: true, affollato: false } as const
  assert.notEqual(nomeIcona({ ...base, forma: 'goccia' }), nomeIcona({ ...base, forma: 'quadrato' }))
})

test('lettore di schermo: il giallo di un negozio senza filtro non dice «scarso»', () => {
  const asp = aspetto(negozio([cat('acqua', { stato: 'esaurito' })]), null, ORA)
  const neg = { nome: 'Spesa', tipo: 'negozio' } as Punto
  assert.equal(asp.colore, 'giallo')
  assert.equal(descriviSpillo(neg, asp, null), 'Spesa: poche segnalazioni o miste')
  assert.equal(descriviSpillo(neg, asp, 'acqua'), 'Spesa: scarso o parziale')
  assert.equal(descriviSpillo({ ...neg, tipo: 'distributore' }, asp, null), 'Spesa: scarso o parziale')
})
