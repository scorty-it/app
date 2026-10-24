import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aCapo, adatta, browserInterno, comuniSenzaBeni, finitiSu, fraseVuota, fraseVuotaSpesa, indirizzoBollettino, momento, nomeFile, oraNotizia, pezziBene, primi, righeImmagine, rigaSpesaProvincia, testoBollettino, valoreIndicatore } from './bollettino.ts'
import type { BeneSenza, BollettinoProvincia, ComuneBollettino, Provincia, SpesaBollettino } from './dati.ts'

const c = (comune: string, gruppo: ComuneBollettino['gruppo'], confermato = false): ComuneBollettino =>
  ({ comune, gruppo, confermato, distributori: 3, verde: 0, giallo: 0, rosso: 1, ultima: null, lat: 0, lon: 0 })
const b = (altro: Partial<BollettinoProvincia> = {}): BollettinoProvincia => ({
  provincia: 'SA', aggiornato_il: '2026-10-22T13:30:00.000Z', distributori: 385, verde: 58, giallo: 21, rosso: 17, lat: 40.6, lon: 15,
  comuni: [c('Eboli', 'senza_carburante', true), c('Sarno', 'senza_carburante'), c('Sala Consilina', 'senza_carburante'), c('Salerno', 'con_notizie')],
  ...altro,
})

// Un elenco dell'immagine: quante voci ha, fino a quante se ne mostrano, quanto è alta una riga e quanto la riga «e altri N».
const elenco = (totale: number, tetto: number, riga: number, altri = 30) => ({ totale, tetto, riga, altri })

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

