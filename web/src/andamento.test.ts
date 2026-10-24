import assert from 'node:assert/strict'
import { test } from 'node:test'
import { barreAndamento, conGrafico, fraseAndamento, titoloAndamento } from './andamento.ts'
import { comuniSenzaBeni } from './bollettino.ts'
import type { BollettinoProvincia, ComuneBollettino, FotografiaProvincia } from './dati.ts'

const ADESSO = '2026-10-22T15:40:00Z' // le 17:40 in Italia
const ORA = Date.parse('2026-10-22T15:00:00Z') // l'ora piena in corso

// Un bollettino con `adesso` comuni senza carburante e le fotografie di `ore` ore fa: [ore fa, comuni senza carburante].
function bollettino(adesso: number, fotografie?: [number, number][]): BollettinoProvincia {
  const comune = (i: number): ComuneBollettino => ({
    comune: `C${i}`, distributori: 1, verde: 0, giallo: 0, rosso: 1, ultima: null, lat: 40, lon: 14, gruppo: 'senza_carburante', confermato: false,
  })
  return {
    provincia: 'SA', aggiornato_il: ADESSO, distributori: 10, verde: 0, giallo: 0, rosso: adesso, lat: 40, lon: 14,
    comuni: Array.from({ length: adesso }, (_, i) => comune(i)),
    andamento: fotografie?.map(([oreFa, n]) => ({
      ora: new Date(ORA - oreFa * 3_600_000).toISOString(), comuni_senza: n, comuni_senza_confermati: 0, con_notizie: n, verde: 0, giallo: 0, rosso: n,
      spesa_comuni_senza: null, spesa_comuni_senza_confermati: null, // fotografie di prima della spesa
    })),
  }
}

test('andamento: 24 barre, una per ora; l’ultima è adesso, un’ora senza fotografia resta vuota', () => {
  const barre = barreAndamento(bollettino(4, [[23, 1], [2, 3], [0, 9]]))
  assert.equal(barre.length, 24)
  assert.deepEqual(barre.map((b) => b.comuni).slice(-3), [3, null, 4]) // la fotografia di quest'ora la sostituisce adesso
  assert.equal(barre[0].comuni, 1)
  assert.equal(barre[0].ora, '2026-10-21T16:00:00.000Z')
})

test('andamento: adesso contro 6 ore prima', () => {
  assert.equal(fraseAndamento(bollettino(4, [[6, 1]])), 'In peggioramento: 4 comuni senza carburante, alle 11:00 era 1')
  assert.equal(fraseAndamento(bollettino(2, [[6, 0]])), 'In peggioramento: 2 comuni senza carburante, alle 11:00 nessuno')
  assert.equal(fraseAndamento(bollettino(3, [[6, 3]])), 'Stabile: 3 comuni senza carburante, come alle 11:00')
  assert.equal(fraseAndamento(bollettino(0, [[6, 2]])), 'In miglioramento: nessun comune senza carburante, alle 11:00 erano 2')
})

test('andamento: se manca la fotografia di 6 ore fa vale quella prima', () => {
  assert.equal(fraseAndamento(bollettino(1, [[7, 4], [3, 2]])), 'In miglioramento: 1 comune senza carburante, alle 10:00 erano 4')
})

test('andamento: con meno di 6 ore di storia niente frase, ma il grafico sì', () => {
  const b = bollettino(3, [[2, 1]])
  assert.equal(fraseAndamento(b), null)
  assert.equal(conGrafico(b), true)
})

test('andamento: mai un comune senza carburante, solo la frase', () => {
  const giorno = bollettino(0, [[23, 0], [6, 0]])
  assert.equal(fraseAndamento(giorno), 'Nessun comune senza carburante nelle ultime 24 ore')
  assert.equal(conGrafico(giorno), false)
  // Storia più corta di un giorno: si dice da quando.
  assert.equal(fraseAndamento(bollettino(0, [[10, 0], [6, 0]])), 'Nessun comune senza carburante dalle 07:00')
})

test('andamento: senza fotografie (server non ancora aggiornato) niente frase e niente grafico', () => {
  assert.equal(fraseAndamento(bollettino(2)), null)
  assert.equal(conGrafico(bollettino(2)), false)
  assert.equal(conGrafico(bollettino(2, [])), false)
})

