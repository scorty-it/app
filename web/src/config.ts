// Dati di chi gestisce questa istanza di Scorty: compilali prima del deploy.
// Il titolare del trattamento arriva dalla build (TITOLARE nel file .env, vedi compose.yml): il nome di una persona
// va nella pagina Privacy, dove la legge lo chiede, ma non nel codice pubblico.
export const TITOLARE = import.meta.env.VITE_TITOLARE || '[titolare non indicato: imposta TITOLARE nel file .env]'
export const EMAIL_CONTATTI = 'info@scorty.it'
export const REPO_URL = 'https://github.com/scorty-it/app'
// Vuoto = sezione donazioni nascosta.
export const DONAZIONI_URL = ''
