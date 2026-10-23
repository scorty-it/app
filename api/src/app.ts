import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import Fastify, { type FastifyRequest } from 'fastify'
import { sql, type QueryExecutorProvider } from 'kysely'
import { decidiAvviso, rssAvvisi, testoAvviso, type AvvisoSalvato, type TipoAvviso } from './avvisi.ts'
import { comuniDelBollettino, finitoConfermato, type DistributoreBollettino } from './bollettino.ts'
import { inCache } from './cache.ts'
import { centrato, cercaComuni, cercaDistributori, cercaLuoghi, comuneNominato, interpreta, normalizza } from './cerca.ts'
import { nomeProvincia, regioneDi } from './comuni.ts'
import { db, type LivelloCoda, type Prodotto, type Stato, type TipoPunto } from './db.ts'
import { firmaToken, improntaVisitatore, leggiToken, nuovaSfida, scadenzaSfida, sfidaRisolta } from './firme.ts'
import { MAX_FONTI_AL_GIORNO, fonteDellaVisita, sitoDelWidget } from './fonti.ts'
import { creaLimite } from './limiti.ts'
import { BENI, NOME_PRODOTTO, PRODOTTI_DEL_TIPO, TUTTI_I_PRODOTTI } from './prodotti.ts'
import { fiducia, statoCoda, statoProdotto, stimaArrivi, type Coda, type Opinione, type StatoProdotto, type Stima } from './stato.ts'

export const RAGGIO = 300 // metri: si segnala solo da qui
export const DISTANZA_MAX = 30_000 // metri: oltre i 300 m la segnalazione è "a distanza" (es. chi guidava e segnala dopo)
export const AZIONI_ORA = 10 // segnalazioni, voti e code per telefono in un'ora
export const A_DISTANZA_ORA = 3
export const MODIFICA_MINUTI = 60 // per quanto si può completare o correggere la propria visita
export const CI_VADO_MINUTI = 60 // per quanto vale un «Ci vado»
export const CI_VADO_ORA = 3 // «Ci vado» creati o cambiati da un telefono in un'ora
const VELOCITA_SOSPETTA = 250 // km/h tra due distributori

export interface StatoPunto {
  punto_id: number
  tipo: TipoPunto
  prodotti: StatoProdotto[]
  coda: { livello: LivelloCoda; persone: number; ultimo: string } | null
  interesse: number // telefoni che hanno aperto la scheda negli ultimi 30 minuti
  arrivi: number // telefoni con un «Ci vado» attivo qui
  arrivi_per: Partial<Record<Prodotto, number>> // per bene (solo negozi)
  stima: Stima // previsioni dai «Ci vado» e dalle schede aperte: non toccano lo stato osservato
  calcolato_il: number // per scartare uno stato più vecchio arrivato dopo uno più nuovo
}

const statoVuoto = (punto_id: number, tipo: TipoPunto, calcolato_il: number): StatoPunto => ({
  punto_id, tipo, prodotti: [], coda: null, interesse: 0, arrivi: 0, arrivi_per: {}, stima: { coda_in_aumento: false, potrebbe_finire: [] }, calcolato_il,
})

const errore = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode })

// Quanto vale una segnalazione (e un voto): una giornata. Il peso che cala con il tempo è in stato.ts.
// ponytail: validità e pesi (MEZZA_VITA e RECENTE in stato.ts) sono un valore solo per carburanti e spesa; quando i dati
// dei negozi mostreranno che la spesa invecchia a un'altra velocità, separarli per tipo.
const VALIDITA = sql`interval '24 hours'`

// Le parole che le persone leggono cambiano col tipo del punto.
const parole = (tipo: TipoPunto) => tipo === 'negozio'
  ? { luogo: 'negozio', cosa: 'categoria', questa: 'Questa categoria' }
  : { luogo: 'distributore', cosa: 'carburante', questa: 'Questo carburante' }

// Un voto `v` conta se chi l'ha dato non è bloccato. Dopo 30 giorni il voto diventa anonimo e conta comunque.
const votoValido = sql`not exists (select 1 from dispositivi b where b.id = v.dispositivo_id and b.bloccato)`

// Statistiche: si somma un numero al contatore di oggi (ora italiana). Mai chi, solo quanti.
const OGGI = sql`(now() at time zone 'Europe/Rome')::date`
// Non fallisce mai: un conteggio perso non deve far fallire una richiesta. Chi non ha fretta non lo aspetta.
function conta(chiave: string, n = 1) {
  return sql`
    insert into statistiche (giorno, chiave, valore) values (${OGGI}, ${chiave}, ${n})
    on conflict (giorno, chiave) do update set valore = statistiche.valore + excluded.valore
  `.execute(db).then(() => {}, () => {})
}

// Una visita arrivata da un link con l'etichetta ?da=, o un widget aperto in un sito (fonti.ts). Un nome già visto oggi
// si conta sempre, uno nuovo solo finché il giorno ne ha meno di MAX_FONTI_AL_GIORNO per quel tipo: due nuovi nello
// stesso istante possono sforare di poco.
function contaFonte(fonte: string, tipo: 'fonte' | 'widget' = 'fonte') {
  const chiave = `${tipo}:${fonte}`
  return sql`
    insert into statistiche (giorno, chiave, valore)
    select ${OGGI}, ${chiave}, 1
    where exists (select 1 from statistiche where giorno = ${OGGI} and chiave = ${chiave})
      or (select count(*) from statistiche where giorno = ${OGGI} and chiave like ${`${tipo}:%`}) < ${MAX_FONTI_AL_GIORNO}
    on conflict (giorno, chiave) do update set valore = statistiche.valore + 1
  `.execute(db).then(() => {}, () => {})
}

// Come il colore degli spilli senza filtro: verde se tutto è disponibile, rosso se tutto è finito, giallo se misto.
// Gli stati incerti non contano.
export function coloreDi(s: StatoPunto | undefined): 'verde' | 'giallo' | 'rosso' | null {
  const noti = s?.prodotti.filter((p) => p.affidabilita !== 'incerto') ?? []
  if (!noti.length) return null
  if (noti.every((p) => p.stato === 'disponibile')) return 'verde'
  if (noti.every((p) => p.stato === 'esaurito')) return 'rosso'
  return 'giallo'
}