// Una provincia con `adesso` comuni senza acqua e le fotografie di `oreFa` ore fa: [ore fa, comuni senza beni o null (prima della spesa)].
// Alle 10:00 in Italia, così 6 ore prima sono le 04:00.
const ADESSO_SPESA = Date.parse('2026-10-23T08:00:00Z') // le 10:00 in Italia
function conSpesa(adesso: number, fotografie: [number, number | null][], carburante = 0): BollettinoProvincia {
  return {
    ...bollettino(carburante),
    aggiornato_il: '2026-10-23T08:40:00Z',
    spesa: { negozi: 30, con_notizie: 12, beni: adesso ? [{ bene: 'acqua', comuni: Array.from({ length: adesso }, (_, i) => ({ comune: `S${i}`, confermato: false })) }] : [] },
    andamento: fotografie.map(([oreFa, n]) => ({
      ora: new Date(ADESSO_SPESA - oreFa * 3_600_000).toISOString(), comuni_senza: 0, comuni_senza_confermati: 0, con_notizie: 0, verde: 0, giallo: 0, rosso: 0,
      spesa_comuni_senza: n, spesa_comuni_senza_confermati: n === null ? null : 0,
    })),
  }
}

test('barre della spesa: le fotografie senza spesa sono buchi, non zeri', () => {
  const b = conSpesa(2, [[23, null], [3, 5], [2, null], [1, 0], [0, 9]])
  const barre = barreAndamento(b, 'spesa')
  assert.equal(barre.length, 24)
  // Le 05:00 hanno 5, le 06:00 un buco dichiarato, le 07:00 uno zero vero; l'ultima è adesso, non la fotografia di quest'ora.
  assert.deepEqual(barre.map((x) => x.comuni).slice(-4), [5, null, 0, comuniSenzaBeni(b)])
  assert.equal(barre[23].comuni, 2)
  assert.equal(barre[0].comuni, null)
  assert.equal(barre[0].ora, '2026-10-22T09:00:00.000Z')
})

test('barre: il mondo sceglie la serie, senza mescolarle', () => {
  const b = conSpesa(2, [[3, 5]], 3) // 3 comuni senza carburante, 2 senza beni
  assert.equal(barreAndamento(b)[23].comuni, 3)
  assert.equal(barreAndamento(b, 'carburante')[23].comuni, 3)
  assert.equal(barreAndamento(b, 'spesa')[23].comuni, 2)
  assert.equal(barreAndamento(b, 'carburante')[20].comuni, 0) // la fotografia di quell'ora: 0 senza carburante…
  assert.equal(barreAndamento(b, 'spesa')[20].comuni, 5) // …e 5 senza beni
})

test('andamento della spesa: adesso contro 6 ore prima', () => {
  assert.equal(fraseAndamento(conSpesa(2, [[6, 0]]), 'spesa'), 'In peggioramento: 2 comuni senza beni, alle 04:00 nessuno')
  assert.equal(fraseAndamento(conSpesa(3, [[6, 3]]), 'spesa'), 'Stabile: 3 comuni senza beni, come alle 04:00')
  assert.equal(fraseAndamento(conSpesa(0, [[6, 2]]), 'spesa'), 'In miglioramento: nessun comune senza beni, alle 04:00 erano 2')
  assert.equal(fraseAndamento(conSpesa(1, [[7, 4], [3, 2]]), 'spesa'), 'In miglioramento: 1 comune senza beni, alle 03:00 erano 4')
})

test('andamento della spesa: mai un comune senza beni, solo la frase', () => {
  assert.equal(fraseAndamento(conSpesa(0, [[23, 0], [6, 0]]), 'spesa'), 'Nessun comune senza beni nelle ultime 24 ore')
  assert.equal(fraseAndamento(conSpesa(0, [[10, 0], [6, 0]]), 'spesa'), 'Nessun comune senza beni dalle 00:00')
  assert.equal(conGrafico(conSpesa(0, [[23, 0], [6, 0]]), 'spesa'), false)
})

