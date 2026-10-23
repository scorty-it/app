// Il bollettino A4 per prefetture, comunicati ed email, come file PDF vero da scaricare o condividere: le pagine si
// disegnano sulla Canvas (unità: punti tipografici, poi ingrandite) e pdf.ts le chiude in un PDF. Niente librerie.
// ponytail: le pagine restano tutte in memoria finché non si sa quante sono, per scrivere «Pagina N di M»: se i
// bollettini diventano molto lunghi, contarle prima con un giro a vuoto.
import { barreAndamento, conGrafico, fraseAndamento, oraDi } from './andamento.ts'
import { aCapo, adatta, conNotizie, finitiSu, fraseVuota, gruppo, momento, oraNotizia } from './bollettino.ts'
import { ETICHETTA, conFonte } from './condividi.ts'
import type { BollettinoProvincia, ComuneBollettino } from './dati.ts'
import { pdfDaJpeg } from './pdf.ts'
import { matriceQr } from './qr.ts'
import { AMBRA, BORDO, GRIGIO, NERO, SIMBOLI, caricaCaratteri, caricaLogo, comeBlob, misuratore, nuovaTela, riquadro, scrivi, simbolo, type Ctx } from './tela.ts'

const PL = 595.28 // A4 in punti
const PA = 841.89
const SCALA = 2.5 // circa 180 punti per pollice: testo nitido, file di qualche centinaio di KB per pagina
const M = 40 // margini, circa 14 mm
const UTILE = PL - 2 * M
const FONDO = PA - 52 // sotto c'è il piede con il numero di pagina
const RIGA = 20
const MODULO = 2 // lato di un modulo del QR: 5 pixel interi alla SCALA, bordi netti anche nel JPEG

const COME_LEGGERE =
  'Lo stato di ogni distributore si calcola dalle segnalazioni delle persone nelle ultime 24 ore: quelle recenti pesano di più. ' +
  'Un comune è «senza carburante» quando nessun suo distributore risulta avere carburante e almeno uno risulta finito. ' +
  '«Da confermare» vuol dire che finora l’ha segnalato una sola persona; confermato vuol dire almeno due persone d’accordo nelle ' +
  'ultime 4 ore. I distributori senza notizie possono essere aperti o chiusi.'
const FONTE =
  'Fonte: segnalazioni delle persone su Scorty (scorty.it). Distributori: Ministero delle Imprese e del Made in Italy (IODL 2.0). ' +
  'Dati aperti con licenza ODbL. Scorty è un progetto civico indipendente, non un servizio ufficiale.'

interface Colonna {
  titolo: string
  quota: number // parte della larghezza utile
}
interface Riga {
  celle: string[]
  grassetto?: boolean
  evidenzia?: boolean
  daConfermare?: boolean
}

const senzaNotizie = (c: ComuneBollettino) => c.distributori - c.verde - c.giallo - c.rosso

