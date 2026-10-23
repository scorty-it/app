import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aCapo, adatta, browserInterno, finitiSu, fraseVuota, indirizzoBollettino, momento, nomeFile, oraNotizia, primi, testoBollettino, valoreIndicatore } from './bollettino.ts'
import type { BollettinoProvincia, ComuneBollettino } from './dati.ts'

const c = (comune: string, gruppo: ComuneBollettino['gruppo'], confermato = false): ComuneBollettino =>
  ({ comune, gruppo, confermato, distributori: 3, verde: 0, giallo: 0, rosso: 1, ultima: null, lat: 0, lon: 0 })
const b = (altro: Partial<BollettinoProvincia> = {}): BollettinoProvincia => ({
  provincia: 'SA', aggiornato_il: '2026-10-22T13:30:00.000Z', distributori: 385, verde: 58, giallo: 21, rosso: 17, lat: 40.6, lon: 15,
  comuni: [c('Eboli', 'senza_carburante', true), c('Sarno', 'senza_carburante'), c('Sala Consilina', 'senza_carburante'), c('Salerno', 'con_notizie')],
  ...altro,
})

test('data e ora nel fuso di Roma', () => {
  assert.deepEqual(momento('2026-10-22T13:30:00.000Z'), { giorno: 'giovedì 22 ottobre 2026', ora: '15:30' })
})

test('testo pronto da incollare', () => {
  assert.equal(testoBollettino(b(), 'Salerno', 'https://scorty.it/province/SA'), [
    'Carburante in provincia di Salerno, giovedì 22 ottobre 2026 ore 15:30',
    '✓ 58 con carburante · – 21 scarso · ✕ 17 finito (96 distributori su 385 con notizie nelle ultime 24 ore)',
    'Comuni senza carburante: Eboli, Sarno (da confermare), Sala Consilina (da confermare).',
    'Situazione aggiornata: https://scorty.it/province/SA',
  ].join('\n'))
})

test('senza comuni senza carburante, e senza nessuna notizia', () => {
  const nessuno = b({ comuni: [c('Salerno', 'con_notizie')] })
  assert.equal(fraseVuota(nessuno), 'Nessun comune risulta senza carburante')
  assert.match(testoBollettino(nessuno, 'Salerno', 'u'), /\nNessun comune risulta senza carburante\.\n/)
  const vuoto = b({ verde: 0, giallo: 0, rosso: 0, comuni: [c('Salerno', 'senza_notizie')] })
  assert.equal(fraseVuota(vuoto), 'Nessuna notizia nelle ultime 24 ore')
  assert.equal(valoreIndicatore(vuoto), null)
  assert.equal(testoBollettino(vuoto, 'Salerno', 'u').split('\n')[1], 'Nessuna notizia nelle ultime 24 ore.')
  assert.equal(fraseVuota(b()), null)
})

test('i primi n e quanti altri', () => {
  assert.deepEqual(primi([1, 2, 3, 4, 5], 3), { mostrati: [1, 2, 3], altri: 2 })
  assert.deepEqual(primi([1, 2], 3), { mostrati: [1, 2], altri: 0 })
})

test('il carattere si rimpicciolisce finché il testo entra, non sotto il minimo', () => {
  const misura = (t: string, px: number) => t.length * px * 0.5
  assert.equal(adatta('Salerno', 936, 88, 56, misura), 88)
  assert.equal(adatta('x'.repeat(20), 936, 120, 56, misura), 93) // 20 × 93 × 0,5 = 930 ≤ 936
  assert.equal(adatta('x'.repeat(200), 936, 88, 56, misura), 56)
})

test('a capo tra le parole, senza superare la larghezza', () => {
  const misura = (t: string) => t.length * 10
  assert.deepEqual(aCapo('Segnalazioni delle persone nelle ultime 24 ore', 200, misura), ['Segnalazioni delle', 'persone nelle ultime', '24 ore'])
  assert.deepEqual(aCapo('Barletta-Andria-Trani', 100, misura), ['Barletta-Andria-Trani']) // una parola sola non si spezza
})

test('browser interni delle app social', () => {
  assert.equal(browserInterno('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]'), true)
  assert.equal(browserInterno('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 Instagram 350.0'), true)
  assert.equal(browserInterno('Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36'), true)
  assert.equal(browserInterno('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.10.0.40'), true)
  assert.equal(browserInterno('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 Line/14.16.0'), true)
  assert.equal(browserInterno('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 MicroMessenger/8.0.50'), true)
  assert.equal(browserInterno('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'), false)
  assert.equal(browserInterno('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), false)
})

test('finiti su distributori, al singolare e al plurale', () => {
  assert.equal(finitiSu({ ...c('Eboli', 'senza_carburante'), rosso: 4, distributori: 9 }), '4 finiti su 9')
  assert.equal(finitiSu({ ...c('Sarno', 'senza_carburante'), rosso: 1, distributori: 5 }), '1 finito su 5')
})

test('ora della notizia: «ieri» se non è del giorno del bollettino (a Roma)', () => {
  const alle = '2026-10-22T13:30:00.000Z' // 15:30 a Roma
  assert.equal(oraNotizia('2026-10-22T13:12:00.000Z', alle), '15:12')
  assert.equal(oraNotizia('2026-10-21T20:05:00.000Z', alle), 'ieri 22:05')
  assert.equal(oraNotizia('2026-10-21T22:30:00.000Z', alle), '00:30') // dopo mezzanotte a Roma è già oggi
})

test('un indirizzo nuovo ogni minuto: la cache del browser non ritarda i dati', () => {
  const a = indirizzoBollettino('SA', Date.parse('2026-10-22T13:30:05Z'))
  assert.match(a, /^\/api\/province\/SA\?minuto=\d+$/)
  assert.equal(indirizzoBollettino('SA', Date.parse('2026-10-22T13:30:55Z')), a)
  assert.notEqual(indirizzoBollettino('SA', Date.parse('2026-10-22T13:31:05Z')), a)
})

test('nome del file con sigla, giorno e ora di Roma', () => {
  assert.equal(nomeFile(b(), 'png'), 'scorty-bollettino-SA-2026-10-22-1530.png')
})
