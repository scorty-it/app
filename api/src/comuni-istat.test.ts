import assert from 'node:assert/strict'
import { test } from 'node:test'
import { leggiCsv, tabelleComuni } from './comuni-istat.ts'

test('CSV dell’ISTAT: punto e virgola e a capo tra virgolette, virgolette raddoppiate', () => {
  assert.deepEqual(leggiCsv('a;"b;c"\r\n"d\ne";""""\n\n'), [['a', 'b;c'], ['d\ne', '"']])
})

// Come i file veri: intestazione con un a capo tra virgolette, colonne che non servono, campi con il punto e virgola.
const ELENCO = `Codice Regione;"Codice dell'Unità territoriale sovracomunale
(valida a fini statistici)";Codice Comune formato alfanumerico;Denominazione (Italiana e straniera);Denominazione in italiano;Denominazione Regione;"Denominazione dell'Unità territoriale sovracomunale
(valida a fini statistici)";Sigla automobilistica
18;078;078157;Corigliano-Rossano;Corigliano-Rossano;Calabria;Cosenza;CS
18;078;078001;Acquaformosa;Acquaformosa;Calabria;Cosenza;CS
16;075;075098;Presicce-Acquarica;Presicce-Acquarica;Puglia;Lecce;LE
16;075;075023;Corigliano d'Otranto;Corigliano d'Otranto;Puglia;Lecce;LE
15;065;065025;Capaccio Paestum;Capaccio Paestum;Campania;Salerno;SA
16;072;072006;Bari;Bari;Puglia;Bari;BA
16;110;110002;Barletta;Barletta;Puglia;Barletta-Andria-Trani;BT
`
const VARIAZIONI = `Anno;Tipo variazione;Codice Regione;Codice Unità territoriale sovracomunale;Codice Comune formato alfanumerico;Denominazione Comune;Codice Regione associato alla variazione;Codice Unità territoriale sovracomunale associato alla variazione;Codice del Comune associato alla variazione o nuovo codice Istat del Comune ;Denominazione Comune associata alla variazione o nuova denominazione;Provvedimento e Documento
2018;ES;18;078;078044;Corigliano Calabro;18;078;078157;Corigliano-Rossano;"Legge Regionale 2 febbraio 2018, n. 2; B.U.R. n. 13"
2018;ES;18;078;078108;Rossano;18;078;078157;Corigliano-Rossano;"Legge Regionale 2 febbraio 2018, n. 2;
B.U.R. n. 13"
2016;CD;15;065;065025;Capaccio;15;065;065025;Capaccio Paestum;
1995;ES;16;072;072998;Borgo Antico;16;072;072007;Barletta;
2009;AP;16;072;072007;Barletta;16;110;110002;;
2000;ES;18;078;078500;Diviso;18;078;078157;Corigliano-Rossano;
2000;ES;18;078;078500;Diviso;18;078;078001;Acquaformosa;
`

test('tabelle dei comuni: quelli di oggi per provincia e i nomi vecchi con il comune di oggi', () => {
  assert.deepEqual(tabelleComuni(ELENCO, VARIAZIONI), {
    attuali: {
      BA: ['Bari'],
      BT: ['Barletta'],
      CS: ['Acquaformosa', 'Corigliano-Rossano'],
      LE: ["Corigliano d'Otranto", 'Presicce-Acquarica'],
      SA: ['Capaccio Paestum'],
    },
    // Borgo Antico: fuso in Barletta, che poi è passata da Bari a Barletta-Andria-Trani con un codice nuovo.
    // Diviso tra due comuni: non c'è un comune di oggi unico, resta fuori. Barletta (BA) cambia provincia, non nome.
    vecchi: {
      BA: { 'Borgo Antico': 'Barletta' },
      CS: { 'Corigliano Calabro': 'Corigliano-Rossano', Rossano: 'Corigliano-Rossano' },
      SA: { Capaccio: 'Capaccio Paestum' },
    },
    // Nome e regione di ogni provincia: gli avvisi dicono «Provincia di Salerno» e vanno nel canale della regione (avvisi.ts).
    province: { BA: 'Bari', BT: 'Barletta-Andria-Trani', CS: 'Cosenza', LE: 'Lecce', SA: 'Salerno' },
    regioni: { BA: 'Puglia', BT: 'Puglia', CS: 'Calabria', LE: 'Puglia', SA: 'Campania' },
  })
})

test('se l’ISTAT cambia le colonne lo script si ferma', () => {
  assert.throws(() => tabelleComuni('Codice;Nome\n1;Bari\n', VARIAZIONI), /Denominazione in italiano/)
})