test('andamento della spesa: le fotografie di prima della spesa non fanno frase, solo il grafico di adesso', () => {
  // Solo buchi più l'ora di adesso: non c'è un «prima» con cui confrontare.
  assert.equal(fraseAndamento(conSpesa(2, [[6, null], [3, null]]), 'spesa'), null)
  assert.equal(fraseAndamento(conSpesa(0, [[6, null]]), 'spesa'), null)
  assert.equal(conGrafico(conSpesa(2, [[6, null]]), 'spesa'), true) // adesso c'è già un comune senza beni
  assert.equal(conGrafico(conSpesa(0, [[6, null]]), 'spesa'), false)
})

test('andamento della spesa: con meno di 6 ore di storia niente frase, ma il grafico sì', () => {
  const b = conSpesa(3, [[2, 1]])
  assert.equal(fraseAndamento(b, 'spesa'), null)
  assert.equal(conGrafico(b, 'spesa'), true)
})

test('andamento della spesa: il grafico del carburante non la vede, e viceversa', () => {
  const soloSpesa = conSpesa(2, [[6, 1]]) // nessun comune senza carburante
  assert.equal(conGrafico(soloSpesa), false)
  assert.equal(conGrafico(soloSpesa, 'spesa'), true)
  assert.equal(fraseAndamento(soloSpesa), 'Nessun comune senza carburante dalle 04:00')
})

// Il server salva 0, non null, per le province senza notizie dai negozi: «nessun comune senza beni» sarebbe una bugia, sembrerebbe che vada tutto bene.
const senzaNotizieDaiNegozi = (b: BollettinoProvincia): BollettinoProvincia => ({ ...b, spesa: { negozi: 30, con_notizie: 0, beni: [] } })

test('andamento della spesa: senza notizie dai negozi niente frase, anche con le fotografie a zero', () => {
  assert.equal(fraseAndamento(senzaNotizieDaiNegozi(conSpesa(0, [[23, 0], [6, 0]])), 'spesa'), null) // altrimenti «nelle ultime 24 ore»
  assert.equal(fraseAndamento(senzaNotizieDaiNegozi(conSpesa(0, [[10, 0], [6, 0]])), 'spesa'), null) // altrimenti «dalle 00:00»
  assert.equal(fraseAndamento(senzaNotizieDaiNegozi(conSpesa(0, [[6, 0]])), 'spesa'), null)
  // Neanche il confronto con ore in cui c'erano notizie: adesso non si sa, non è «migliorato».
  assert.equal(fraseAndamento(senzaNotizieDaiNegozi(conSpesa(0, [[6, 2]])), 'spesa'), null)
})

test('barre della spesa: senza notizie dai negozi l’ora in corso è un buco, non uno zero', () => {
  const barre = barreAndamento(senzaNotizieDaiNegozi(conSpesa(0, [[3, 4], [1, 0]])), 'spesa')
  assert.deepEqual(barre.map((x) => x.comuni).slice(-4), [4, null, 0, null]) // le ore passate restano come sono
  assert.equal(barre[23].comuni, null)
})

test('grafico della spesa: senza notizie dai negozi si vede solo se nelle ore passate c’erano comuni senza beni', () => {
  assert.equal(conGrafico(senzaNotizieDaiNegozi(conSpesa(0, [[6, 2]])), 'spesa'), true) // buco in fondo, barre prima
  assert.equal(conGrafico(senzaNotizieDaiNegozi(conSpesa(0, [[23, 0], [6, 0]])), 'spesa'), false)
})

// Le fotografie orarie del server dicono quanti negozi avevano notizie (`spesa_con_notizie`): con zero, anche lo «zero comuni senza beni»
// di quell'ora è un buco. [ore fa, negozi con notizie in quell'ora].
const conNegozi = (b: BollettinoProvincia, perOra: [number, number | null][]): BollettinoProvincia => ({
  ...b,
  andamento: b.andamento!.map((f) => {
    const oreFa = Math.round((ADESSO_SPESA - Date.parse(f.ora)) / 3_600_000)
    return { ...f, spesa_con_notizie: perOra.find(([h]) => h === oreFa)?.[1] ?? null }
  }),
})

