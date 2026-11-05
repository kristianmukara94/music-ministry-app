// The language a Holy Mass plan is celebrated in. It picks the offline Bible translation its readings are drafted from (World English Bible,
// Tagalog or Cebuano) and the words and titles of its Mass Order parts (Kyrie, Gloria, Sanctus, Agnus Dei) and readings' endings ("The word
// of the Lord."). Pure, so the database and the planner share it.

import { MASS_SECTIONS, slotsOfSection } from './mass-slots.js';

export const MASS_LANGUAGES = ['EN', 'TL', 'CEB'];
export const DEFAULT_MASS_LANGUAGE = 'EN';

/** The offline Bible translation each Mass language reads from (see electron/bible-seed.js). */
export const LANGUAGE_BIBLE_MAP = Object.freeze({ EN: 'WEB', TL: 'TGL', CEB: 'CEB' });

const UI_LANG = Object.freeze({ EN: 'en', TL: 'tl', CEB: 'ceb' });

export const isMassLanguage = (value) => MASS_LANGUAGES.includes(value);

/** A Mass language from anything: a plan's saved value, or the app's own language ("tl"). Anything else is English. */
export function massLanguageOf(value) {
  const upper = String(value ?? '').toUpperCase();
  return isMassLanguage(upper) ? upper : DEFAULT_MASS_LANGUAGE;
}

/** The app language code ("en", "tl", "ceb") the Mass Order and the Lectionary strings use for a Mass language. */
export const uiLangOf = (language) => UI_LANG[massLanguageOf(language)];

/** The Bible translation id for a Mass language. */
export const bibleOf = (language) => LANGUAGE_BIBLE_MAP[massLanguageOf(language)];

/** The Mass languages a saved reading text may have been drafted in, other than `language`'s own. */
export const otherBibles = (language) => MASS_LANGUAGES.filter((l) => l !== massLanguageOf(language)).map((l) => LANGUAGE_BIBLE_MAP[l]);

// ---- The Philippine order of Mass in each language ----
// The names the planner shows for the parts of the Mass and their slots, and each slot's default title (the words a one-click fill puts in the
// slot), in English, Tagalog and Cebuano. The structure (which slots, in what order, in which part) is shared/mass-slots.js, and the English
// names come from there. A slot with no name in a language here is shown under its English name.
//
// These are names and titles, not the texts of the Mass (those are src/liturgy/massOrder.ts). The Tagalog and Cebuano wording follows the
// CBCP translations as the parish supplied them; have it proofread against the parish's own missal.

const SECTION_TITLES = Object.freeze({
  EN: { introductory_rites: 'Introductory Rites', liturgy_of_the_word: 'Liturgy of the Word', liturgy_of_the_eucharist: 'Liturgy of the Eucharist', concluding_rites: 'Concluding Rites' },
  TL: { introductory_rites: 'Mga Pambungad na Rito', liturgy_of_the_word: 'Liturhiya ng Salita ng Diyos', liturgy_of_the_eucharist: 'Liturhiya ng Eukaristiya', concluding_rites: 'Mga Pangwakas na Rito' },
  CEB: { introductory_rites: 'Mga Pasiunang Rito', liturgy_of_the_word: 'Liturhiya sa Pulong', liturgy_of_the_eucharist: 'Liturhiya sa Eukaristiya', concluding_rites: 'Mga Panapos nga Rito' },
});