test('un solo distributore con notizie: «1 distributore su N»', () => {
  const uno = testoBollettino(b({ verde: 0, giallo: 0, rosso: 1 }), 'Salerno', 'u')
  assert.match(uno, /\(1 distributore su 385 con notizie nelle ultime 24 ore\)/)
  assert.doesNotMatch(uno, /1 distributori/)
  assert.match(testoBollettino(b({ verde: 1, giallo: 1, rosso: 0 }), 'Salerno', 'u'), /\(2 distributori su 385 con notizie/)
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

// Napoli, venerdì 23 ottobre 2026 ore 10:00 a Roma, con la spesa: acqua a Volla e Pozzuoli, pane a Casoria.
const napoli = (spesa?: SpesaBollettino): BollettinoProvincia => ({
  provincia: 'NA', aggiornato_il: '2026-10-23T08:00:00.000Z', distributori: 400, verde: 12, giallo: 3, rosso: 2, lat: 40.8, lon: 14.3,
  comuni: [c('Afragola', 'senza_carburante', true), c('Casoria', 'senza_carburante'), c('Napoli', 'con_notizie')],
  ...(spesa && { spesa }),
})
const senzaAcqua: BeneSenza = { bene: 'acqua', comuni: [{ comune: 'Volla', confermato: true }, { comune: 'Pozzuoli', confermato: false }] }
const senzaPane: BeneSenza = { bene: 'pane', comuni: [{ comune: 'Casoria', confermato: true }] }
const spesa = (altro: Partial<SpesaBollettino> = {}): SpesaBollettino => ({ negozi: 900, con_notizie: 25, beni: [senzaAcqua, senzaPane], ...altro })

test('testo pronto da incollare, con la spesa', () => {
  assert.equal(testoBollettino(napoli(spesa()), 'Napoli', 'https://scorty.it/province/NA?da=bollettino'), [
    'Carburante e spesa in provincia di Napoli, venerdì 23 ottobre 2026 ore 10:00',
    'Carburante: ✓ 12 con carburante · – 3 scarso · ✕ 2 finito (17 distributori su 400 con notizie nelle ultime 24 ore)',
    'Comuni senza carburante: Afragola, Casoria (da confermare).',
    'Spesa: notizie da 25 negozi su 900 nelle ultime 24 ore.',
    'Senza acqua: Volla, Pozzuoli (da confermare). Senza pane: Casoria.',
    'Situazione aggiornata: https://scorty.it/province/NA?da=bollettino',
  ].join('\n'))
})

test('testo con la spesa: senza notizie dai negozi niente righe «Senza …»', () => {
  const testo = testoBollettino(napoli(spesa({ con_notizie: 0, beni: [] })), 'Napoli', 'u').split('\n')
  assert.equal(testo[3], 'Spesa: nessuna notizia dai negozi nelle ultime 24 ore.')
  assert.equal(testo.length, 5)
  assert.equal(testo[4], 'Situazione aggiornata: u')
})

test('testo con la spesa: notizie ma nessun bene mancante', () => {
  const testo = testoBollettino(napoli(spesa({ beni: [] })), 'Napoli', 'u').split('\n')
  assert.equal(testo[3], 'Spesa: nessun comune risulta senza beni (notizie da 25 negozi su 900 nelle ultime 24 ore).')
  assert.equal(testo.length, 5)
})

test('testo con la spesa: un solo negozio con notizie, al singolare', () => {
  assert.equal(testoBollettino(napoli(spesa({ con_notizie: 1 })), 'Napoli', 'u').split('\n')[3], 'Spesa: notizie da 1 negozio su 900 nelle ultime 24 ore.')
})

test('testo con la spesa: un bene con un nome in due parole si dice in minuscolo', () => {
  const frutta: BeneSenza = { bene: 'frutta_verdura', comuni: [{ comune: 'Nola', confermato: false }] }
  assert.match(testoBollettino(napoli(spesa({ beni: [frutta] })), 'Napoli', 'u'), /\nSenza frutta e verdura: Nola \(da confermare\)\.\n/)
})

test('testo con la spesa: «neonati» si dice «prodotti per neonati»', () => {
  const neonati: BeneSenza = { bene: 'neonati', comuni: [{ comune: 'Acerra', confermato: true }] }
  assert.match(testoBollettino(napoli(spesa({ beni: [neonati] })), 'Napoli', 'u'), /\nSenza prodotti per neonati: Acerra\.\n/)
})

test('testo con la spesa e senza notizie dai distributori: la riga dice che è il carburante', () => {
  const vuoto = { ...napoli(spesa()), verde: 0, giallo: 0, rosso: 0, comuni: [c('Napoli', 'senza_notizie')] }
  assert.equal(testoBollettino(vuoto, 'Napoli', 'u').split('\n')[1], 'Carburante: nessuna notizia nelle ultime 24 ore.')
})

test('testo di un server vecchio, senza la spesa: com’era, solo carburante', () => {
  const testo = testoBollettino(napoli(), 'Napoli', 'u')
  assert.equal(testo.split('\n')[0], 'Carburante in provincia di Napoli, venerdì 23 ottobre 2026 ore 10:00')
  assert.doesNotMatch(testo, /Spesa|Senza |Carburante:/)
})

test('frase al posto dell’elenco vuoto della spesa', () => {
  assert.equal(fraseVuotaSpesa(napoli(spesa({ con_notizie: 0, beni: [] }))), 'Nessuna notizia dai negozi nelle ultime 24 ore')
  assert.equal(fraseVuotaSpesa(napoli(spesa({ con_notizie: 0 }))), 'Nessuna notizia dai negozi nelle ultime 24 ore') // anche se beni non è vuoto
  assert.equal(fraseVuotaSpesa(napoli(spesa({ beni: [] }))), 'Nessun comune risulta senza beni')
  assert.equal(fraseVuotaSpesa(napoli(spesa())), null)
  assert.equal(fraseVuotaSpesa(napoli()), null) // server vecchio: niente spesa, niente frase
})

test('comuni distinti senza almeno un bene', () => {
  // Casoria manca di acqua e di pane: conta una volta sola.
  const acquaEPane: BeneSenza = { bene: 'acqua', comuni: [...senzaAcqua.comuni, { comune: 'Casoria', confermato: false }] }
  assert.equal(comuniSenzaBeni(napoli(spesa({ beni: [acquaEPane, senzaPane] }))), 3)
  assert.equal(comuniSenzaBeni(napoli(spesa({ beni: [] }))), 0)
  assert.equal(comuniSenzaBeni(napoli()), 0)
})

test('la riga della spesa nell’elenco delle province', () => {
  const p = (spesa?: Provincia['spesa']): Provincia => ({ provincia: 'NA', distributori: 812, lat: 40.8, lon: 14.2, verde: 400, giallo: 70, rosso: 38, spesa })
  assert.equal(rigaSpesaProvincia(p({ negozi: 640, con_notizie: 57, comuni_senza: 5 })), 'Spesa: 5 comuni senza beni')
  assert.equal(rigaSpesaProvincia(p({ negozi: 640, con_notizie: 57, comuni_senza: 1 })), 'Spesa: 1 comune senza beni')
  assert.equal(rigaSpesaProvincia(p({ negozi: 150, con_notizie: 38, comuni_senza: 0 })), 'Spesa: nessun comune senza beni')
  // Senza notizie dai negozi non si dice «nessun comune senza beni»: sembrerebbe che vada tutto bene.
  assert.equal(rigaSpesaProvincia(p({ negozi: 410, con_notizie: 0, comuni_senza: 0 })), 'Spesa: nessuna notizia dai negozi')
  assert.equal(rigaSpesaProvincia(p()), null) // server vecchio: niente spesa, niente riga
})

test('la riga di un bene come nel widget: i primi comuni, «da confermare» accanto a chi lo è, poi «+N»', () => {
  const acqua: BeneSenza = { bene: 'acqua', comuni: [...senzaAcqua.comuni, { comune: 'Nola', confermato: true }, { comune: 'Acerra', confermato: true }, { comune: 'Marano', confermato: false }] }
  const riga = (n: number) => pezziBene(acqua, n)
  assert.equal(riga(2).map((p) => p.testo).join(''), 'Acqua: Volla, Pozzuoli (da confermare) +3')
  assert.deepEqual(riga(2).map((p) => p.tipo), ['bene', 'nome', 'nome', 'conferma', 'altri'])
  assert.equal(riga(1).map((p) => p.testo).join(''), 'Acqua: Volla +4')
  assert.equal(riga(5).map((p) => p.testo).join(''), 'Acqua: Volla, Pozzuoli (da confermare), Nola, Acerra, Marano (da confermare)') // tutti: niente «+N»
  assert.equal(pezziBene({ bene: 'neonati', comuni: [{ comune: 'Nola', confermato: true }] }, 3).map((p) => p.testo).join(''), 'Neonati: Nola') // l'etichetta corta, come nel widget
})

test('righe nell’immagine: tutto quello che c’è, se sta', () => {
  assert.deepEqual(righeImmagine({ comuni: elenco(3, 4, 90), beni: elenco(2, 7, 50) }, 1000), { comuni: 3, beni: 2 })
  assert.deepEqual(righeImmagine({ comuni: elenco(0, 4, 90), beni: elenco(0, 7, 50) }, 1000), { comuni: 0, beni: 0 })
})

test('righe nell’immagine: oltre il tetto non si va, anche con tutto lo spazio', () => {
  assert.deepEqual(righeImmagine({ comuni: elenco(9, 4, 90), beni: elenco(7, 7, 50) }, 5000), { comuni: 4, beni: 7 })
})

test('righe nell’immagine: due righe a elenco al minimo, le altre a chi ne mostra meno rispetto a quante ne ha', () => {
  // 2×90 + 2×50 + 2×30 («altri» per tutti e due) = 340
  assert.deepEqual(righeImmagine({ comuni: elenco(12, 4, 90), beni: elenco(7, 7, 50) }, 340), { comuni: 2, beni: 2 })
  assert.deepEqual(righeImmagine({ comuni: elenco(12, 4, 90), beni: elenco(7, 7, 50) }, 0), { comuni: 2, beni: 2 }) // il minimo non scende
  // Una riga di comune in più costa 90 e non sta: la riga di bene sì (390).
  assert.deepEqual(righeImmagine({ comuni: elenco(12, 4, 90), beni: elenco(7, 7, 50) }, 400), { comuni: 2, beni: 3 })
  // Con spazio per una riga di comune e una di bene in più, la prima va a chi ha mostrato la parte più piccola (2 su 12 contro 2 su 7).
  assert.deepEqual(righeImmagine({ comuni: elenco(12, 4, 90), beni: elenco(7, 7, 50) }, 480), { comuni: 3, beni: 3 })
  assert.deepEqual(righeImmagine({ comuni: elenco(1, 4, 90), beni: elenco(7, 7, 50) }, 480), { comuni: 1, beni: 7 }) // poca roba nel primo: il resto allo spazio degli altri
})

test('righe nell’immagine: quando un elenco è mostrato tutto, «e altri» non serve più', () => {
  // 3 comuni su 3: 270 senza la riga «altri»; con 2 su 3 ne servono 180 + 30.
  assert.deepEqual(righeImmagine({ comuni: elenco(3, 4, 90), beni: elenco(0, 7, 50) }, 270), { comuni: 3, beni: 0 })
  assert.deepEqual(righeImmagine({ comuni: elenco(3, 4, 90), beni: elenco(0, 7, 50) }, 269), { comuni: 2, beni: 0 })
})