export async function creaPdf(b: BollettinoProvincia, nome: string, url: string): Promise<Blob> {
  await caricaCaratteri()
  const marchio = await caricaLogo()
  const pagine: { tela: HTMLCanvasElement; ctx: Ctx }[] = []
  let ctx!: Ctx
  let y = 0
  const nuovaPagina = () => {
    const p = nuovaTela(Math.round(PL * SCALA), Math.round(PA * SCALA))
    p.ctx.scale(SCALA, SCALA)
    pagine.push(p)
    ctx = p.ctx
    y = M
  }
  const serve = (altezza: number) => y + altezza > FONDO && nuovaPagina()
  const misura = (peso: number) => (t: string, px: number) => misuratore(ctx, peso)(t, px)
  const linea = (yy: number, spessore: number, colore: string) => {
    ctx.fillStyle = colore
    ctx.fillRect(M, yy, UTILE, spessore)
  }
  const titoletto = (testo: string, nota: string) => {
    scrivi(ctx, testo, M, y + 12, 12.5, 800, NERO)
    scrivi(ctx, nota, M + misura(800)(testo, 12.5) + 6, y + 12, 9.5, 500, GRIGIO)
    y += 22
  }

  function tabella(colonne: Colonna[], righe: Riga[]) {
    const bordi = colonne.reduce<number[]>((x, c) => [...x, x[x.length - 1] + c.quota * UTILE], [M])
    // La prima colonna (il comune) a sinistra, i numeri a destra.
    const cella = (testo: string, i: number, yy: number, px: number, peso: number, colore: string) =>
      i === 0 ? scrivi(ctx, testo, bordi[0] + 6, yy, px, peso, colore) : scrivi(ctx, testo, bordi[i + 1] - 6, yy, px, peso, colore, 'right')
    const intestazione = () => {
      colonne.forEach((c, i) => cella(c.titolo, i, y + 12, 8.5, 600, GRIGIO))
      linea(y + 17, 0.75, NERO)
      y += 18
    }
    intestazione()
    for (const r of righe) {
      if (y + RIGA > FONDO) {
        nuovaPagina()
        intestazione() // la tabella continua: si ripete l'intestazione
      }
      if (r.evidenzia) {
        ctx.fillStyle = '#fdf1f1'
        ctx.fillRect(M, y, UTILE, RIGA)
      }
      const peso = r.grassetto ? 700 : 500
      const etichetta = r.daConfermare ? misura(700)('da confermare', 8.5) + 6 : 0
      const px = adatta(r.celle[0], bordi[1] - bordi[0] - 12 - etichetta, 9.5, 7, misura(peso))
      cella(r.celle[0], 0, y + 13.5, px, peso, NERO)
      if (r.daConfermare) scrivi(ctx, 'da confermare', bordi[0] + 6 + misura(peso)(r.celle[0], px) + 6, y + 13.5, 8.5, 700, AMBRA)
      r.celle.slice(1).forEach((t, i) => cella(t, i + 1, y + 13.5, 9.5, 500, NERO))
      linea(y + RIGA - 0.75, 0.75, BORDO)
      y += RIGA
    }
    y += 16
  }

  function paragrafo(testo: string, x: number, larghezza: number, px: number, interlinea: number, colore: string) {
    for (const r of aCapo(testo, larghezza, (t) => misura(500)(t, px))) {
      serve(interlinea)
      scrivi(ctx, r, x, y + px, px, 500, colore)
      y += interlinea
    }
  }

  nuovaPagina()
  const { giorno, ora } = momento(b.aggiornato_il)
  const Giorno = giorno[0].toUpperCase() + giorno.slice(1)

  // Intestazione: logo a sinistra; a destra cosa, dove e quando, e il QR del link. Sta sulla prima pagina, quella che
  // si affigge. Il QR parte da un pixel intero e ha intorno i 4 moduli di bianco che la norma chiede.
  const qr = matriceQr(conFonte(url, ETICHETTA.qrPdf))
  const latoQr = qr ? qr.length * MODULO : 0
  if (qr) {
    const x0 = Math.round((PL - M - latoQr) * SCALA) / SCALA
    const y0 = Math.round(y * SCALA) / SCALA
    ctx.fillStyle = NERO
    qr.forEach((riga, r) => riga.forEach((nero, c) => nero && ctx.fillRect(x0 + c * MODULO, y0 + r * MODULO, MODULO, MODULO)))
  }
  const destra = PL - M - (qr ? latoQr + 14 : 0)
  ctx.drawImage(marchio, M, y + 13, (marchio.width / marchio.height) * 32, 32)
  scrivi(ctx, 'BOLLETTINO CARBURANTE', destra, y + 13, 8.5, 700, GRIGIO, 'right')
  const titolo = `Provincia di ${nome}`
  scrivi(ctx, titolo, destra, y + 35, adatta(titolo, 300, 20, 14, misura(800)), 800, NERO, 'right')
  scrivi(ctx, `${Giorno}, ore ${ora}`, destra, y + 50, 10, 500, GRIGIO, 'right')
  linea(y + 66, 1.5, NERO)
  y += 84

  // In sintesi: quattro riquadri.
  titoletto('In sintesi', '')
  const larga = (UTILE - 18) / 4
  const riquadri = [
    { etichetta: 'Distributori con notizie', valore: String(conNotizie(b)), dopo: `su ${b.distributori}` },
    { etichetta: 'Con carburante', valore: String(b.verde), colore: 'verde' as const },
    { etichetta: 'Scarso', valore: String(b.giallo), colore: 'giallo' as const },
    { etichetta: 'Finito', valore: String(b.rosso), colore: 'rosso' as const },
  ]
  riquadri.forEach((r, i) => {
    const x = M + i * (larga + 6)
    riquadro(ctx, x, y, larga, 46, 8, null, { colore: BORDO, spessore: 0.75 })
    const xE = r.colore ? x + 23 : x + 9
    if (r.colore) simbolo(ctx, r.colore, x + 14, y + 12, 5)
    scrivi(ctx, r.etichetta, xE, y + 15, 9, 500, GRIGIO)
    scrivi(ctx, r.valore, x + 9, y + 38, 19, 800, NERO)
    if (r.dopo) scrivi(ctx, r.dopo, x + 9 + misura(800)(r.valore, 19) + 4, y + 38, 10, 600, GRIGIO)
  })
  y += 64

  // Ultime 24 ore (andamento.ts): la frase e una barra per ora, con il numero sopra perché su carta non si tocca.
  const frase = fraseAndamento(b)
  if (frase || conGrafico(b)) {
    titoletto('Ultime 24 ore', 'comuni senza carburante, ora per ora')
    if (frase) {
      scrivi(ctx, frase, M, y + 11, 11, 600, NERO)
      y += 22
    }
    if (conGrafico(b)) {
      const barre = barreAndamento(b)
      const alto = 40
      const passo = UTILE / barre.length
      const massimo = Math.max(...barre.map((x) => x.comuni ?? 0))
      y += 12 // spazio per i numeri sopra le barre più alte
      barre.forEach((x, i) => {
        if (x.comuni === null) return
        const h = x.comuni ? Math.max(2, (x.comuni / massimo) * alto) : 1
        ctx.fillStyle = x.comuni ? SIMBOLI.rosso : BORDO
        ctx.fillRect(M + i * passo + 2, y + alto - h, passo - 4, h)
        if (x.comuni) scrivi(ctx, String(x.comuni), M + (i + 0.5) * passo, y + alto - h - 3, 7.5, 700, NERO, 'center')
      })
      ;[0, 6, 12, 18].forEach((i) => scrivi(ctx, oraDi(barre[i].ora), M + i * passo + 2, y + alto + 11, 8, 500, GRIGIO))
      scrivi(ctx, 'adesso', PL - M - 2, y + alto + 11, 8, 500, GRIGIO, 'right')
      y += alto + 18
    }
    y += 12
  }

  const senza = gruppo(b, 'senza_carburante')
  const conDati = gruppo(b, 'con_notizie')
  const senzaDati = gruppo(b, 'senza_notizie')
  const vuota = fraseVuota(b)
  if (!conNotizie(b)) {
    scrivi(ctx, vuota!, M, y + 12, 12, 600, NERO)
    y += 28
  } else {
    serve(22 + 18 + RIGA)
    titoletto('Comuni senza carburante', `${senza.length} su ${b.comuni.length} comuni con distributori`)
    if (senza.length) {
      tabella(
        [{ titolo: 'Comune', quota: 0.46 }, { titolo: 'Finiti', quota: 0.2 }, { titolo: 'Senza notizie', quota: 0.16 }, { titolo: 'Ultima notizia', quota: 0.18 }],
        senza.map((c) => ({
          celle: [c.comune, finitiSu(c), String(senzaNotizie(c)), c.ultima ? oraNotizia(c.ultima, b.aggiornato_il) : '–'],
          grassetto: true,
          evidenzia: true,
          daConfermare: !c.confermato,
        })),
      )
    } else {
      scrivi(ctx, vuota!, M, y + 12, 12, 600, NERO)
      y += 28
    }
    if (conDati.length) {
      serve(22 + 18 + RIGA)
      titoletto('Comuni con notizie', String(conDati.length))
      tabella(
        [
          { titolo: 'Comune', quota: 0.34 }, { titolo: 'Distributori', quota: 0.13 }, { titolo: 'Con carburante', quota: 0.16 },
          { titolo: 'Scarso', quota: 0.11 }, { titolo: 'Finito', quota: 0.11 }, { titolo: 'Senza notizie', quota: 0.15 },
        ],
        conDati.map((c) => ({ celle: [c.comune, String(c.distributori), String(c.verde), String(c.giallo), String(c.rosso), String(senzaNotizie(c))] })),
      )
    }
  }

  if (senzaDati.length) {
    serve(22 + 14)
    titoletto('Comuni senza notizie', String(senzaDati.length))
    paragrafo(`${senzaDati.map((c) => c.comune).join(', ')}.`, M, UTILE, 10, 14, NERO)
    y += 10
  }

  // Come leggere questi dati e le fonti: un blocco solo, mai spezzato tra due pagine (le fonti da sole su una pagina
  // sembrerebbero un errore di stampa).
  const righe = aCapo(COME_LEGGERE, UTILE - 22, (t) => misura(500)(t, 9.5))
  const alto = 30 + righe.length * 13
  const fonti = aCapo(FONTE, UTILE * 0.6, (t) => misura(500)(t, 8.5))
  serve(4 + alto + 14 + Math.max(fonti.length * 11, 26) + 12)
  y += 4
  riquadro(ctx, M, y, UTILE, alto, 8, '#f5f6f8')
  scrivi(ctx, 'Come leggere questi dati', M + 11, y + 19, 10.5, 800, NERO)
  righe.forEach((r, i) => scrivi(ctx, r, M + 11, y + 35 + i * 13, 9.5, 500, NERO))
  y += alto + 14

  // Fonti a sinistra, link alla situazione aggiornata a destra.
  linea(y, 0.75, BORDO)
  fonti.forEach((r, i) => scrivi(ctx, r, M, y + 14 + i * 11, 8.5, 500, GRIGIO))
  scrivi(ctx, 'Situazione aggiornata', PL - M, y + 14, 8.5, 500, GRIGIO, 'right')
  scrivi(ctx, url.replace(/^https?:\/\//, ''), PL - M, y + 29, 11, 700, NERO, 'right')

  // Piede di ogni pagina: di cosa si tratta e a che pagina siamo.
  pagine.forEach((p, i) => {
    ctx = p.ctx
    scrivi(ctx, `Bollettino carburante · Provincia di ${nome} · ${Giorno}, ore ${ora}`, M, PA - 26, 8, 500, GRIGIO)
    scrivi(ctx, `Pagina ${i + 1} di ${pagine.length}`, PL - M, PA - 26, 8, 500, GRIGIO, 'right')
  })

  const jpeg = await Promise.all(
    pagine.map(async (p) => ({
      jpeg: new Uint8Array(await (await comeBlob(p.tela, 'image/jpeg', 0.88)).arrayBuffer()),
      larghezza: p.tela.width,
      altezza: p.tela.height,
    })),
  )
  const pdf = pdfDaJpeg(jpeg, `Bollettino carburante, provincia di ${nome}`)
  return new Blob([pdf.buffer as ArrayBuffer], { type: 'application/pdf' })
}
