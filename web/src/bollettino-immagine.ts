// L'immagine del bollettino (1080×1350, adatta a WhatsApp e ai social), disegnata sul telefono con la Canvas API:
// niente librerie e niente lavoro per il server. Le funzioni di disegno sono in tela.ts, condivise con il PDF.
import { aCapo, adatta, conNotizie, fraseVuota, gruppo, momento, oraNotizia, primi, finitiSu, valoreIndicatore } from './bollettino.ts'
import type { BollettinoProvincia } from './dati.ts'
import { AMBRA, BORDO, GRIGIO, NERO, caricaCaratteri, caricaLogo, comeBlob, indicatore, misuratore, nuovaTela, riquadro, scrivi, simbolo } from './tela.ts'

const L = 1080
const A = 1350
const M = 72 // margine ai lati
const UTILE = L - 2 * M

export async function disegnaBollettino(b: BollettinoProvincia, nome: string, url: string): Promise<Blob> {
  await caricaCaratteri()
  const marchio = await caricaLogo()
  const { tela, ctx } = nuovaTela(L, A)

  // Intestazione: logo a sinistra, etichetta a destra.
  const altezzaLogo = 72
  ctx.drawImage(marchio, M, 60, (marchio.width / marchio.height) * altezzaLogo, altezzaLogo)
  scrivi(ctx, 'BOLLETTINO CARBURANTE', L - M, 106, 24, 700, GRIGIO, 'right')

  // Provincia e momento dei dati.
  const titolo = `Provincia di ${nome}`
  const pxTitolo = adatta(titolo, UTILE, 80, 52, misuratore(ctx, 800))
  scrivi(ctx, titolo, M, 236, pxTitolo, 800, NERO)
  const { giorno, ora } = momento(b.aggiornato_il)
  scrivi(ctx, `${giorno[0].toUpperCase()}${giorno.slice(1)} · ore ${ora}`, M, 286, 32, 500, GRIGIO)

  // Riquadro con l'indicatore e i tre conteggi.
  const yR = 330
  riquadro(ctx, M, yR, UTILE, 312, 36, '#f5f6f8')
  indicatore(ctx, M + 36, yR + 56, 200, valoreIndicatore(b))
  const xN = M + 36 + 200 + 40
  const etichette = { verde: 'con carburante', giallo: 'scarso o solo alcuni carburanti', rosso: 'finito' }
  const colori = ['verde', 'giallo', 'rosso'] as const
  // Le etichette partono dopo il numero più largo: 108 px bastano fino a tre cifre.
  const xE = xN + 64 + Math.max(108, ...colori.map((c) => misuratore(ctx, 800)(String(b[c]), 52) + 20))
  colori.forEach((c, i) => {
    const y = yR + 36 + i * 70
    simbolo(ctx, c, xN + 24, y + 28, 24)
    scrivi(ctx, String(b[c]), xN + 64, y + 46, 52, 800, NERO)
    scrivi(ctx, etichette[c], xE, y + 42, adatta(etichette[c], M + UTILE - 36 - xE, 28, 20, misuratore(ctx, 500)), 500, NERO)
  })
  const notizie = `${conNotizie(b)} su ${b.distributori} distributori con notizie nelle ultime 24 ore`
  const largaN = M + UTILE - 36 - xN
  scrivi(ctx, notizie, xN, yR + 284, adatta(notizie, largaN, 24, 18, misuratore(ctx, 500)), 500, GRIGIO)

  // Comuni senza carburante: al massimo quattro righe, oppure tre più «e altri N comuni».
  const senza = gruppo(b, 'senza_carburante')
  const senzaNotizie = gruppo(b, 'senza_notizie').length
  let y = 728
  scrivi(ctx, 'Comuni senza carburante', M, y, 40, 800, NERO)
  if (senza.length) scrivi(ctx, `${senza.length} su ${b.comuni.length}`, L - M, y, 26, 600, GRIGIO, 'right')
  y += 22
  const vuota = fraseVuota(b)
  if (vuota) {
    scrivi(ctx, vuota, M, y + 50, 34, 600, NERO)
    y += 80
  } else {
    const { mostrati, altri } = primi(senza, senza.length <= 4 ? 4 : 3)
    for (const c of mostrati) {
      const destra = finitiSu(c)
      const largaDestra = misuratore(ctx, 500)(destra, 26)
      simbolo(ctx, 'rosso', M + 20, y + 38, 20)
      const largaNome = UTILE - 56 - largaDestra - 24
      scrivi(ctx, c.comune, M + 56, y + 50, adatta(c.comune, largaNome, 34, 22, misuratore(ctx, 700)), 700, NERO)
      scrivi(ctx, destra, L - M, y + 48, 26, 500, GRIGIO, 'right')
      const dettaglio = (c.ultima ? `ultima notizia ${oraNotizia(c.ultima, b.aggiornato_il)}` : '') + (c.ultima && !c.confermato ? ' · ' : '')
      scrivi(ctx, dettaglio, M + 56, y + 80, 24, 500, GRIGIO)
      if (!c.confermato) scrivi(ctx, 'da confermare', M + 56 + misuratore(ctx, 500)(dettaglio, 24), y + 80, 24, 700, AMBRA)
      y += 92
      ctx.fillStyle = BORDO
      ctx.fillRect(M, y - 1, UTILE, 2)
    }
    if (altri) {
      scrivi(ctx, `e altri ${altri} ${altri === 1 ? 'comune' : 'comuni'}`, M, y + 34, 26, 600, NERO)
      y += 34
    }
  }
  if (senzaNotizie) scrivi(ctx, `Nessuna notizia da ${senzaNotizie} ${senzaNotizie === 1 ? 'comune' : 'comuni'}.`, M, y + 40, 26, 500, GRIGIO)

  // Fascia in fondo: dove trovare la situazione aggiornata, e che non è un servizio ufficiale.
  const yF = A - 160
  ctx.fillStyle = NERO
  ctx.fillRect(0, yF, L, A - yF)
  scrivi(ctx, 'Situazione aggiornata su', M, yF + 58, 24, 500, '#c7cad1')
  const indirizzo = url.replace(/^https?:\/\//, '')
  scrivi(ctx, indirizzo, M, yF + 110, adatta(indirizzo, 520, 40, 26, misuratore(ctx, 800)), 800, '#fff')
  const avviso = aCapo('Segnalazioni delle persone nelle ultime 24 ore. Scorty è un progetto civico, non un servizio ufficiale.', 380, (t) =>
    misuratore(ctx, 500)(t, 20))
  avviso.forEach((r, i) => scrivi(ctx, r, L - M, yF + 80 - ((avviso.length - 1) * 28) / 2 + i * 28, 20, 500, '#c7cad1', 'right'))

  return comeBlob(tela, 'image/png')
}
