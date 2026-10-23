// Le province coperte, per regione. Le usano l'app e la build (vite.config.ts), che ne ricava
// una pagina statica per ogni provincia, per Google e per le anteprime dei link.
export const REGIONI: [string, Record<string, string>][] = [
  ['Campania', { AV: 'Avellino', BN: 'Benevento', CE: 'Caserta', NA: 'Napoli', SA: 'Salerno' }],
  ['Puglia', { BA: 'Bari', BT: 'Barletta-Andria-Trani', BR: 'Brindisi', FG: 'Foggia', LE: 'Lecce', TA: 'Taranto' }],
  ['Basilicata', { MT: 'Matera', PZ: 'Potenza' }],
  ['Calabria', { CZ: 'Catanzaro', CS: 'Cosenza', KR: 'Crotone', RC: 'Reggio Calabria', VV: 'Vibo Valentia' }],
  ['Sicilia', {
    AG: 'Agrigento', CL: 'Caltanissetta', CT: 'Catania', EN: 'Enna', ME: 'Messina', PA: 'Palermo', RG: 'Ragusa', SR: 'Siracusa', TP: 'Trapani',
  }],
]

export const nomeProvincia = (sigla: string) => REGIONI.map(([, p]) => p[sigla]).find(Boolean) ?? sigla
export const provinciaNota = (sigla: string) => REGIONI.some(([, p]) => Object.hasOwn(p, sigla))