test('andamento della spesa: le ore senza notizie dai negozi sono buchi, non zeri', () => {
  const b = conNegozi(conSpesa(0, [[10, 0], [6, 0], [3, 0]]), [[10, 0], [6, 12], [3, 12]]) // alle 00:00 italiane nessun negozio con notizie
  const barre = barreAndamento(b, 'spesa')
  assert.equal(barre[13].comuni, null) // 10 ore fa: zero salvato, ma senza notizie dai negozi
  assert.equal(barre[17].comuni, 0) // 6 ore fa (04:00): zero vero
  assert.equal(barre[20].comuni, 0)
  assert.equal(barre[23].comuni, 0) // adesso, con notizie
  // La frase racconta da quando si sa: dalle 04:00, non dalle 00:00 quando il server non aveva notizie.
  assert.equal(fraseAndamento(b, 'spesa'), 'Nessun comune senza beni dalle 04:00')
})

test('andamento della spesa: se tutte le ore passate erano senza notizie non c’è storia da raccontare', () => {
  const b = conNegozi(conSpesa(0, [[23, 0], [6, 0]]), [[23, 0], [6, 0]])
  assert.equal(fraseAndamento(b, 'spesa'), null) // altrimenti «Nessun comune senza beni nelle ultime 24 ore»
  assert.equal(conGrafico(b, 'spesa'), false)
})

test('andamento della spesa: zero negozi con notizie vuol dire buco, qualunque numero abbia salvato il server', () => {
  const b = conNegozi(conSpesa(0, [[6, 3]]), [[6, 0]])
  assert.equal(barreAndamento(b, 'spesa')[17].comuni, null)
})

test('andamento della spesa: negozi con notizie, o un server di prima di questo dato, e il carburante', () => {
  // Con notizie lo zero è vero.
  const vero = conNegozi(conSpesa(0, [[6, 0]]), [[6, 5]])
  assert.equal(fraseAndamento(vero, 'spesa'), 'Nessun comune senza beni dalle 04:00')
  // `null` (fotografia di prima del dato) e campo assente (server vecchio) restano com'erano: lo zero è uno zero.
  const prima = conNegozi(conSpesa(0, [[6, 0]]), [[6, null]])
  assert.equal(fraseAndamento(prima, 'spesa'), 'Nessun comune senza beni dalle 04:00')
  assert.equal(fraseAndamento(conSpesa(0, [[6, 0]]), 'spesa'), 'Nessun comune senza beni dalle 04:00')
  // Il carburante non guarda i negozi.
  const senzaNegozi = conNegozi(conSpesa(0, [[6, 0]]), [[6, 0]])
  assert.equal(barreAndamento(senzaNegozi)[17].comuni, 0)
  assert.equal(fraseAndamento(senzaNegozi), 'Nessun comune senza carburante dalle 04:00')
})

test('andamento della spesa: con notizie dai negozi e un carburante invariato', () => {
  const b = conSpesa(0, [[6, 0]]) // con_notizie 12: lo zero è vero
  assert.equal(fraseAndamento(b, 'spesa'), 'Nessun comune senza beni dalle 04:00')
  assert.equal(barreAndamento(b, 'spesa')[23].comuni, 0)
  // Il carburante non guarda la spesa.
  const senzaNotizie = senzaNotizieDaiNegozi(conSpesa(0, [[6, 0]]))
  assert.equal(fraseAndamento(senzaNotizie), 'Nessun comune senza carburante dalle 04:00')
  assert.equal(barreAndamento(senzaNotizie)[23].comuni, 0)
})

test('andamento della spesa: un server vecchio, senza spesa, non ha né frase né grafico', () => {
  const vecchio = bollettino(2, [[6, 1]])
  vecchio.andamento = vecchio.andamento!.map(({ spesa_comuni_senza, spesa_comuni_senza_confermati, ...resto }) => resto as FotografiaProvincia)
  assert.equal(vecchio.spesa, undefined)
  assert.deepEqual(barreAndamento(vecchio, 'spesa').map((x) => x.comuni), Array(24).fill(null))
  assert.equal(fraseAndamento(vecchio, 'spesa'), null)
  assert.equal(conGrafico(vecchio, 'spesa'), false)
  assert.equal(fraseAndamento(vecchio), 'In peggioramento: 2 comuni senza carburante, alle 11:00 era 1') // il carburante non cambia
})

test('titolo del grafico: quello della spesa dice cosa conta, quello del carburante resta com’è', () => {
  assert.equal(titoloAndamento('carburante'), 'Ultime 24 ore')
  assert.equal(titoloAndamento('spesa'), 'Comuni senza beni, ultime 24 ore')
  assert.equal(titoloAndamento(), 'Ultime 24 ore')
})
