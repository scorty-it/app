// L'immagine del bollettino (1080×1350, adatta a WhatsApp e ai social), disegnata sul telefono con la Canvas API:
// niente librerie e niente lavoro per il server. Le funzioni di disegno sono in tela.ts, condivise con il PDF.
import {
  aCapo, adatta, comuniSenzaBeni, conNotizie, finitiSu, fraseVuota, fraseVuotaSpesa, gruppo, momento, oraNotizia, pezziBene, primi, righeImmagine,
  valoreIndicatore, type PezzoBene,
} from './bollettino.ts'
import type { BeneSenza, BollettinoProvincia } from './dati.ts'
import { NOMI_PER_BENE } from './righe-widget.ts'
import { AMBRA, BORDO, GRIGIO, NERO, caricaCaratteri, caricaLogo, comeBlob, indicatore, misuratore, nuovaTela, riquadro, scrivi, simbolo } from './tela.ts'

const L = 1080
const A = 1350
const M = 72 // margine ai lati
const UTILE = L - 2 * M
const FONDO = A - 120 // dove comincia la fascia nera in fondo

// Le altezze che contano per sapere quante righe stanno (bollettino.ts: righeImmagine). Tutte in pixel dell'immagine.
const RIGA_COMUNE = 82 // un comune senza carburante: nome e, sotto, l'ultima notizia
const RIGA_BENE = 50 // un bene della spesa: una riga sola
const ALTRI = 34 // la riga «e altri N»
const NOTA = 36 // una riga grigia sotto un elenco
const TRA_ELENCHI = 58 // dalla fine di un elenco al titolo del prossimo
const TETTO_COMUNI = 4
const TETTO_BENI = 7

// Come si scrivono i pezzi della riga di un bene (come nel widget): il bene in grassetto, «da confermare» in ambra, «+N» in grigio.
const STILE_PEZZO: Record<PezzoBene['tipo'], { peso: number; colore: string; scala: number }> = {
  bene: { peso: 700, colore: NERO, scala: 1 },
  nome: { peso: 600, colore: NERO, scala: 1 },
  conferma: { peso: 700, colore: AMBRA, scala: 0.78 },
  altri: { peso: 500, colore: GRIGIO, scala: 1 },
}