// CSV come lo leggono i fogli di calcolo: virgole, virgolette raddoppiate, a capo CRLF.
export function comeCsv(righe: Record<string, unknown>[]) {
  if (!righe.length) return ''
  const campo = (v: unknown) => {
    const t = v == null ? '' : String(v)
    return /[",\r\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t
  }
  const colonne = Object.keys(righe[0])
  return [colonne.join(','), ...righe.map((r) => colonne.map((c) => campo(r[c])).join(','))].join('\r\n') + '\r\n'
}

const TIPO = { type: 'string', enum: ['distributore', 'negozio'], default: 'distributore' } as const
const PRODOTTO = { type: 'string', enum: ['benzina', 'gasolio', 'gpl', 'metano'] } as const
const QUALSIASI_PRODOTTO = { type: 'string', enum: TUTTI_I_PRODOTTI } as const // per le letture e per completare una visita
const BENE = { type: 'string', enum: BENI } as const // le visite ai negozi
const POSIZIONE = {
  lat: { type: 'number', minimum: -90, maximum: 90 },
  lon: { type: 'number', minimum: -180, maximum: 180 },
} as const
const corpo = (properties: Record<string, unknown>, facoltativi: string[] = []) => ({
  body: { type: 'object', required: Object.keys(properties).filter((k) => !facoltativi.includes(k)), additionalProperties: false, properties },
})

// Avvisi a enti e redazioni (avvisi.ts): l'indirizzo pubblico per i link, il canale Telegram di ogni regione e chi
// invia. Senza, gli avvisi restano solo nel feed RSS (sviluppo, test, una copia di Scorty senza bot).
export interface ConfigAvvisi {
  origine: string
  canali: Record<string, string>
  invia: (canale: string, testo: string, quando: Date) => Promise<boolean>
}

export function costruisciApp({ segreto, passwordAdmin = '', avvisi }: { segreto: string; passwordAdmin?: string; avvisi?: ConfigAvvisi }) {
  const app = Fastify({
    trustProxy: true, // dietro Caddy: req.ip viene da X-Forwarded-For
    logger: {
      // Privacy: nei log niente IP né corpo delle richieste (che contiene le coordinate).
      serializers: { req: (req) => ({ method: req.method, url: req.url.split('?')[0] }) },
    },
  })

  // ponytail: limiti fissi pensati per le reti mobili, dove molti telefoni escono dallo stesso IP. Da tarare sui dati reali.
  const limiteScritture = creaLimite(300, 60 * 60 * 1000)
  const limiteDispositivi = creaLimite(30, 60 * 60 * 1000)
  const limiteCorrezioni = creaLimite(10, 60 * 60 * 1000)
  const sfideUsate = new Map<string, number>() // una sfida risolta vale per un solo dispositivo
  setInterval(() => sfideUsate.forEach((scade, s) => scade < Date.now() && sfideUsate.delete(s)), 10 * 60 * 1000).unref()

  app.addHook('onRequest', async (req) => {
    if (req.method === 'POST' && !limiteScritture(req.ip)) throw errore(429, 'Troppe richieste da questa rete. Riprova tra poco.')
  })

  // --- Dispositivo anonimo ---

  app.get('/api/sfida', async () => nuovaSfida(segreto))

  app.post('/api/dispositivo', {
    schema: corpo({ sfida: { type: 'string', maxLength: 100 }, firma: { type: 'string', maxLength: 100 }, nonce: { type: 'integer', minimum: 0 } }),
  }, async (req) => {
    const r = req.body as { sfida: string; firma: string; nonce: number }
    if (!sfidaRisolta(segreto, r) || sfideUsate.has(r.sfida)) throw errore(400, 'Verifica non riuscita. Ricarica la pagina.')
    if (!limiteDispositivi(req.ip)) throw errore(429, 'Troppi dispositivi nuovi da questa rete. Riprova più tardi.')
    sfideUsate.set(r.sfida, scadenzaSfida(r.sfida))
    const { id } = await db.insertInto('dispositivi').defaultValues().returning('id').executeTakeFirstOrThrow()
    return { token: firmaToken(segreto, id) }
  })

  async function dispositivo(req: FastifyRequest) {
    const token = req.headers.authorization?.replace(/^Bearer /, '')
    const id = token && leggiToken(segreto, token)
    if (!id || !(await db.selectFrom('dispositivi').select('id').where('id', '=', id).executeTakeFirst())) {
      throw errore(401, 'Dispositivo non riconosciuto. Ricarica la pagina.')
    }
    return id
  }

  const anomalia = (id: string, tipo: 'velocita_impossibile' | 'fuori_raggio' | 'limite_superato', dettagli: object) =>
    db.insertInto('anomalie').values({ tipo, dispositivo_id: id, dettagli: JSON.stringify(dettagli) }).execute()

  // A quanti metri è un punto da chi scrive, e di che tipo è. La posizione serve solo per questo calcolo e non si salva.
  async function distanzaDa(puntoId: number, pos: { lat: number; lon: number }) {
    const { rows: [punto] } = await sql<{ metri: number; tipo: TipoPunto }>`
      select ST_Distance(geom, ST_MakePoint(${pos.lon}, ${pos.lat})::geography) as metri, tipo from punti where id = ${puntoId} and attivo
    `.execute(db)
    if (!punto) throw errore(404, 'Punto non trovato.')
    return punto
  }

  // Le regole di ogni segnalazione: entro il raggio, entro il limite orario. Una velocità impossibile si registra e basta.
  async function controlla(req: FastifyRequest, puntoId: number, pos: { lat: number; lon: number }, raggio = RAGGIO) {
    const id = await dispositivo(req)
    const punto = await distanzaDa(puntoId, pos)
    const { luogo } = parole(punto.tipo)
    if (punto.metri > raggio) {
      await anomalia(id, 'fuori_raggio', { punto_id: puntoId, metri: Math.round(punto.metri) })
      throw errore(403, raggio === RAGGIO
        ? `Sei a ${Math.round(punto.metri)} m: per confermare devi essere entro ${RAGGIO} m dal ${luogo}.`
        : `Sei a ${Math.round(punto.metri / 1000)} km: a distanza si segnala solo entro ${DISTANZA_MAX / 1000} km.`)
    }

    // Una visita a un negozio è un'azione sola: le sue righe hanno la stessa `visita` e contano una volta.
    const { rows: [{ n }] } = await sql<{ n: number }>`
      select count(distinct chiave) as n from (
        select coalesce(visita::text, 's' || id) as chiave from segnalazioni where dispositivo_id = ${id} and creata_il > now() - interval '1 hour'
        union all select 'v' || segnalazione_id from voti where dispositivo_id = ${id} and creato_il > now() - interval '1 hour'
        union all select coalesce(visita::text, 'c' || id) from code where dispositivo_id = ${id} and creata_il > now() - interval '1 hour'
      ) azioni
    `.execute(db)
    if (Number(n) >= AZIONI_ORA) {
      await anomalia(id, 'limite_superato', { punto_id: puntoId })
      throw errore(429, `Hai già fatto ${AZIONI_ORA} segnalazioni nell’ultima ora. Grazie! Riprova più tardi.`)
    }

    const { rows: [prima] } = await sql<{ da: number; metri: number; secondi: number }>`
      select a.punto_id as da, ST_Distance(p.geom, q.geom) as metri, extract(epoch from now() - a.il) as secondi
      from (
        select punto_id, creata_il as il from segnalazioni where dispositivo_id = ${id} and not a_distanza
        union all select punto_id, creata_il from code where dispositivo_id = ${id}
        union all select s.punto_id, v.creato_il from voti v join segnalazioni s on s.id = v.segnalazione_id where v.dispositivo_id = ${id}
        order by il desc limit 1
      ) a join punti p on p.id = a.punto_id, punti q
      where q.id = ${puntoId}
    `.execute(db)
    if (punto.metri <= RAGGIO && prima && prima.metri > 2000 && (prima.metri / 1000) / (Math.max(prima.secondi, 1) / 3600) > VELOCITA_SOSPETTA) {
      await anomalia(id, 'velocita_impossibile', { da: prima.da, a: puntoId, km: Math.round(prima.metri / 100) / 10, minuti: Math.round(prima.secondi / 60) })
    }
    return { id, metri: punto.metri, tipo: punto.tipo }
  }

  // --- Stato dei distributori ---

  async function stati(ids: number[]) {
    const risultato = new Map<number, StatoPunto>()
    if (!ids.length) return risultato
    // Contano solo i telefoni non bloccati: bloccarne uno nasconde anche quello che ha già fatto.
    // Una segnalazione ritirata dal suo autore non è più la sua opinione, ma i voti degli altri su di essa restano.
    const [tipi, opinioni, code, viste, arrivi] = await Promise.all([
      sql<{ id: number; tipo: TipoPunto }>`select id, tipo from punti where id = any(${ids})`.execute(db),
      sql<Opinione & { punto_id: number }>`
        select s.punto_id, s.prodotto, s.stato, true as afferma, s.dispositivo_id, s.visto_il as il, s.id as segnalazione_id, s.a_distanza
        from segnalazioni s join dispositivi d on d.id = s.dispositivo_id
        where s.punto_id = any(${ids}) and s.visto_il > now() - ${VALIDITA} and not s.nascosta and not s.ritirata and not d.bloccato
        union all
        select s.punto_id, s.prodotto, s.stato, v.conferma, v.dispositivo_id, v.creato_il, s.id, false
        from voti v join segnalazioni s on s.id = v.segnalazione_id join dispositivi d on d.id = v.dispositivo_id
        where s.punto_id = any(${ids}) and v.creato_il > now() - ${VALIDITA} and not s.nascosta and not d.bloccato
      `.execute(db),
      sql<Coda & { punto_id: number }>`
        select c.punto_id, c.livello, c.dispositivo_id, c.creata_il as il
        from code c join dispositivi d on d.id = c.dispositivo_id
        where c.punto_id = any(${ids}) and c.creata_il > now() - interval '1 hour' and not c.nascosta and not d.bloccato
      `.execute(db),
      sql<{ punto_id: number; n: number }>`
        select v.punto_id, count(*)::int as n from viste v join dispositivi d on d.id = v.dispositivo_id
        where v.punto_id = any(${ids}) and v.vista_il > now() - interval '30 minutes' and not d.bloccato
          -- chi dice «Ci vado» deve aprire la scheda: conta una volta sola, col peso del «Ci vado»
          and not exists (select 1 from ci_vado c where c.dispositivo_id = v.dispositivo_id and c.punto_id = v.punto_id and c.chiuso_il is null
            and c.creato_il > now() - make_interval(mins => ${CI_VADO_MINUTI}))
        group by v.punto_id
      `.execute(db),
      sql<{ punto_id: number; prodotti: Prodotto[] }>`
        select c.punto_id, c.prodotti from ci_vado c join dispositivi d on d.id = c.dispositivo_id
        where c.punto_id = any(${ids}) and c.chiuso_il is null and c.creato_il > now() - make_interval(mins => ${CI_VADO_MINUTI}) and not d.bloccato
      `.execute(db),
    ])

    const dispositivi = [...new Set([...opinioni.rows, ...code.rows].map((o) => o.dispositivo_id))]
    const fiducie = new Map<string, number>()
    if (dispositivi.length) {
      // Conferme e smentite ricevute da altri telefoni, non bloccati, sulle segnalazioni degli ultimi 30 giorni.
      // Il filtro sta nel join e non nel where: chi non ha ricevuto voti resta, con la fiducia di partenza.
      const { rows } = await sql<{ id: string; eta_min: number; conferme: number; smentite: number }>`
        select d.id, extract(epoch from now() - d.creato_il) / 60 as eta_min,
          count(v.conferma) filter (where v.conferma)::int as conferme,
          count(v.conferma) filter (where not v.conferma)::int as smentite
        from dispositivi d
        left join segnalazioni s on s.dispositivo_id = d.id and s.creata_il > now() - interval '30 days'
        left join voti v on v.segnalazione_id = s.id and v.dispositivo_id <> d.id and ${votoValido}
        where d.id = any(${dispositivi}::uuid[])
        group by d.id
      `.execute(db)
      for (const r of rows) fiducie.set(r.id, fiducia({ ...r, eta_min: Number(r.eta_min) }))
    }

    const ora = Date.now()
    const tipoDi = new Map(tipi.rows.map((t) => [t.id, t.tipo]))
    const nuovo = (id: number) => {
      let s = risultato.get(id)
      if (!s) risultato.set(id, (s = statoVuoto(id, tipoDi.get(id) ?? 'distributore', ora)))
      return s
    }
    const perPunto = Map.groupBy(opinioni.rows, (o) => `${o.punto_id}:${o.prodotto}`)
    for (const gruppo of perPunto.values()) {
      const p = statoProdotto(gruppo, fiducie, ora)
      if (p) nuovo(gruppo[0].punto_id).prodotti.push(p)
    }
    for (const [id, gruppo] of Map.groupBy(code.rows, (c) => c.punto_id)) nuovo(id).coda = statoCoda(gruppo, fiducie, ora)
    for (const v of viste.rows) nuovo(v.punto_id).interesse = v.n
    for (const a of arrivi.rows) {
      const s = nuovo(a.punto_id)
      s.arrivi++
      for (const p of a.prodotti) s.arrivi_per[p] = (s.arrivi_per[p] ?? 0) + 1
    }
    // La stima si calcola per ultima: usa coda, schede e «Ci vado» già messi insieme. L'ordine dei prodotti è quello canonico.
    for (const s of risultato.values()) {
      const stima = stimaArrivi({ tipo: s.tipo, ci_vado: s.arrivi, per_prodotto: s.arrivi_per, interesse: s.interesse, coda: s.coda, prodotti: s.prodotti })
      s.stima = { ...stima, potrebbe_finire: TUTTI_I_PRODOTTI.filter((p) => stima.potrebbe_finire.includes(p)) }
    }
    return risultato
  }

  // Aggiornamenti in tempo reale (Server-Sent Events).
  // ponytail: ogni cambio va a tutti i collegati; iscrizione per zona se il traffico cresce.
  const collegati = new Set<ServerResponse>()
  const battito = setInterval(() => collegati.forEach((c) => c.write(': ping\n\n')), 25_000).unref()
  app.addHook('onClose', async () => {
    clearInterval(battito)
    collegati.forEach((c) => c.end())
  })

  app.get('/api/eventi', (req, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' })
    reply.raw.write(': collegato\n\n')
    collegati.add(reply.raw)
    req.raw.on('close', () => collegati.delete(reply.raw))
  })

  async function aggiorna(puntoId: number) {
    const { rows: [punto] } = await sql<{ tipo: TipoPunto }>`select tipo from punti where id = ${puntoId}`.execute(db)
    const s = (await stati([puntoId])).get(puntoId) ?? statoVuoto(puntoId, punto?.tipo ?? 'distributore', Date.now())
    const messaggio = `data: ${JSON.stringify(s)}\n\n`
    collegati.forEach((c) => c.write(messaggio))
    return s
  }

  // Una segnalazione sul posto chiude il giro di chi aveva detto «ci vado» lì.
  // Restituisce i punti chiusi, perché chi ne chiude uno altrove deve aggiornarlo.
  async function chiudiCiVado(executor: QueryExecutorProvider, dispositivoId: string, puntoId?: number) {
    const { rows } = await sql<{ punto_id: number }>`
      update ci_vado set chiuso_il = now()
      where dispositivo_id = ${dispositivoId} and chiuso_il is null and (${puntoId ?? null}::int is null or punto_id = ${puntoId ?? null})
      returning punto_id
    `.execute(executor)
    return rows.map((r) => r.punto_id)
  }

  // --- «Ci vado» ---
  // Un segnale a vita breve: un telefono ne ha uno solo, vale un'ora, si cancella dopo 24 ore e non entra nelle copie di sicurezza.
  // Non è una segnalazione: non consuma azioni e non cambia lo stato osservato, ma alimenta le stime (arrivi, coda in aumento).
  app.post('/api/ci-vado', {
    schema: corpo({
      punto_id: { type: 'integer' },
      prodotti: { type: 'array', maxItems: BENI.length, items: BENE },
      ...POSIZIONE,
    }),
  }, async (req) => {
    const b = req.body as { punto_id: number; prodotti: Prodotto[]; lat: number; lon: number }
    const id = await dispositivo(req)
    const punto = await distanzaDa(b.punto_id, b)
    if (new Set(b.prodotti).size !== b.prodotti.length) throw errore(400, 'Ogni categoria si indica una volta sola.')
    if (punto.tipo === 'negozio' ? !b.prodotti.length : b.prodotti.length) {
      throw errore(400, punto.tipo === 'negozio' ? 'Indica almeno una categoria.' : 'Per un distributore non si indicano categorie.')
    }
    if (punto.metri > DISTANZA_MAX) {
      // Nessuna anomalia: da lontano non è sospetto, e una traccia dell'intenzione finirebbe nelle copie di sicurezza.
      throw errore(403, `Sei a ${Math.round(punto.metri / 1000)} km: puoi dire «ci vado» solo entro ${DISTANZA_MAX / 1000} km.`)
    }
    const { rows: [{ n }] } = await sql<{ n: number }>`
      select count(*)::int as n from ci_vado where dispositivo_id = ${id} and creato_il > now() - interval '1 hour'
    `.execute(db)
    if (n >= CI_VADO_ORA) {
      // Niente `punto_id`: le anomalie durano 30 giorni e finiscono nei backup, l'intenzione no. `ci_vado` le distingue da quelle delle segnalazioni.
      await anomalia(id, 'limite_superato', { ci_vado: true })
      throw errore(429, `Puoi dire «ci vado» al massimo ${CI_VADO_ORA} volte all’ora. Riprova più tardi.`)
    }
    if (b.prodotti.length) {
      const finito = (await stati([b.punto_id])).get(b.punto_id)?.prodotti
        .find((p) => b.prodotti.includes(p.prodotto) && p.stato === 'esaurito' && p.affidabilita !== 'incerto')
      if (finito) throw errore(409, `Non si può andare a prendere ${NOME_PRODOTTO[finito.prodotto]}: lì risulta finito.`)
    }
    // Chiusura del precedente e nuovo nella stessa transazione: l'indice unico ne ammette uno aperto per telefono.
    const lasciati = await db.transaction().execute(async (tx) => {
      const chiusi = await chiudiCiVado(tx, id)
      await tx.insertInto('ci_vado').values({ dispositivo_id: id, punto_id: b.punto_id, prodotti: b.prodotti }).execute()
      return chiusi
    }).catch((e: { code?: string }) => {
      if (e.code === '23505') throw errore(409, 'Un altro «ci vado» di questo telefono era in corso: riprova.') // due richieste insieme
      throw e
    })
    conta('ci_vado')
    const altri = [...new Set(lasciati)].filter((p) => p !== b.punto_id)
    await Promise.all(altri.map(aggiorna))
    return { stato: await aggiorna(b.punto_id) }
  })

  app.post('/api/ci-vado/annulla', async (req) => {
    const id = await dispositivo(req)
    const chiusi = await chiudiCiVado(db, id)
    return { stato: chiusi.length ? await aggiorna(chiusi[0]) : null }
  })

  // Una visita: l'app si è aperta. Se il telefono ha già il suo identificativo anonimo, conta anche come visitatore di oggi.
  // `da` è l'etichetta del link da cui si è arrivati, se c'era (fonti.ts).
  app.post('/api/visita', { schema: corpo({ installata: { type: 'boolean' }, da: { type: 'string', maxLength: 64 } }, ['da']) }, async (req) => {
    const { installata, da } = req.body as { installata: boolean; da?: string }
    const fonte = fonteDellaVisita(da)
    // Qui si aspetta: chi legge le statistiche subito dopo una visita deve trovarla contata.
    await Promise.all([conta('visite'), installata && conta('visite_app'), fonte && contaFonte(fonte)])
    const token = req.headers.authorization?.replace(/^Bearer /, '')
    const id = token && leggiToken(segreto, token)
    if (id) {
      // Per contare i telefoni diversi del giorno basta un'impronta che domani sarà un'altra: l'identificativo non si salva.
      const giorno = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date()) // AAAA-MM-GG
      await sql`
        insert into presenze (giorno, impronta)
        select ${giorno}::date, ${improntaVisitatore(segreto, giorno, id)} where exists (select 1 from dispositivi where id = ${id}::uuid)
        on conflict do nothing
      `.execute(db)
    }
    return { ok: true }
  })

  // Il widget delle province si è aperto in un sito (una testata, un ente): si conta per dominio, non è una visita
  // dell'app. Nessun identificativo: il widget non ne crea.
  app.post('/api/widget/aperto', { schema: corpo({ sito: { type: 'string', maxLength: 255 } }, ['sito']) }, async (req, reply) => {
    const sito = sitoDelWidget((req.body as { sito?: string }).sito)
    if (sito) await contaFonte(sito, 'widget')
    return reply.code(204).send()
  })

  // --- Lettura ---

  app.get('/api/salute', async () => {
    await sql`select 1`.execute(db)
    return { ok: true }
  })

  // I distributori più vicini a un punto della mappa, con il loro stato. Il punto non si salva.
  // Con ovest, sud, est e nord solo quelli nella zona inquadrata: da vicino la mappa li mostra tutti.
  app.get('/api/vicini', {
    schema: {
      querystring: {
        type: 'object', required: ['lat', 'lon'],
        properties: {
          ...POSIZIONE, n: { type: 'integer', minimum: 1, maximum: 150, default: 20 }, prodotto: QUALSIASI_PRODOTTO, tipo: TIPO,
          ovest: POSIZIONE.lon, est: POSIZIONE.lon, sud: POSIZIONE.lat, nord: POSIZIONE.lat,
        },
      },
    },
  }, async (req) => {
    const q = req.query as { lat: number; lon: number; n: number; prodotto?: Prodotto; tipo: TipoPunto; ovest?: number; sud?: number; est?: number; nord?: number }
    if (q.prodotto && !PRODOTTI_DEL_TIPO[q.tipo].includes(q.prodotto)) throw errore(400, 'Questo prodotto non si vende in questo tipo di luogo.')
    const zona = q.ovest != null && q.sud != null && q.est != null && q.nord != null
    const { rows: punti } = await sql<{ id: number; nome: string; tipo: TipoPunto; marchio: string | null; indirizzo: string | null; comune: string | null; lat: number; lon: number; prodotti: Prodotto[] }>`
      select id, nome, tipo, marchio, indirizzo, comune, ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lon, prodotti
      from punti
      where attivo and tipo = ${q.tipo} and (${q.prodotto ?? null}::text is null or ${q.prodotto ?? null} = any(prodotti))
        and (not ${zona} or geom::geometry && ST_MakeEnvelope(${q.ovest ?? 0}, ${q.sud ?? 0}, ${q.est ?? 0}, ${q.nord ?? 0}, 4326))
      order by geom <-> ST_MakePoint(${q.lon}, ${q.lat})::geography
      limit ${q.n}
    `.execute(db)
    const s = await stati(punti.map((p) => p.id))
    return punti.map((punto) => ({ punto, stato: s.get(punto.id) ?? null }))
  })

  // La mappa da lontano: tutti i punti attivi del tipo (distributori o negozi) in forma compatta, [id, lat, lon, prodotti], e lo stato
  // di quelli con notizie. L'app li riassume in bolle per zona; poi gli aggiornamenti arrivano in tempo reale.
  // I prodotti sono una maschera di bit nell'ordine di TUTTI_I_PRODOTTI (benzina = 1, gasolio = 2, gpl = 4, metano = 8, poi i beni).
  // ponytail: tutto in una risposta con un minuto di cache (circa 6.000 righe); a riquadri se la copertura cresce molto.
  const cacheMappa = inCache<unknown>(60_000)
  app.get('/api/mappa', {
    schema: { querystring: { type: 'object', properties: { tipo: TIPO } } },
  }, async (req, reply) => {
    const { tipo } = req.query as { tipo: TipoPunto }
    const dati = await cacheMappa(tipo, async () => {
      const { rows: punti } = await sql<{ id: number; lat: number; lon: number; prodotti: Prodotto[] }>`
        select id, round(ST_Y(geom::geometry)::numeric, 5)::float8 as lat, round(ST_X(geom::geometry)::numeric, 5)::float8 as lon, prodotti
        from punti where attivo and tipo = ${tipo} order by id
      `.execute(db)
      const { rows: recenti } = await sql<{ id: number }>`
        select distinct s.punto_id as id from segnalazioni s join punti p on p.id = s.punto_id
        where s.visto_il > now() - ${VALIDITA} and not s.nascosta and p.attivo and p.tipo = ${tipo}
      `.execute(db)
      const s = await stati(recenti.map((r) => r.id))
      const maschera = (prodotti: Prodotto[]) => prodotti.reduce((m, p) => m | (1 << TUTTI_I_PRODOTTI.indexOf(p)), 0)
      return { punti: punti.map((p) => [p.id, p.lat, p.lon, maschera(p.prodotti)]), stati: [...s.values()].filter((x) => x.prodotti.length) }
    })
    reply.header('cache-control', 'public, max-age=60')
    return dati
  })

  // Prezzi comunicati al Ministero per un distributore. Cambiano una volta al giorno: si possono tenere in cache.
  app.get('/api/prezzi/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'integer' } } } },
  }, async (req, reply) => {
    const { id } = req.params as { id: number }
    const [{ rows: prezzi }, punto] = await Promise.all([
      sql<{ prodotto: Prodotto; self: boolean; prezzo: number }>`
        select prodotto, self, prezzo::float8 as prezzo from prezzi where punto_id = ${id} order by prodotto, self desc
      `.execute(db),
      db.selectFrom('punti').select('prezzi_comunicati_il').where('id', '=', id).executeTakeFirst(),
    ])
    if (!punto) throw errore(404, 'Distributore non trovato.')
    reply.header('cache-control', 'public, max-age=1800')
    return { prezzi, comunicati_il: punto.prezzi_comunicati_il }
  })

  // Le segnalazioni del telefono nelle ultime 24 ore, con quante persone hanno aperto la scheda dopo.
  app.get('/api/mie', async (req) => {
    const id = await dispositivo(req)
    const [segnalazioni, code, ciVado] = await Promise.all([
      sql`
        select s.id, s.prodotto, s.stato, s.creata_il, s.visto_il, s.a_distanza,
          json_build_object('id', p.id, 'nome', p.nome, 'tipo', p.tipo, 'marchio', p.marchio, 'indirizzo', p.indirizzo, 'comune', p.comune,
            'lat', ST_Y(p.geom::geometry), 'lon', ST_X(p.geom::geometry), 'prodotti', p.prodotti) as punto,
          (select count(*)::int from viste v where v.punto_id = s.punto_id and v.vista_il > s.creata_il and v.dispositivo_id <> ${id}) as viste
        from segnalazioni s join punti p on p.id = s.punto_id
        where s.dispositivo_id = ${id} and s.creata_il > now() - interval '24 hours' and not s.nascosta and not s.ritirata
        order by s.creata_il desc
      `.execute(db),
      sql`
        select punto_id, livello, creata_il from code
        where dispositivo_id = ${id} and creata_il > now() - interval '24 hours' and not nascosta
        order by creata_il desc
      `.execute(db),
      sql`
        select c.prodotti, c.creato_il,
          json_build_object('id', p.id, 'nome', p.nome, 'tipo', p.tipo, 'marchio', p.marchio, 'indirizzo', p.indirizzo, 'comune', p.comune,
            'lat', ST_Y(p.geom::geometry), 'lon', ST_X(p.geom::geometry), 'prodotti', p.prodotti) as punto
        from ci_vado c join punti p on p.id = c.punto_id
        where c.dispositivo_id = ${id} and c.chiuso_il is null and c.creato_il > now() - make_interval(mins => ${CI_VADO_MINUTI})
      `.execute(db),
    ])
    return { segnalazioni: segnalazioni.rows, code: code.rows, ci_vado: ciVado.rows[0] ?? null }
  })

  // --- Completare o correggere le proprie segnalazioni ---
  // Per un'ora si può completare la visita anche lontano dal distributore: la visita era già stata verificata.
  // Le modifiche tengono l'ora e il peso della visita originale (sul posto o a distanza).
  async function mia(req: FastifyRequest, finestraMinuti: number) {
    const id = await dispositivo(req)
    const s = await db.selectFrom('segnalazioni').selectAll()
      .where('id', '=', Number((req.params as { id: string }).id)).where('nascosta', '=', false).where('ritirata', '=', false)
      .executeTakeFirst()
    if (!s || s.dispositivo_id !== id) throw errore(404, 'Segnalazione non trovata tra le tue.')
    if (Date.now() - s.creata_il.getTime() > finestraMinuti * 60_000) {
      throw errore(403, `Una segnalazione si può modificare solo entro ${finestraMinuti >= 120 ? `${finestraMinuti / 60} ore` : `${finestraMinuti} minuti`}.`)
    }
    return { s, id }
  }

  // Cambiare lo stato: la vecchia si ritira e se ne crea una nuova. I voti degli altri restano sulla vecchia,
  // così non cambiano significato e chi corregge non può cancellarli.
  app.post('/api/segnalazioni/:id/correggi', {
    schema: corpo({ stato: { type: 'string', enum: ['disponibile', 'scarso', 'esaurito'] } }),
  }, async (req) => {
    const { s, id } = await mia(req, MODIFICA_MINUTI)
    const { stato } = req.body as { stato: Stato }
    if (stato === s.stato) return { segnalazione_id: s.id, stato: await aggiorna(s.punto_id) }
    const nuova = await db.transaction().execute(async (tx) => {
      await tx.updateTable('segnalazioni').set({ ritirata: true }).where('id', '=', s.id).execute()
      return tx.insertInto('segnalazioni').values({
        punto_id: s.punto_id, prodotto: s.prodotto, stato, dispositivo_id: id, a_distanza: s.a_distanza, visto_il: s.visto_il, creata_il: s.creata_il,
        visita: s.visita,
      }).returning('id').executeTakeFirstOrThrow()
    })
    return { segnalazione_id: nuova.id, stato: await aggiorna(s.punto_id) }
  })

  // Aggiungere un carburante dimenticato nella stessa visita.
  app.post('/api/segnalazioni/:id/aggiungi', {
    schema: corpo({ prodotto: QUALSIASI_PRODOTTO, stato: { type: 'string', enum: ['disponibile', 'scarso', 'esaurito'] } }),
  }, async (req) => {
    const { s, id } = await mia(req, MODIFICA_MINUTI)
    const { prodotto, stato } = req.body as { prodotto: Prodotto; stato: Stato }
    const { rows: [punto] } = await sql<{ tipo: TipoPunto; vende: boolean }>`
      select tipo, ${prodotto} = any(prodotti) as vende from punti where id = ${s.punto_id}`.execute(db)
    const { luogo, cosa, questa } = parole(punto.tipo)
    if (!punto.vende) throw errore(400, `Questo ${luogo} non ha ${punto.tipo === 'negozio' ? 'quella' : 'quel'} ${cosa}.`)
    const { rows: [gia] } = await sql`
      select 1 from segnalazioni where dispositivo_id = ${id} and punto_id = ${s.punto_id} and prodotto = ${prodotto} and not nascosta and not ritirata
        and abs(extract(epoch from creata_il - ${s.creata_il})) < ${MODIFICA_MINUTI * 60}
    `.execute(db)
    if (gia) throw errore(409, `${questa} l’hai già segnalat${punto.tipo === 'negozio' ? 'a' : 'o'}: puoi cambiarne lo stato.`)
    const nuova = await db.insertInto('segnalazioni').values({
      punto_id: s.punto_id, prodotto, stato, dispositivo_id: id, a_distanza: s.a_distanza, visto_il: s.visto_il, creata_il: s.creata_il,
      visita: s.visita,
    }).returning('id').executeTakeFirstOrThrow()
    return { segnalazione_id: nuova.id, stato: await aggiorna(s.punto_id) }
  })

  // Aggiungere la coda vista in quella visita: solo se eri sul posto, e vale per l'ora in cui c'eri.
  app.post('/api/segnalazioni/:id/coda', {
    schema: corpo({ livello: { type: 'string', enum: ['nessuna', 'breve', 'lunga'] } }),
  }, async (req) => {
    const { s, id } = await mia(req, MODIFICA_MINUTI)
    if (s.a_distanza) {
      const { rows: [punto] } = await sql<{ tipo: TipoPunto }>`select tipo from punti where id = ${s.punto_id}`.execute(db)
      throw errore(403, `La coda si segnala solo stando al ${parole(punto.tipo).luogo}.`)
    }
    const { livello } = req.body as { livello: LivelloCoda }
    await db.insertInto('code').values({ punto_id: s.punto_id, livello, dispositivo_id: id, creata_il: s.visto_il, visita: s.visita }).execute()
    return { stato: await aggiorna(s.punto_id) }
  })

  // Annullare tutta la visita (per esempio il distributore sbagliato), entro 4 ore.
  // Come per la correzione, i voti che altri avevano dato restano.
  app.post('/api/segnalazioni/:id/annulla', async (req) => {
    const { s, id } = await mia(req, 4 * 60)
    await sql`
      update segnalazioni set ritirata = true
      where dispositivo_id = ${id} and punto_id = ${s.punto_id} and abs(extract(epoch from creata_il - ${s.creata_il})) < ${MODIFICA_MINUTI * 60}
    `.execute(db)
    await sql`
      update code set nascosta = true
      where dispositivo_id = ${id} and punto_id = ${s.punto_id}
        and creata_il between ${s.visto_il}::timestamptz - interval '5 minutes' and ${s.creata_il}::timestamptz + make_interval(mins => ${MODIFICA_MINUTI})
    `.execute(db)
    return { stato: await aggiorna(s.punto_id) }
  })

  // Ricerca di comuni, indirizzi e distributori. Il testo cercato non si salva e non finisce nei log.
  const limiteRicerche = creaLimite(1200, 60 * 60 * 1000)
  app.get('/api/cerca', {
    schema: {
      querystring: {
        type: 'object', required: ['q'],
        properties: { q: { type: 'string', minLength: 1, maxLength: 100 }, tipo: { ...TIPO, default: undefined }, lat: { ...POSIZIONE.lat, default: 40.5 }, lon: { ...POSIZIONE.lon, default: 15.5 } },
      },
    },
  }, async (req) => {
    if (!limiteRicerche(req.ip)) throw errore(429, 'Troppe ricerche da questa rete. Riprova tra poco.')
    const { q, lat, lon, tipo: aperto } = req.query as { q: string; lat: number; lon: number; tipo?: TipoPunto }
    const centro = { lat, lon }
    conta('ricerche') // il testo cercato non si salva
    const domanda = interpreta(q)
    // Senza `tipo` (app vecchie, in cache) solo distributori, qualunque cosa dica la frase. Con `tipo`, il mondo della frase
    // vince su quello aperto: «latte vomero» dal lato carburanti porta ai negozi.
    const tipo: TipoPunto = !aperto ? 'distributore' : domanda.mondo === 'spesa' ? 'negozio' : domanda.mondo === 'carburante' ? 'distributore' : aperto
    const [comuni, trovati] = await Promise.all([cercaComuni(domanda, centro), cercaDistributori(domanda, centro, tipo)])
    const nominato = comuneNominato(comuni, domanda)
    const altri = await cercaLuoghi(domanda, nominato ?? centro)
    // I comuni che conosciamo non si ripetono tra i luoghi di Photon; quelli nel comune nominato vengono prima.
    const noti = new Set(comuni.map((c) => c.nome.toLowerCase()))
    const nelComune = (l: { dettaglio: string | null }) => !!nominato && !!l.dettaglio?.toLowerCase().includes(nominato.nome.toLowerCase())
    const fuori = altri.filter((l) => !noti.has(l.nome.toLowerCase())).sort((a, b) => +nelComune(b) - +nelComune(a))
    // Prima gli indirizzi se la frase è un indirizzo, o se un luogo corrisponde e nessun comune è proprio quello cercato.
    const esatto = comuni.some((c) => normalizza(c.nome).join(' ') === domanda.testo)
    const primaLuoghi = domanda.indirizzo || (!esatto && fuori.some((l) => centrato(l, domanda)))
    const s = await stati(trovati.map((t) => t.punto.id))
    return {
      luoghi: (primaLuoghi ? [...fuori, ...comuni] : [...comuni, ...fuori]).slice(0, 6),
      distributori: trovati.map((t) => ({ ...t, stato: s.get(t.punto.id) ?? null })),
      prodotto: domanda.prodotto,
      tipo,
    }
  })

  // ponytail: province, bollettino e conteggi del pannello contano solo i distributori; la spesa si aggiunge quando serve a qualcuno.
  // Situazione per provincia: quanti distributori hanno notizie recenti e di che colore.
  // ponytail: ricalcolata al massimo una volta al minuto per tutti; per provincia su richiesta se diventa lenta.
  const cacheProvince = inCache<unknown>(60_000)
  app.get('/api/province', async (req, reply) => {
    const dati = await cacheProvince('tutte', async () => {
      const { rows: totali } = await sql<{ provincia: string; distributori: number; lat: number; lon: number }>`
        select provincia, count(*)::int as distributori, avg(ST_Y(geom::geometry)) as lat, avg(ST_X(geom::geometry)) as lon
        from punti where attivo and tipo = 'distributore' and provincia is not null group by provincia
      `.execute(db)
      const { rows: recenti } = await sql<{ id: number; provincia: string }>`
        select distinct p.id, p.provincia from segnalazioni s join punti p on p.id = s.punto_id
        where s.visto_il > now() - ${VALIDITA} and not s.nascosta and p.attivo and p.tipo = 'distributore' and p.provincia is not null
      `.execute(db)
      const s = await stati(recenti.map((r) => r.id))
      const conteggi = new Map(totali.map((t) => [t.provincia, { ...t, verde: 0, giallo: 0, rosso: 0 }]))
      for (const r of recenti) {
        const colore = coloreDi(s.get(r.id))
        const c = conteggi.get(r.provincia)
        if (c && colore) c[colore]++
      }
      return [...conteggi.values()]
    })
    reply.header('cache-control', 'public, max-age=60')
    return dati
  })

  // I distributori di una provincia, o di tutte, con colore e conferme: il bollettino e la fotografia oraria contano
  // da qui, così il grafico dell'andamento dice gli stessi numeri del bollettino.
  async function distributoriPerProvincia(sigla: string | null) {
    const { rows: punti } = await sql<{ id: number; provincia: string; comune: string | null; lat: number; lon: number }>`
      select id, provincia, comune, ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lon from punti
      where attivo and tipo = 'distributore' and provincia is not null and (${sigla}::text is null or provincia = ${sigla})
    `.execute(db)
    const { rows: recenti } = await sql<{ id: number }>`
      select distinct s.punto_id as id from segnalazioni s join punti p on p.id = s.punto_id
      where s.visto_il > now() - ${VALIDITA} and not s.nascosta and p.attivo and p.tipo = 'distributore' and p.provincia is not null
        and (${sigla}::text is null or p.provincia = ${sigla})
    `.execute(db)
    const s = await stati(recenti.map((r) => r.id))
    const distributori = punti.map(({ id, provincia, comune, lat, lon }): DistributoreBollettino & { provincia: string } => {
      const prodotti = s.get(id)?.prodotti ?? []
      const ultimo = prodotti.reduce<string | null>((u, p) => (!u || Date.parse(p.ultimo) > Date.parse(u) ? p.ultimo : u), null)
      return { provincia, comune, lat, lon, colore: coloreDi(s.get(id)), confermato: finitoConfermato(prodotti), ultimo }
    })
    return Map.groupBy(distributori, (d) => d.provincia)
  }
  const contaColori = (distributori: DistributoreBollettino[]) => {
    const conta = (c: 'verde' | 'giallo' | 'rosso') => distributori.filter((d) => d.colore === c).length
    return { verde: conta('verde'), giallo: conta('giallo'), rosso: conta('rosso') }
  }

  // Una provincia per comune, per il bollettino di enti e testate: quali comuni sono senza carburante (bollettino.ts),
  // e l'andamento delle ultime 24 ore dalle fotografie orarie. Solo conteggi: nessun identificativo, nessuna segnalazione.
  const cacheBollettini = inCache<unknown>(60_000)
  app.get('/api/province/:sigla', {
    schema: { params: { type: 'object', properties: { sigla: { type: 'string', pattern: '^[A-Z]{2}$' } } } },
  }, async (req, reply) => {
    const { sigla } = req.params as { sigla: string }
    const dati = await cacheBollettini(sigla, async () => {
      const distributori = (await distributoriPerProvincia(sigla)).get(sigla)
      if (!distributori) throw errore(404, 'Provincia non trovata.')
      const { rows: andamento } = await sql`
        select ora, comuni_senza, comuni_senza_confermati, con_notizie, verde, giallo, rosso from andamento
        where provincia = ${sigla} and ora > now() - interval '24 hours' order by ora
      `.execute(db)
      const media = (v: number[]) => v.reduce((a, x) => a + x, 0) / v.length
      return {
        provincia: sigla, aggiornato_il: new Date().toISOString(), distributori: distributori.length, ...contaColori(distributori),
        lat: media(distributori.map((d) => d.lat)), lon: media(distributori.map((d) => d.lon)),
        comuni: comuniDelBollettino(distributori), andamento,
      }
    })
    reply.header('cache-control', 'public, max-age=60')
    return dati
  })

  // Ogni ora una fotografia dei numeri del bollettino di ogni provincia, per l'andamento (migrazione 009).
  // Se quella dell'ora c'è già non rifà niente: il server la chiama ogni 5 minuti, così riparte da sola dopo un riavvio.
  async function fotografaProvince() {
    const { rows: [{ fatta }] } = await sql<{ fatta: boolean }>`
      select exists (select 1 from andamento where ora = date_trunc('hour', now())) as fatta
    `.execute(db)
    if (fatta) return 0
    const righe = [...await distributoriPerProvincia(null)].map(([provincia, distributori]) => {
      const colori = contaColori(distributori)
      const senza = comuniDelBollettino(distributori).filter((c) => c.gruppo === 'senza_carburante')
      return {
        provincia, comuni_senza: senza.length, comuni_senza_confermati: senza.filter((c) => c.confermato).length,
        con_notizie: colori.verde + colori.giallo + colori.rosso, ...colori,
      }
    })
    const esito = await sql`
      insert into andamento (provincia, ora, comuni_senza, comuni_senza_confermati, con_notizie, verde, giallo, rosso)
      select x.provincia, date_trunc('hour', now()), x.comuni_senza, x.comuni_senza_confermati, x.con_notizie, x.verde, x.giallo, x.rosso
      from json_to_recordset(${JSON.stringify(righe)}::json)
        as x(provincia text, comuni_senza int, comuni_senza_confermati int, con_notizie int, verde int, giallo int, rosso int)
      on conflict do nothing
    `.execute(db)
    const scritte = Number(esito.numAffectedRows ?? 0)
    if (scritte) await valutaAvvisi().catch((e) => app.log.error(e, 'avvisi non valutati'))
    return scritte
  }

  // Dopo la fotografia dell'ora: per ogni provincia, adesso contro l'ultima fotografia tra 6 e 12 ore prima (più vecchia
  // non dice niente di stamattina) e contro l'ultimo avviso (avvisi.ts). Un avviso nuovo si salva e, se la regione ha il
  // suo canale, parte su Telegram; se Telegram non risponde resta nel feed e non si ripete.
  async function valutaAvvisi() {
    const { rows } = await sql<{
      provincia: string; ora: Date; confermati: number
      prima: { ora: string; confermati: number } | null
      ultimo: { tipo: TipoAvviso; ora: string; confermati: number } | null
    }>`
      select a.provincia, a.ora, a.comuni_senza_confermati as confermati,
        (select json_build_object('ora', p.ora, 'confermati', p.comuni_senza_confermati) from andamento p
          where p.provincia = a.provincia and p.ora between a.ora - interval '12 hours' and a.ora - interval '6 hours'
          order by p.ora desc limit 1) as prima,
        (select json_build_object('tipo', v.tipo, 'ora', v.ora, 'confermati', v.adesso) from avvisi v
          where v.provincia = a.provincia order by v.ora desc limit 1) as ultimo
      from andamento a where a.ora = date_trunc('hour', now())
    `.execute(db)
    for (const r of rows) {
      const a = decidiAvviso(
        { ora: r.ora, confermati: r.confermati },
        r.prima && { ora: new Date(r.prima.ora), confermati: r.prima.confermati },
        r.ultimo && { ...r.ultimo, ora: new Date(r.ultimo.ora) },
      )
      if (!a) continue
      const { rows: [nuovo] } = await sql<{ id: number }>`
        insert into avvisi (provincia, ora, tipo, adesso, prima, ora_prima)
        values (${r.provincia}, ${r.ora}, ${a.tipo}, ${a.adesso}, ${a.prima}, ${a.ora_prima})
        on conflict do nothing returning id
      `.execute(db)
      const nome = nomeProvincia(r.provincia)
      const canale = avvisi?.canali[regioneDi(r.provincia) ?? '']
      if (!nuovo || !avvisi || !canale || !nome) continue
      if (await avvisi.invia(canale, testoAvviso(r.provincia, nome, a, avvisi.origine, 'telegram'), new Date())) {
        await sql`update avvisi set telegram_il = now() where id = ${nuovo.id}`.execute(db)
      }
    }
  }

  // Il feed RSS degli avvisi di una provincia, ultimi 30 giorni: per chi lo collega al suo lettore, a Slack o all'email.
  app.get('/api/province/:sigla/avvisi.rss', {
    schema: { params: { type: 'object', properties: { sigla: { type: 'string', pattern: '^[A-Z]{2}$' } } } },
  }, async (req, reply) => {
    const { sigla } = req.params as { sigla: string }
    const nome = nomeProvincia(sigla)
    if (!nome) throw errore(404, 'Provincia non trovata.')
    const { rows } = await sql<AvvisoSalvato>`
      select id, provincia, tipo, ora, adesso, prima, ora_prima from avvisi
      where provincia = ${sigla} and ora > now() - interval '30 days' order by ora desc
    `.execute(db)
    reply.header('content-type', 'application/rss+xml; charset=utf-8').header('cache-control', 'public, max-age=300')
    return rssAvvisi(sigla, nome, avvisi?.origine ?? `${req.protocol}://${req.host}`, rows)
  })

  // I canali Telegram per la pagina degli avvisi: solo quelli in cui il bot scrive davvero.
  app.get('/api/avvisi/canali', async (_, reply) => {
    reply.header('cache-control', 'public, max-age=300')
    return Object.entries(avvisi?.canali ?? {}).map(([regione, canale]) => ({ regione, canale, link: `https://t.me/${canale.slice(1)}` }))
  })

  // Dati aperti (ODbL): tutte le segnalazioni visibili, senza alcun identificativo del telefono.
  // ponytail: tutto in memoria a ogni richiesta, con 5 minuti di cache; a flusso quando le righe diventano centinaia di migliaia.
  app.get('/api/export/segnalazioni.:formato', async (req, reply) => {
    const { formato } = req.params as { formato: string }
    if (formato !== 'csv' && formato !== 'geojson') throw errore(404, 'Formato non disponibile: usa .csv o .geojson')
    const { rows } = await sql<Record<string, string | number | boolean | null>>`
      select s.id, s.punto_id, p.nome as distributore, p.comune, ST_Y(p.geom::geometry) as lat, ST_X(p.geom::geometry) as lon,
        s.prodotto, s.stato, to_char(date_trunc('minute', s.visto_il) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as visto_il,
        s.a_distanza,
        (select count(*)::int from voti v where v.segnalazione_id = s.id and v.conferma and ${votoValido}) as conferme,
        (select count(*)::int from voti v where v.segnalazione_id = s.id and not v.conferma and ${votoValido}) as smentite,
        p.tipo
      from segnalazioni s
      join punti p on p.id = s.punto_id
      left join dispositivi d on d.id = s.dispositivo_id
      where not s.nascosta and not s.ritirata and not coalesce(d.bloccato, false)
      order by s.id
    `.execute(db)
    reply.header('cache-control', 'public, max-age=300')
    reply.header('content-disposition', `attachment; filename="scorty-segnalazioni.${formato}"`)
    if (formato === 'geojson') {
      reply.type('application/geo+json')
      return {
        type: 'FeatureCollection',
        licenza: 'ODbL 1.0 - https://opendatacommons.org/licenses/odbl/ - Fonte: Scorty (scorty.it) e OpenStreetMap contributors',
        features: rows.map(({ lat, lon, ...proprieta }) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: proprieta })),
      }
    }
    reply.type('text/csv; charset=utf-8')
    return comeCsv(rows)
  })

  // --- Scrittura ---

  // A distanza si fanno al massimo 3 azioni all'ora; una visita a un negozio ne vale una, qualunque sia il numero di righe.
  async function limiteADistanza(id: string) {
    const { rows: [{ n }] } = await sql<{ n: number }>`
      select count(distinct coalesce(visita::text, 's' || id))::int as n from segnalazioni
      where dispositivo_id = ${id} and a_distanza and creata_il > now() - interval '1 hour'
    `.execute(db)
    if (n >= A_DISTANZA_ORA) throw errore(429, `Puoi fare al massimo ${A_DISTANZA_ORA} segnalazioni a distanza all’ora.`)
  }

  // Sul posto (entro 300 m) o a distanza (entro 30 km, visto fino a 3 ore fa): a distanza conta la metà.
  app.post('/api/segnalazioni', {
    schema: corpo({
      punto_id: { type: 'integer' }, prodotto: PRODOTTO, stato: { type: 'string', enum: ['disponibile', 'scarso', 'esaurito'] }, ...POSIZIONE,
      minuti_fa: { type: 'integer', minimum: 0, maximum: 180 },
    }, ['minuti_fa']),
  }, async (req) => {
    const b = req.body as { punto_id: number; prodotto: Prodotto; stato: Stato; lat: number; lon: number; minuti_fa?: number }
    const { id, metri, tipo } = await controlla(req, b.punto_id, b, DISTANZA_MAX)
    if (tipo === 'negozio') throw errore(400, 'Per un negozio si usa la visita: «Com’è lo scaffale?».')
    const aDistanza = metri > RAGGIO
    if (aDistanza) await limiteADistanza(id)
    const { rows: [vende] } = await sql`select 1 from punti where id = ${b.punto_id} and ${b.prodotto} = any(prodotti)`.execute(db)
    if (!vende) throw errore(400, 'Questo distributore non ha quel carburante.')
    const minuti = aDistanza ? (b.minuti_fa ?? 0) : 0 // sul posto si segnala adesso
    const s = await db.transaction().execute(async (tx) => {
      const nuova = await tx.insertInto('segnalazioni')
        .values({
          punto_id: b.punto_id, prodotto: b.prodotto, stato: b.stato, dispositivo_id: id,
          a_distanza: aDistanza, visto_il: sql`now() - make_interval(mins => ${minuti})`,
        })
        .returning('id').executeTakeFirstOrThrow()
      await chiudiCiVado(tx, id, b.punto_id)
      return nuova
    })
    return { segnalazione_id: s.id, stato: await aggiorna(b.punto_id) }
  })

  // La visita a un negozio: più categorie e la coda in un solo invio, un'azione sola. Le righe hanno la stessa `visita`.
  // A distanza (oltre 300 m) niente coda, come per i distributori.
  app.post('/api/visite', {
    schema: corpo({
      punto_id: { type: 'integer' },
      risposte: {
        type: 'array', maxItems: BENI.length,
        items: { type: 'object', required: ['prodotto', 'stato'], additionalProperties: false, properties: { prodotto: BENE, stato: { type: 'string', enum: ['disponibile', 'scarso', 'esaurito'] } } },
      },
      coda: { type: 'string', enum: ['nessuna', 'breve', 'lunga'] },
      ...POSIZIONE,
      minuti_fa: { type: 'integer', minimum: 0, maximum: 180 },
    }, ['risposte', 'coda', 'minuti_fa']),
  }, async (req) => {
    const b = req.body as { punto_id: number; risposte?: { prodotto: Prodotto; stato: Stato }[]; coda?: LivelloCoda; lat: number; lon: number; minuti_fa?: number }
    const risposte = b.risposte ?? []
    if (!risposte.length && !b.coda) throw errore(400, 'Manca qualcosa: indica almeno una categoria o la coda.')
    if (new Set(risposte.map((r) => r.prodotto)).size !== risposte.length) throw errore(400, 'Ogni categoria si indica una volta sola.')
    const { id, metri, tipo } = await controlla(req, b.punto_id, b, DISTANZA_MAX)
    if (tipo !== 'negozio') throw errore(400, 'La visita è solo per i negozi.')
    const aDistanza = metri > RAGGIO
    if (aDistanza) {
      if (b.coda) throw errore(403, 'La coda si segnala solo stando al negozio.')
      await limiteADistanza(id)
    }
    const { rows: [punto] } = await sql<{ non_vende: string | null }>`
      select (select p from unnest(${risposte.map((r) => r.prodotto)}::text[]) p where p <> all(prodotti) limit 1) as non_vende from punti where id = ${b.punto_id}`.execute(db)
    if (punto.non_vende) throw errore(400, 'Questo negozio non ha quella categoria.')
    const minuti = aDistanza ? (b.minuti_fa ?? 0) : 0 // sul posto si segnala adesso
    const visita = randomUUID()
    const ids = await db.transaction().execute(async (tx) => {
      const inserite: number[] = []
      for (const r of risposte) {
        const { id: nuova } = await tx.insertInto('segnalazioni').values({
          punto_id: b.punto_id, prodotto: r.prodotto, stato: r.stato, dispositivo_id: id,
          a_distanza: aDistanza, visto_il: sql`now() - make_interval(mins => ${minuti})`, visita,
        }).returning('id').executeTakeFirstOrThrow()
        inserite.push(nuova)
      }
      if (b.coda) await tx.insertInto('code').values({ punto_id: b.punto_id, livello: b.coda, dispositivo_id: id, visita }).execute()
      // Chi ha detto «ci vado» e ci è stato ha chiuso il giro.
      await chiudiCiVado(tx, id, b.punto_id)
      return inserite
    })
    return { segnalazioni: ids, stato: await aggiorna(b.punto_id) }
  })

  app.post('/api/voti', {
    schema: corpo({ segnalazione_id: { type: 'integer' }, conferma: { type: 'boolean' }, ...POSIZIONE }),
  }, async (req) => {
    const b = req.body as { segnalazione_id: number; conferma: boolean; lat: number; lon: number }
    const segnalazione = await db.selectFrom('segnalazioni').select(['punto_id', 'dispositivo_id'])
      .where('id', '=', b.segnalazione_id).where('nascosta', '=', false).executeTakeFirst()
    if (!segnalazione) throw errore(404, 'Segnalazione non trovata.')
    const { id } = await controlla(req, segnalazione.punto_id, b)
    if (segnalazione.dispositivo_id === id) throw errore(403, 'Non puoi confermare una tua segnalazione.')
    // Un voto per segnalazione e telefono: votare di nuovo cambia il voto.
    await db.transaction().execute(async (tx) => {
      await tx.insertInto('voti').values({ segnalazione_id: b.segnalazione_id, dispositivo_id: id, conferma: b.conferma })
        .onConflict((oc) => oc.columns(['segnalazione_id', 'dispositivo_id']).doUpdateSet({ conferma: b.conferma, creato_il: sql`now()` }))
        .execute()
      await chiudiCiVado(tx, id, segnalazione.punto_id)
    })
    return { stato: await aggiorna(segnalazione.punto_id) }
  })

  app.post('/api/code', {
    schema: corpo({ punto_id: { type: 'integer' }, livello: { type: 'string', enum: ['nessuna', 'breve', 'lunga'] }, ...POSIZIONE }),
  }, async (req) => {
    const b = req.body as { punto_id: number; livello: LivelloCoda; lat: number; lon: number }
    const { id } = await controlla(req, b.punto_id, b)
    await db.transaction().execute(async (tx) => {
      await tx.insertInto('code').values({ punto_id: b.punto_id, livello: b.livello, dispositivo_id: id }).execute()
      await chiudiCiVado(tx, id, b.punto_id)
    })
    return { stato: await aggiorna(b.punto_id) }
  })

  // Apertura di una scheda: serve per "vista da N persone" e "molto cercato". Si cancella dopo 24 ore.
  app.post('/api/viste', { schema: corpo({ punto_id: { type: 'integer' } }) }, async (req) => {
    const id = await dispositivo(req)
    const { punto_id } = req.body as { punto_id: number }
    conta('schede')
    await db.insertInto('viste').values({ punto_id, dispositivo_id: id })
      .onConflict((oc) => oc.columns(['punto_id', 'dispositivo_id']).doUpdateSet({ vista_il: sql`now()` }))
      .execute()
    return { ok: true }
  })

  app.post('/api/correzioni', {
    schema: {
      body: {
        type: 'object', required: ['punto_id', 'tipo', 'messaggio', 'contatto'], additionalProperties: false,
        properties: {
          punto_id: { type: 'integer' },
          tipo: { type: 'string', enum: ['dati_errati', 'chiuso', 'gestore', 'altro'] },
          marchio: { type: ['string', 'null'], maxLength: 50 },
          messaggio: { type: 'string', maxLength: 2000 },
          contatto: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (req) => {
    if (!limiteCorrezioni(req.ip)) throw errore(429, 'Troppe richieste da questa rete. Riprova più tardi.')
    const b = req.body as { punto_id: number; tipo: 'dati_errati' | 'chiuso' | 'gestore' | 'altro'; marchio?: string | null; messaggio: string; contatto: string }
    if (b.tipo === 'gestore' ? !b.contatto.trim() : !b.messaggio.trim()) throw errore(400, 'Manca qualcosa: controlla il modulo.')
    await db.insertInto('correzioni').values({
      punto_id: b.punto_id, tipo: b.tipo, marchio: b.marchio || null, messaggio: b.messaggio.trim(), contatto: b.contatto.trim() || null,
    }).execute()
    return { ok: true }
  })

  // --- Moderazione ---
  // Una sola password, dal file .env (ADMIN_PASSWORD). Senza password il pannello è spento.
  const sha = (t: string) => createHash('sha256').update(t).digest()
  const attesa = passwordAdmin.length >= 16 ? sha(passwordAdmin) : null
  const limiteAdmin = creaLimite(20, 60 * 60 * 1000) // tentativi sbagliati per rete

  async function admin(req: FastifyRequest) {
    if (!attesa) throw errore(404, 'Pannello non attivo: imposta ADMIN_PASSWORD nel file .env')
    const data = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
    if (timingSafeEqual(sha(data), attesa)) return
    if (!limiteAdmin(req.ip)) throw errore(429, 'Troppi tentativi. Riprova tra un’ora.')
    throw errore(401, 'Password sbagliata.')
  }

  // Dopo un intervento del moderatore gli stati vanno ricalcolati e mandati a chi guarda.
  const ricalcola = async (punti: number[]) => {
    for (const id of new Set(punti)) await aggiorna(id)
  }

  app.get('/api/admin/riepilogo', async (req) => {
    await admin(req)
    const { rows: [r] } = await sql`
      select
        (select count(*)::int from dispositivi) as dispositivi,
        (select count(*)::int from dispositivi where bloccato) as bloccati,
        (select count(*)::int from segnalazioni where creata_il > now() - interval '24 hours') as segnalazioni_24h,
        (select count(*)::int from anomalie where creata_il > now() - interval '24 hours') as anomalie_24h,
        (select count(*)::int from correzioni where chiusa_il is null) as correzioni_aperte,
        (select count(*)::int from punti where attivo and tipo = 'distributore') as distributori,
        (select max(aggiornato_il) from punti where fonte = 'osm') as distributori_aggiornati_il
    `.execute(db)
    return r
  })

  app.get('/api/admin/segnalazioni', async (req) => {
    await admin(req)
    const { rows } = await sql`
      select s.id, s.creata_il, s.visto_il, s.prodotto, s.stato, s.a_distanza, s.nascosta, s.ritirata, s.dispositivo_id,
        coalesce(d.bloccato, false) as bloccato, p.id as punto_id, p.nome, p.tipo, p.comune,
        (select count(*)::int from voti v where v.segnalazione_id = s.id and v.conferma) as conferme,
        (select count(*)::int from voti v where v.segnalazione_id = s.id and not v.conferma) as smentite,
        (select count(*)::int from anomalie a where a.dispositivo_id = s.dispositivo_id and a.creata_il > now() - interval '24 hours') as anomalie
      from segnalazioni s join punti p on p.id = s.punto_id left join dispositivi d on d.id = s.dispositivo_id
      order by s.id desc limit 200
    `.execute(db)
    return rows
  })

  app.post('/api/admin/segnalazioni/:id', { schema: corpo({ nascosta: { type: 'boolean' } }) }, async (req) => {
    await admin(req)
    const { nascosta } = req.body as { nascosta: boolean }
    const s = await db.updateTable('segnalazioni').set({ nascosta }).where('id', '=', Number((req.params as { id: string }).id))
      .returning('punto_id').executeTakeFirst()
    if (!s) throw errore(404, 'Segnalazione non trovata.')
    await ricalcola([s.punto_id])
    return { ok: true }
  })

  app.post('/api/admin/dispositivi/:id', { schema: corpo({ bloccato: { type: 'boolean' } }) }, async (req) => {
    await admin(req)
    const id = (req.params as { id: string }).id
    if (!/^[0-9a-f-]{36}$/.test(id)) throw errore(400, 'Identificativo non valido.')
    const { bloccato } = req.body as { bloccato: boolean }
    const d = await db.updateTable('dispositivi').set({ bloccato }).where('id', '=', id).returning('id').executeTakeFirst()
    if (!d) throw errore(404, 'Dispositivo non trovato.')
    const { rows } = await sql<{ punto_id: number }>`
      select punto_id from segnalazioni where dispositivo_id = ${id} and visto_il > now() - ${VALIDITA}
      union select s.punto_id from voti v join segnalazioni s on s.id = v.segnalazione_id where v.dispositivo_id = ${id} and v.creato_il > now() - ${VALIDITA}
      union select punto_id from code where dispositivo_id = ${id} and creata_il > now() - interval '1 hour'
      union select punto_id from ci_vado where dispositivo_id = ${id} and chiuso_il is null and creato_il > now() - make_interval(mins => ${CI_VADO_MINUTI})
    `.execute(db)
    await ricalcola(rows.map((r) => r.punto_id))
    return { ok: true }
  })

  // Statistiche per il pannello: ultimi 30 giorni, ripartizioni e quante persone hanno la mappa aperta adesso.
  app.get('/api/admin/statistiche', async (req) => {
    await admin(req)
    const [giorni, province, prodotti, ore, totali, fonti, widget] = await Promise.all([
      sql`
        with g as (select generate_series(${OGGI} - 29, ${OGGI}, interval '1 day')::date as giorno),
        s as (select giorno, chiave, valore from statistiche where giorno >= ${OGGI} - 29),
        oggi as (select count(*)::int as n from presenze where giorno = ${OGGI}),
        segn as (
          select (visto_il at time zone 'Europe/Rome')::date as giorno, count(*)::int as n,
            count(*) filter (where a_distanza)::int as a_distanza
          from segnalazioni where visto_il >= ${OGGI} - 29 group by 1
        ),
        vot as (
          select (creato_il at time zone 'Europe/Rome')::date as giorno,
            count(*) filter (where conferma)::int as conferme, count(*) filter (where not conferma)::int as smentite
          from voti where creato_il >= ${OGGI} - 29 group by 1
        ),
        cod as (select (creata_il at time zone 'Europe/Rome')::date as giorno, count(*)::int as n from code where creata_il >= ${OGGI} - 29 group by 1),
        tel as (select (creato_il at time zone 'Europe/Rome')::date as giorno, count(*)::int as n from dispositivi where creato_il >= ${OGGI} - 29 group by 1)
        select to_char(g.giorno, 'YYYY-MM-DD') as giorno,
          coalesce((select valore from s where s.giorno = g.giorno and chiave = 'visite'), 0) as visite,
          coalesce((select valore from s where s.giorno = g.giorno and chiave = 'visite_app'), 0) as visite_app,
          case when g.giorno = ${OGGI} then (select n from oggi)
            else coalesce((select valore from s where s.giorno = g.giorno and chiave = 'visitatori'), 0) end as visitatori,
          coalesce((select valore from s where s.giorno = g.giorno and chiave = 'ricerche'), 0) as ricerche,
          coalesce((select valore from s where s.giorno = g.giorno and chiave = 'schede'), 0) as schede,
          coalesce((select valore from s where s.giorno = g.giorno and chiave = 'ci_vado'), 0) as ci_vado,
          coalesce(segn.n, 0) as segnalazioni, coalesce(segn.a_distanza, 0) as a_distanza,
          coalesce(vot.conferme, 0) as conferme, coalesce(vot.smentite, 0) as smentite,
          coalesce(cod.n, 0) as code, coalesce(tel.n, 0) as nuovi_telefoni
        from g left join segn using (giorno) left join vot using (giorno) left join cod using (giorno) left join tel using (giorno)
        order by g.giorno
      `.execute(db),
      sql`
        select p.provincia, count(*)::int as segnalazioni from segnalazioni s join punti p on p.id = s.punto_id
        where s.visto_il >= ${OGGI} - 29 and p.tipo = 'distributore' and p.provincia is not null group by 1 order by 2 desc limit 10
      `.execute(db),
      sql`
        select prodotto, stato, count(*)::int as n from segnalazioni where visto_il >= ${OGGI} - 29 group by 1, 2
      `.execute(db),
      sql`
        select extract(hour from visto_il at time zone 'Europe/Rome')::int as ora, count(*)::int as n
        from segnalazioni where visto_il >= ${OGGI} - 29 group by 1
      `.execute(db),
      sql`
        select (select count(*)::int from dispositivi) as telefoni,
          (select count(*)::int from segnalazioni) as segnalazioni,
          (select count(*)::int from voti) as voti,
          (select coalesce(sum(valore), 0)::int from statistiche where chiave = 'visite') as visite
      `.execute(db),
      sql`
        select substr(chiave, 7) as fonte, sum(valore)::int as visite from statistiche
        where giorno >= ${OGGI} - 29 and chiave like 'fonte:%' group by 1 order by 2 desc, 1 limit 20
      `.execute(db),
      sql`
        select substr(chiave, 8) as sito, sum(valore)::int as aperture from statistiche
        where giorno >= ${OGGI} - 29 and chiave like 'widget:%' group by 1 order by 2 desc, 1 limit 30
      `.execute(db),
    ])
    const perOra = Array.from({ length: 24 }, (_, h) => (ore.rows as { ora: number; n: number }[]).find((r) => r.ora === h)?.n ?? 0)
    return {
      collegati: collegati.size, giorni: giorni.rows, province: province.rows, prodotti: prodotti.rows, ore: perOra, totali: totali.rows[0],
      fonti: fonti.rows, widget: widget.rows,
    }
  })

  app.get('/api/admin/anomalie', async (req) => {
    await admin(req)
    const { rows } = await sql`
      select a.id, a.tipo, a.dettagli, a.creata_il, a.dispositivo_id, coalesce(d.bloccato, false) as bloccato,
        (select p.tipo from punti p where p.id = (a.dettagli->>'punto_id')::int) as punto_tipo
      from anomalie a left join dispositivi d on d.id = a.dispositivo_id
      order by a.id desc limit 200
    `.execute(db)
    return rows
  })

  app.get('/api/admin/correzioni', async (req) => {
    await admin(req)
    const { rows } = await sql`
      select c.id, c.tipo, c.marchio, c.messaggio, c.contatto, c.creata_il, c.chiusa_il, p.id as punto_id, p.nome, p.tipo as punto_tipo, p.comune
      from correzioni c join punti p on p.id = c.punto_id
      order by c.chiusa_il is not null, c.id desc limit 200
    `.execute(db)
    return rows
  })

  app.post('/api/admin/correzioni/:id/chiudi', async (req) => {
    await admin(req)
    const c = await db.updateTable('correzioni').set({ chiusa_il: new Date() })
      .where('id', '=', Number((req.params as { id: string }).id)).where('chiusa_il', 'is', null).returning('id').executeTakeFirst()
    if (!c) throw errore(404, 'Richiesta non trovata o già chiusa.')
    return { ok: true }
  })

  // La fotografia oraria la chiama server.ts con un timer, e i test direttamente: non è una rotta.
  return Object.assign(app, { fotografaProvince })
}
