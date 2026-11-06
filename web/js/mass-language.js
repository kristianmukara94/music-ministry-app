// The language a Holy Mass plan is celebrated in, and the names of the parts and slots of the Mass in it. The church laptop has the same
// names in shared/mass-language.js; the website cannot load the laptop's files, so they are repeated here by slot number, and a test keeps
// the two equal. These are names only, never the texts of the Mass. A slot with no name in a language is shown under its English name.

export const MASS_LANGUAGES = [
  { code: 'EN', name: 'English', short: 'EN' },
  { code: 'TL', name: 'Tagalog', short: 'TL' },
  { code: 'CEB', name: 'Cebuano', short: 'CEB' },
];
export const DEFAULT_MASS_LANGUAGE = 'EN';

/** A plan's language: its saved code, or English for a plan saved before languages. */
export const massLanguageOf = (value) => (MASS_LANGUAGES.some((l) => l.code === value) ? value : DEFAULT_MASS_LANGUAGE);

/** The language's name, for example "Tagalog". */
export const languageName = (code) => MASS_LANGUAGES.find((l) => l.code === massLanguageOf(code)).name;

const SECTION_TITLES = {
  TL: { introductory: 'Mga Pambungad na Rito', word: 'Liturhiya ng Salita ng Diyos', eucharist: 'Liturhiya ng Eukaristiya', concluding: 'Mga Pangwakas na Rito' },
  CEB: { introductory: 'Mga Pasiunang Rito', word: 'Liturhiya sa Pulong', eucharist: 'Liturhiya sa Eukaristiya', concluding: 'Mga Panapos nga Rito' },
};

/** By slot number (mass-slots.js). */
const SLOT_NAMES = {
  TL: {
    1: 'Pambungad na Awit',
    2: 'Pagsisisi / Kumpisal',
    3: 'Panginoon, Maawa Ka',
    18: 'Papuri sa Diyos',
    19: 'Panalangin Pambungad',
    20: 'Unang Pagbasa',
    4: 'Salmong Tugunan',
    21: 'Ikalawang Pagbasa',
    5: 'Awit sa Mabuting Balita (Aleluya)',
    22: 'Ang Mabuting Balita',
    23: 'Pangaral (Homilya)',
    24: 'Pahayag ng Pananampalataya',
    6: 'Panalangin ng Bayan',
    7: 'Paghahanda ng mga Alay',
    9: 'Santo, Santo, Santo',
    10: 'Misteryo ng Pananampalataya',
    11: 'Dakilang Amen',
    12: 'Ama Namin',
    25: 'Pagbibigay ng Kapayapaan',
    14: 'Kordero ng Diyos',
    16: 'Awit sa Komunyon',
    26: 'Panalangin Pagkakomunyon',
    27: 'Mga Anunsyo',
    28: 'Huling Pagbabasbas at Paghahayo',
    17: 'Pangwakas na Awit',
  },
  CEB: {
    1: 'Awit sa Pagsulod',
    2: 'Pagsisi / Kumpisal',
    3: 'Ginoo, Kaloy-i Kami',
    18: 'Himaya sa Dios',
    19: 'Pag-ampo sa Pagtigum',
    20: 'Unang Pagbasa',
    4: 'Salmo sa Pagtubag',
    21: 'Ikaduhang Pagbasa',
    5: 'Awit sa Ebanghelyo (Aleluya)',
    22: 'Ang Ebanghelyo',
    23: 'Wali (Homilya)',
    24: 'Pahayag sa Pagtuo',
    6: 'Pag-ampo sa Katilingban',
    7: 'Awit sa Paghalad',
    9: 'Santo, Santo, Santo',
    10: 'Misteryo sa Pagtuo',
    11: 'Dakilang Amen',
    12: 'Amahan Namo',
    25: 'Paghatag sa Kalinaw',
    14: 'Kordero sa Dios',
    16: 'Awit sa Komunyon',
    26: 'Pag-ampo Human sa Komunyon',
    27: 'Mga Pahibalo',
    28: 'Pagbendisyon ug Pagpadala',
    17: 'Awit sa Pagpawa',
  },
};

/** A slot's name in the plan's language, or its English name. `slot` is a slot from mass-slots.js, or an editor row ({ slot, name }). */
export function slotName(slot, language) {
  const number = slot?.slot ?? slot?.number;
  return SLOT_NAMES[massLanguageOf(language)]?.[number] || slot?.name || '';
}

/** The title of a part of the Mass in the plan's language. `section` is from MASS_SECTIONS. */
export const sectionName = (section, language) => SECTION_TITLES[massLanguageOf(language)]?.[section?.group] || section?.title || '';