export async function disegnaBollettino(b: BollettinoProvincia, nome: string, url: string): Promise<Blob> {
  await caricaCaratteri()
  const marchio = await caricaLogo()
  const { tela, ctx } = nuovaTela(L, A)

  // Intestazione: logo a sinistra, etichetta a destra.
  const altezzaLogo = 64
  ctx.drawImage(marchio, M, 48, (marchio.width / marchio.height) * altezzaLogo, altezzaLogo)
  scrivi(ctx, 'BOLLETTINO', L - M, 88, 24, 700, GRIGIO, 'right')

  // Di cosa si parla (senza la spesa, per un server non ancora aggiornato, solo carburante), la provincia in grande e il momento dei dati.
  scrivi(ctx, `${b.spesa ? 'Carburante e spesa' : 'Carburante'} in provincia di`, M, 156, 30, 700, GRIGIO)
  const pxNome = adatta(nome, UTILE, 76, 52, misuratore(ctx, 800))
  const yNome = 174 + Math.round(pxNome * 0.72)
  scrivi(ctx, nome, M, yNome, pxNome, 800, NERO)
  const { giorno, ora } = momento(b.aggiornato_il)
  scrivi(ctx, `${giorno[0].toUpperCase()}${giorno.slice(1)} · ore ${ora}`, M, yNome + 44, 32, 500, GRIGIO)

  // Riquadro con l'indicatore e i tre conteggi.
  const yR = yNome + 82
  const altoR = 230
  riquadro(ctx, M, yR, UTILE, altoR, 36, '#f5f6f8')
  indicatore(ctx, M + 36, yR + 24, 200, valoreIndicatore(b))
  const xN = M + 36 + 200 + 40
  const etichette = { verde: 'con carburante', giallo: 'scarso o solo alcuni carburanti', rosso: 'finito' }
  const colori = ['verde', 'giallo', 'rosso'] as const
  // Le etichette partono dopo il numero più largo: 108 px bastano fino a tre cifre.
  const xE = xN + 64 + Math.max(108, ...colori.map((c) => misuratore(ctx, 800)(String(b[c]), 46) + 20))
  colori.forEach((c, i) => {
    const cy = yR + 42 + i * 54
    simbolo(ctx, c, xN + 24, cy, 21)
    scrivi(ctx, String(b[c]), xN + 64, cy + 16, 46, 800, NERO)
    scrivi(ctx, etichette[c], xE, cy + 12, adatta(etichette[c], M + UTILE - 36 - xE, 28, 20, misuratore(ctx, 500)), 500, NERO)
  })
  const notizie = `${conNotizie(b)} su ${b.distributori} distributori con notizie nelle ultime 24 ore`
  const largaN = M + UTILE - 36 - xN
  scrivi(ctx, notizie, xN, yR + 206, adatta(notizie, largaN, 24, 18, misuratore(ctx, 500)), 500, GRIGIO)

  // Quante righe dei due elenchi, comuni senza carburante e beni della spesa, stanno tra il riquadro e la fascia in fondo.
  const senza = gruppo(b, 'senza_carburante')
  const senzaNotizie = gruppo(b, 'senza_notizie').length
  const vuota = fraseVuota(b)
  const beni = b.spesa?.beni ?? []
  const vuotaSpesa = fraseVuotaSpesa(b)
  let y = yR + altoR + TRA_ELENCHI
  const fissoCarburante = 22 + (vuota ? 58 : 0) + (senzaNotizie ? NOTA : 0)
  const fissoSpesa = b.spesa ? TRA_ELENCHI + 22 + (vuotaSpesa ? 58 : 0) + (b.spesa.con_notizie ? NOTA : 0) : 0
  const righe = righeImmagine(
    {
      comuni: { totale: vuota ? 0 : senza.length, tetto: TETTO_COMUNI, riga: RIGA_COMUNE, altri: ALTRI },
      beni: { totale: vuotaSpesa ? 0 : beni.length, tetto: TETTO_BENI, riga: RIGA_BENE, altri: ALTRI },
    },
    FONDO - 24 - y - fissoCarburante - fissoSpesa,
  )

  // Comuni senza carburante.
  scrivi(ctx, 'Comuni senza carburante', M, y, 40, 800, NERO)
  if (senza.length) scrivi(ctx, `${senza.length} su ${b.comuni.length}`, L - M, y, 26, 600, GRIGIO, 'right')
  y += 22
  if (vuota) {
    scrivi(ctx, vuota, M, y + 50, 34, 600, NERO)
    y += 58
  } else {
    const { mostrati, altri } = primi(senza, righe.comuni)
    for (const [i, c] of mostrati.entries()) {
      const destra = finitiSu(c)
      const largaDestra = misuratore(ctx, 500)(destra, 26)
      simbolo(ctx, 'rosso', M + 20, y + 36, 20)
      const largaNome = UTILE - 56 - largaDestra - 24
      scrivi(ctx, c.comune, M + 56, y + 48, adatta(c.comune, largaNome, 34, 22, misuratore(ctx, 700)), 700, NERO)
      scrivi(ctx, destra, L - M, y + 46, 26, 500, GRIGIO, 'right')
      const dettaglio = (c.ultima ? `ultima notizia ${oraNotizia(c.ultima, b.aggiornato_il)}` : '') + (c.ultima && !c.confermato ? ' · ' : '')
      scrivi(ctx, dettaglio, M + 56, y + 76, 24, 500, GRIGIO)
      if (!c.confermato) scrivi(ctx, 'da confermare', M + 56 + misuratore(ctx, 500)(dettaglio, 24), y + 76, 24, 700, AMBRA)
      y += RIGA_COMUNE
      if (i < mostrati.length - 1) separatore(ctx, y) // tra una riga e l'altra, non dopo l'ultima: sotto c'è «e altri» o la nota
    }
    if (altri) {
      scrivi(ctx, `e altri ${altri} ${altri === 1 ? 'comune' : 'comuni'}`, M, y + 30, 26, 600, NERO)
      y += ALTRI
    }
  }
  if (senzaNotizie) {
    scrivi(ctx, `Nessuna notizia da ${senzaNotizie} ${senzaNotizie === 1 ? 'comune' : 'comuni'}.`, M, y + 30, 26, 500, GRIGIO)
    y += NOTA
  }

  // La spesa, sotto il carburante: una riga per bene, come nel widget («Acqua: Volla, Pozzuoli +3»). Cosa dire lo decidono
  // fraseVuotaSpesa e i conteggi della spesa, mai il solo numero dei comuni: senza notizie dai negozi «nessun comune senza beni»
  // sembrerebbe che vada tutto bene. Un server non ancora aggiornato non manda la spesa: il blocco non c'è.
  if (b.spesa) {
    const { negozi, con_notizie } = b.spesa
    y += TRA_ELENCHI
    scrivi(ctx, vuotaSpesa ? 'Spesa' : 'Spesa: comuni senza beni', M, y, 40, 800, NERO)
    if (!vuotaSpesa) scrivi(ctx, `${comuniSenzaBeni(b)} ${comuniSenzaBeni(b) === 1 ? 'comune' : 'comuni'}`, L - M, y, 26, 600, GRIGIO, 'right')
    y += 22
    if (vuotaSpesa) {
      scrivi(ctx, vuotaSpesa, M, y + 50, 34, 600, NERO)
      y += 58
    } else {
      const { mostrati, altri } = primi(beni, righe.beni)
      for (const [i, x] of mostrati.entries()) {
        simbolo(ctx, 'rosso', M + 20, y + 24, 15)
        scriviBene(ctx, x, M + 56, y + 34, UTILE - 56)
        y += RIGA_BENE
        if (i < mostrati.length - 1) separatore(ctx, y)
      }
      if (altri) {
        scrivi(ctx, `e altri ${altri} ${altri === 1 ? 'bene' : 'beni'}`, M, y + 30, 26, 600, NERO)
        y += ALTRI
      }
    }
    if (con_notizie) scrivi(ctx, `${con_notizie} su ${negozi} negozi con notizie nelle ultime 24 ore`, M, y + 30, 26, 500, GRIGIO)
  }

  // Fascia in fondo: dove trovare la situazione aggiornata, e che non è un servizio ufficiale.
  const yF = FONDO
  ctx.fillStyle = NERO
  ctx.fillRect(0, yF, L, A - yF)
  scrivi(ctx, 'Situazione aggiornata su', M, yF + 44, 24, 500, '#c7cad1')
  const indirizzo = url.replace(/^https?:\/\//, '')
  scrivi(ctx, indirizzo, M, yF + 90, adatta(indirizzo, 520, 40, 26, misuratore(ctx, 800)), 800, '#fff')
  const avviso = aCapo('Segnalazioni delle persone nelle ultime 24 ore. Scorty è un progetto civico, non un servizio ufficiale.', 380, (t) =>
    misuratore(ctx, 500)(t, 20))
  avviso.forEach((r, i) => scrivi(ctx, r, L - M, yF + 62 - ((avviso.length - 1) * 28) / 2 + i * 28, 20, 500, '#c7cad1', 'right'))

  return comeBlob(tela, 'image/png')
}

const separatore = (ctx: CanvasRenderingContext2D, y: number) => {
  ctx.fillStyle = BORDO
  ctx.fillRect(M, y - 1, UTILE, 2)
}

// La riga di un bene su una riga sola: i comuni nominati sono al più NOMI_PER_BENE, meno se non stanno (come nel widget, dove la
// riga che andrebbe a capo perde un comune); se nemmeno un comune sta, il carattere si rimpicciolisce, mai una parola tagliata.
function scriviBene(ctx: CanvasRenderingContext2D, x: BeneSenza, xInizio: number, y: number, larghezza: number) {
  const PX = 30
  const misura = (pezzi: PezzoBene[], px: number) =>
    pezzi.reduce((somma, p) => somma + misuratore(ctx, STILE_PEZZO[p.tipo].peso)(p.testo, px * STILE_PEZZO[p.tipo].scala), 0)
  let nomi = Math.min(NOMI_PER_BENE, x.comuni.length)
  let pezzi = pezziBene(x, nomi)
  while (nomi > 1 && misura(pezzi, PX) > larghezza) pezzi = pezziBene(x, --nomi)
  const px = Math.max(20, Math.min(PX, (PX * larghezza) / misura(pezzi, PX)))
  let xx = xInizio
  for (const p of pezzi) {
    const s = STILE_PEZZO[p.tipo]
    scrivi(ctx, p.testo, xx, y, px * s.scala, s.peso, s.colore)
    xx += misuratore(ctx, s.peso)(p.testo, px * s.scala)
  }
}
