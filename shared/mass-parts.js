// The Mass parts the laptop can name, and the web editor's step for each. The ids and English names match src/liturgy/massOrder.ts;
// electron/plan-sync-map.test.mjs reads that file and fails if the two lists drift apart.
//
// The web's Mass template (web/js/sample-data.js) numbers its steps. Seven of them are Mass parts. A web item on one of these steps
// with no chosen song is that Mass part, so it can be shown on the laptop as the part.

export const MASS_PARTS = {
  kyrie: 'Kyrie (Lord, Have Mercy)',
  gloria: 'Gloria',
  credo: "Credo (Apostles' Creed)",
  sanctus: 'Sanctus (Holy, Holy, Holy)',
  'memorial-acclamation': 'Memorial Acclamation',
  'pater-noster': 'Pater Noster (Our Father)',
  'agnus-dei': 'Agnus Dei (Lamb of God)',
};

/** The web step number for each Mass part. A web item keyed by one of these numbers, with no song chosen, is that part. */
export const MASS_STEP_PARTS = {
  4: 'kyrie',
  5: 'gloria',
  13: 'credo',
  18: 'sanctus',
  20: 'memorial-acclamation',
  22: 'pater-noster',
  24: 'agnus-dei',
};

/** The web step number for a Mass part id, so the laptop's item keeps the web's key. */
export const PART_STEP = Object.fromEntries(Object.entries(MASS_STEP_PARTS).map(([step, part]) => [part, step]));
