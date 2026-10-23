// Da dove arriva una visita: l'etichetta ?da= dei link che pubblichiamo (scorty.it/?da=whatsapp, ?da=qr-bari).
// La sceglie chi pubblica il link, non descrive chi visita, e diventa solo un numero nelle statistiche del giorno.

// Quante etichette diverse si contano in un giorno: oltre, un link inventato non apre righe nuove (vedi contaFonte in app.ts).
export const MAX_FONTI_AL_GIORNO = 30

// L'etichetta da contare, così come finisce nelle statistiche, oppure null se non va contata.
// `da` arriva com'è dall'indirizzo, al massimo 64 caratteri: chiunque può scriverci quello che vuole.
// Formato libero, così una campagna nuova (?da=fb-bari-24ott) si conta senza un deploy: le etichette inventate
// le ferma il tetto del giorno. Maiuscole e spazi ai bordi non fanno un'etichetta diversa.
export function fonteDellaVisita(da: string | undefined): string | null {
  const fonte = da?.trim().toLowerCase()
  return fonte && /^[a-z0-9-]{1,32}$/.test(fonte) ? fonte : null
}

// Il sito che ospita il widget delle province: il dominio della pagina, che il widget legge da document.referrer.
// È il nome di un sito, non dice niente di chi legge. Senza referrer (il sito lo nasconde) si conta come «sconosciuto»;
// quello che non è un dominio non si conta. Anche qui i siti nuovi del giorno hanno il tetto MAX_FONTI_AL_GIORNO.
const ETICHETTA = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const DOMINIO = new RegExp(`^${ETICHETTA}(?:\\.${ETICHETTA})+$`)
export function sitoDelWidget(sito: string | undefined): string | null {
  const s = sito?.trim().toLowerCase().replace(/^www\./, '')
  if (!s) return 'sconosciuto'
  return s.length <= 100 && DOMINIO.test(s) ? s : null
}