/** By slot type: [label, default title]. An empty label is the English name; an empty title is none. */
const SLOT_TEXT = Object.freeze({
  EN: {
    CONFITEOR: ['', 'I Confess to Almighty God'],
    KYRIE: ['', 'Kyrie (Lord, Have Mercy)'],
    GLORIA: ['', 'Glory to God in the Highest'],
    COLLECT: ['', 'Opening Prayer'],
    CREED: ['', 'I Believe in One God (Nicene / Apostles Creed)'],
    SANCTUS: ['', 'Holy, Holy, Holy'],
    MEMORIAL_ACCLAMATION: ['', 'We Proclaim Your Death, O Lord'],
    GREAT_AMEN: ['', 'Amen'],
    LORD_PRAYER: ['', 'Our Father'],
    SIGN_OF_PEACE: ['', 'Peace Be With You'],
    AGNUS_DEI: ['', 'Lamb of God'],
    PRAYER_AFTER_COMMUNION: ['', 'Prayer after Communion'],
    FINAL_BLESSING: ['', 'Go in Peace'],
  },
  TL: {
    ENTRANCE_HYMN: ['Pambungad na Awit', ''],
    CONFITEOR: ['Pagsisisi / Kumpisal', 'Inaamin ko sa Makapangyarihang Diyos'],
    KYRIE: ['Panginoon, Maawa Ka', 'Panginoon, Maawa Ka (Kyrie)'],
    GLORIA: ['Papuri sa Diyos', 'Papuri sa Diyos sa Kaitaasan'],
    COLLECT: ['Panalangin Pambungad', 'Panalangin Pambungad'],
    FIRST_READING: ['Unang Pagbasa', ''],
    RESPONSORIAL_PSALM: ['Salmong Tugunan', ''],
    SECOND_READING: ['Ikalawang Pagbasa', ''],
    GOSPEL_ACCLAMATION: ['Awit sa Mabuting Balita (Aleluya)', ''],
    GOSPEL: ['Ang Mabuting Balita', ''],
    HOMILY: ['Pangaral (Homilya)', ''],
    CREED: ['Pahayag ng Pananampalataya', 'Sumasampalataya Ako'],
    PRAYER_OF_THE_FAITHFUL: ['Panalangin ng Bayan', ''],
    OFFERTORY: ['Paghahanda ng mga Alay', ''],
    SANCTUS: ['Santo, Santo, Santo', 'Santo, Santo, Santo'],
    MEMORIAL_ACCLAMATION: ['Misteryo ng Pananampalataya', 'Si Kristo ay Namatay'],
    GREAT_AMEN: ['Dakilang Amen', 'Amen'],
    LORD_PRAYER: ['Ama Namin', 'Ama Namin'],
    SIGN_OF_PEACE: ['Pagbibigay ng Kapayapaan', 'Kapayapaan sa Iyo'],
    AGNUS_DEI: ['Kordero ng Diyos', 'Kordero ng Diyos'],
    COMMUNION_HYMN: ['Awit sa Komunyon', ''],
    PRAYER_AFTER_COMMUNION: ['Panalangin Pagkakomunyon', 'Panalangin Pagkakomunyon'],
    ANNOUNCEMENTS: ['Mga Anunsyo', ''],
    FINAL_BLESSING: ['Huling Pagbabasbas at Paghahayo', 'Humayo Kayo sa Kapayapaan'],
    RECESSIONAL_HYMN: ['Pangwakas na Awit', ''],
  },
  CEB: {
    ENTRANCE_HYMN: ['Awit sa Pagsulod', ''],
    CONFITEOR: ['Pagsisi / Kumpisal', 'Nagasugid Ako sa Dios nga Makagagahum'],
    KYRIE: ['Ginoo, Kaloy-i Kami', 'Ginoo, Kaloy-i Kami'],
    GLORIA: ['Himaya sa Dios', 'Himaya sa Dios sa Kahitas-an'],
    COLLECT: ['Pag-ampo sa Pagtigum', 'Pag-ampo sa Pagtigum'],
    FIRST_READING: ['Unang Pagbasa', ''],
    RESPONSORIAL_PSALM: ['Salmo sa Pagtubag', ''],
    SECOND_READING: ['Ikaduhang Pagbasa', ''],
    GOSPEL_ACCLAMATION: ['Awit sa Ebanghelyo (Aleluya)', ''],
    GOSPEL: ['Ang Ebanghelyo', ''],
    HOMILY: ['Wali (Homilya)', ''],
    CREED: ['Pahayag sa Pagtuo', 'Nagatuo Ako sa Usa ka Dios'],
    PRAYER_OF_THE_FAITHFUL: ['Pag-ampo sa Katilingban', ''],
    OFFERTORY: ['Awit sa Paghalad', ''],
    SANCTUS: ['Santo, Santo, Santo', 'Santo, Santo, Santo'],
    MEMORIAL_ACCLAMATION: ['Misteryo sa Pagtuo', 'Si Kristo Namatay'],
    GREAT_AMEN: ['Dakilang Amen', 'Amen'],
    LORD_PRAYER: ['Amahan Namo', 'Amahan Namo'],
    SIGN_OF_PEACE: ['Paghatag sa Kalinaw', 'Kalinaw sa Inyo'],
    AGNUS_DEI: ['Kordero sa Dios', 'Kordero sa Dios'],
    COMMUNION_HYMN: ['Awit sa Komunyon', ''],
    PRAYER_AFTER_COMMUNION: ['Pag-ampo Human sa Komunyon', 'Pag-ampo Human sa Komunyon'],
    ANNOUNCEMENTS: ['Mga Pahibalo', ''],
    FINAL_BLESSING: ['Pagbendisyon ug Pagpadala', 'Lihok sa Kalinaw'],
    RECESSIONAL_HYMN: ['Awit sa Pagpawa', ''],
  },
});

/** A slot's name in a Mass language (or an app language: "tl"), falling back to its English name. */
export const slotLabel = (slot, language) => SLOT_TEXT[massLanguageOf(language)][slot?.type]?.[0] || slot?.name || '';

/** A slot's default title in a Mass language, or null when it has none. */
export const slotDefaultTitle = (slot, language) => SLOT_TEXT[massLanguageOf(language)][slot?.type]?.[1] || null;

/** The title of a part of the Mass in a Mass language. */
export const sectionTitle = (section, language) => SECTION_TITLES[massLanguageOf(language)][section?.id] ?? section?.name ?? '';

/**
 * The Philippine order of Mass in each language, as one dictionary: for each language its four parts (titled "1. INTRODUCTORY RITES"), each
 * with its slots in Mass order. A slot is { id, type, label, defaultTitle?, isHymn?, isReading?, sundayOnly?, optional? }: `id` is the slot a
 * plan item names, and `type` is the slot's key in the flow.
 */
export const PHILIPPINE_MASS_FLOW = Object.freeze(
  Object.fromEntries(
    MASS_LANGUAGES.map((language) => [
      language,
      {
        sections: MASS_SECTIONS.map((section) => ({
          id: section.id,
          title: `${section.number}. ${sectionTitle(section, language).toUpperCase()}`,
          slots: slotsOfSection(section.id).map((slot) => {
            const defaultTitle = slotDefaultTitle(slot, language);
            return {
              id: slot.id,
              type: slot.type,
              label: slotLabel(slot, language),
              ...(defaultTitle ? { defaultTitle } : {}),
              ...(slot.kind === 'song' ? { isHymn: true } : {}),
              ...(slot.isReading ? { isReading: true } : {}),
              ...(slot.sundayOnly ? { sundayOnly: true } : {}),
              ...(slot.optional ? { optional: true } : {}),
            };
          }),
        })),
      },
    ]),
  ),
);
