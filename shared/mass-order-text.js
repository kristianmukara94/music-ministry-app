// A Holy Mass Order part's words and title as the parish edits them, and back. Pure, so the editor, the main process that stores them and the
// tests all read and write them the same way.
//
// The words are plain text, written the way they are read aloud:
//   - a blank line starts a new slide;
//   - a line that starts with "P:" is the priest's part (drawn in the priest's colour); "All:" or no mark at all is the people's part.
//
//   P: The mystery of faith.
//   We proclaim your Death, O Lord, and profess your Resurrection until you come again.
//
// Each part is kept in English, Tagalog and Cebuano. A built-in part (Kyrie, Gloria…) ships with the standard text in all three; the parish may
// replace the words or the title in any language. A parish's own item ("Act of Spiritual Communion") has an id starting `mass_order_custom_` and
// only the words and titles the parish typed.

export const MASS_ORDER_LANGS = ['en', 'tl', 'ceb'];
/** The most text one part may hold in one language, so a pasted document cannot fill the database. */
export const MAX_MASS_ORDER_TEXT = 20000;
export const MAX_MASS_ORDER_SLIDES = 60;
export const MAX_MASS_ORDER_TITLE = 120;
/** A part's id: lower-case words joined by hyphens or underscores, as the built-in parts and the parish's own items are named. */
export const MASS_ORDER_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
export const MAX_MASS_ORDER_ID = 64;
/** The start of the id of an item the parish made: `mass_order_custom_<uuid>`. */
export const CUSTOM_PREFIX = 'mass_order_custom_';

export const isCustomId = (id) => typeof id === 'string' && id.startsWith(CUSTOM_PREFIX);

/**
 * The standard Cebuano texts of the built-in parts, in the editor's format. NOT VERIFIED against an approved missal: PROOFREAD them against the
 * Cebuano Roman Missal approved for the parish's diocese before they are used at Mass. Any word can be corrected in the Holy Mass Order editor
 * without a new version of the app, and a corrected part can be shared with other laptops through the library export.
 *
 * Where they come from (checked November 2026; no official text was found online):
 *   - Kyrie and Agnus Dei agree word for word with the published Cebuano Mass guides (magsimba.com "Ang Santos nga Misa", and Mass guides
 *     shared by parishes).
 *   - Sanctus, Pater Noster and the Memorial Acclamation follow magsimba.com, the only full text found ("Santos, santos, santos, Ginoong Dios
 *     sa kagahuman"; "Si Kristo namatay, si Kristo nabanhaw, si Kristo mobalik nganhi").
 *   - Gloria and Credo follow the structure of the Missal's English text; the guides found give only a shortened sung Gloria and an older
 *     plural ("Nagatuo kami") Creed, so these two most need a proofreader.
 * The Credo is the Apostles' Creed, as the English and Tagalog parts are. The Nicene Creed is a template (MASS_ORDER_TEMPLATES).
 */
export const CEB_STANDARD = {
  kyrie: {
    name: 'Ginoo, Kaloy-i Kami',
    text: 'P: Ginoo, kaloy-i kami.\nGinoo, kaloy-i kami.\nP: Kristo, kaloy-i kami.\nKristo, kaloy-i kami.\nP: Ginoo, kaloy-i kami.\nGinoo, kaloy-i kami.',
  },
  gloria: {
    name: 'Himaya sa Dios',
    text: [
      'Himaya sa Dios sa kahitas-an, ug sa yuta pakigdait sa mga tawo nga iyang kahimut-an.',
      'Gidayeg ka namo, gidalayeg ka namo, gisimba ka namo, gihimaya ka namo, nagapasalamat kami kanimo tungod sa imong dakung himaya,',
      'Ginoong Dios, Hari sa langit, O Dios, Amahan nga makagagahum. Ginoong Hesukristo, bugtong nga Anak, Ginoong Dios, Kordero sa Dios, Anak sa Amahan,',
      'ikaw nga nagawagtang sa mga sala sa kalibutan, kaloy-i kami; ikaw nga nagawagtang sa mga sala sa kalibutan, dawata ang among pag-ampo;',
      'ikaw nga naglingkod sa tuo sa Amahan, kaloy-i kami.',
      'Kay ikaw lamang ang Balaan, ikaw lamang ang Ginoo, ikaw lamang ang Labing Halangdon, Hesukristo, uban sa Espiritu Santo, sa himaya sa Dios nga Amahan. Amen.',
    ].join('\n\n'),
  },
  credo: {
    name: 'Kredo (Nagatoo Ako)',
    text: [
      'Nagatoo ako sa Dios, Amahan nga makagagahum sa tanan, Magbubuhat sa langit ug sa yuta;',
      'ug kang Hesukristo, iyang bugtong nga Anak, among Ginoo, nga gipanamkon pinaagi sa Espiritu Santo, natawo kang Maria nga Ulay;',
      'nag-antus ilalom sa pagdumala ni Poncio Pilato, gilansang sa krus, namatay ug gilubong; mikunsad ngadto sa mga minatay; sa ikatulo ka adlaw nabanhaw gikan sa mga patay;',
      'mikayab ngadto sa langit, ug naglingkod sa tuo sa Dios, Amahan nga makagagahum sa tanan; gikan didto moanhi siya sa paghukom sa mga buhi ug sa mga patay.',
      'Nagatoo ako sa Espiritu Santo, sa balaang Simbahan Katolika, sa panag-ambitay sa mga santos, sa pagpasaylo sa mga sala, sa pagkabanhaw sa lawas, ug sa kinabuhing dayon. Amen.',
    ].join('\n\n'),
  },
  sanctus: {
    name: 'Santos, Santos, Santos',
    text: 'Santos, santos, santos, Ginoong Dios sa kagahuman.\nPuno ang langit ug yuta sa imong himaya.\nOsana sa kahitas-an.\nDaygon ang nagaanhi sa ngalan sa Ginoo.\nOsana sa kahitas-an.',
  },
  'memorial-acclamation': {
    name: 'Ang Misteryo sa Pagtuo',
    text: 'P: Kini ang misteryo sa pagtuo.\nSi Kristo namatay, si Kristo nabanhaw, si Kristo mobalik nganhi.',
  },
  'pater-noster': {
    name: 'Amahan Namo',
    text: [
      'Amahan namo, nga anaa sa mga langit, pagdaygon ang imong ngalan, umabut kanamo ang imong gingharian, matuman ang imong pagbuot dinhi sa yuta, maingon sa langit.',
      'Ang kalan-on namo sa matag adlaw ihatag kanamo karong adlawa, ug pasayloa kami sa among mga sala, ingon nga nagapasaylo kami sa mga nakasala kanamo, ug ayaw itugot nga mahulog kami sa panulay, hinonoa luwasa kami sa dautan.',
      'Kay imo man ang gingharian, ug ang gahum, ug ang himaya, hangtud sa kahangturan.',
    ].join('\n\n'),
  },
  'agnus-dei': {
    name: 'Kordero sa Dios',
    text: [
      'Kordero sa Dios, nga nagawagtang sa mga sala sa kalibutan, kaloy-i kami.',
      'Kordero sa Dios, nga nagawagtang sa mga sala sa kalibutan, kaloy-i kami.',
      'Kordero sa Dios, nga nagawagtang sa mga sala sa kalibutan, hatagi kami sa kalinaw.',
    ].join('\n'),
  },
};

/**
 * Ready-made starting points for a new parish item, picked in the editor. A template only fills the new item's words and titles; it is saved as
 * the parish's own item, which the parish then proofreads and owns.
 *
 * The Nicene Creed: the English is the 2011 Roman Missal text. The Cebuano follows the text published at cprc.co.uk ("Nagatoo ako sa usa ka
 * Dios"), split into slides; that page names no Catholic source, so it must be checked against the approved Cebuano Missal before use. (The
 * opening "Mitoo ako sa usa ka Dios" was not found in any published text.)
 */
export const MASS_ORDER_TEMPLATES = [
  {
    id: 'nicene-creed',
    label: 'Nicene Creed (Nagatoo Ako sa Usa ka Dios)',
    entries: {
      en: {
        title: 'Credo (Nicene Creed)',
        text: [
          'I believe in one God, the Father almighty, maker of heaven and earth, of all things visible and invisible.',
          'I believe in one Lord Jesus Christ, the Only Begotten Son of God, born of the Father before all ages.',
          'God from God, Light from Light, true God from true God, begotten, not made, consubstantial with the Father; through him all things were made.',
          'For us men and for our salvation he came down from heaven, and by the Holy Spirit was incarnate of the Virgin Mary, and became man.',
          'For our sake he was crucified under Pontius Pilate, he suffered death and was buried, and rose again on the third day in accordance with the Scriptures.',
          'He ascended into heaven and is seated at the right hand of the Father. He will come again in glory to judge the living and the dead and his kingdom will have no end.',
          'I believe in the Holy Spirit, the Lord, the giver of life, who proceeds from the Father and the Son, who with the Father and the Son is adored and glorified, who has spoken through the prophets.',
          'I believe in one, holy, catholic and apostolic Church. I confess one Baptism for the forgiveness of sins and I look forward to the resurrection of the dead and the life of the world to come. Amen.',
        ].join('\n\n'),
      },
      ceb: {
        title: 'Kredo (Nagatoo Ako sa Usa ka Dios)',
        text: [
          'Nagatoo ako sa usa ka Dios, ang Amahan ang makagagahum sa tanan, magbubuhat sa langit ug sa yuta, ug sa tanang mga makita ug dili makita.',
          'Nagatoo ako sa usa ka Ginoo, si Jesu Kristo ang bugtong anak sa Dios, gianak sa amahan sa wala pa’y katuigan.',
          'DIOS gikan sa DIOS, kahayag gikan sa kahayag, matuod nga DIOS gikan sa Dios nga matuod, gianak, dili binuhat, usa’g kinaiya sa Amahan. Pinaagi kaniya nangahimu ang tanan.',
          'Tungod kanatong mga tawo ug alang sa atong kaluwasan, mikanaog siya gikan sa langit, sa lalang sa Spiritu Santo, nahimo siya nga lawas gikan ni Maria nga ulay ug nahimong tawo.',
          'Tungod kanato gilansang siya sa krus sa sugo ni Poncio Pilato, nag-antos siya namatay ug gilubong. Sa ikatulong adlaw nabanhaw siya aron matuman ang kasulatan.',
          'Misaka siya sa langit ug nagalingkod sa too sa Amahan. Mubalik siya nga mahimayaon aron paghukom sa mga buhi ug sa mga minatay, ug ang iyang gingharian walay katapusan.',
          'Nagatoo ako sa Espiritu Santo, ang Ginoo ug maghahatag sa kinabuhi. Nagagikan siya sa Amahan ug sa Anak. Dunga sa Amahan ug sa Anak, gisimba siya ug gihimaya, ug misulti pinaagi sa mga propeta.',
          'Nagatoo ako sa usa ka Santos, Katoliko ug Apostoliko nga simbahan. Nagaila ako sa usa ka bunyag alang sa kapasaylo-an sa mga sala. Nagapaabot ako sa pagkabanhaw sa mga minatay, ug sa kinabuhi sa umaabot nga kalibutan. Amen.',
        ].join('\n\n'),
      },
    },
  },
];

const PRIEST = /^\s*(?:p|v|priest)\s*:\s*/i;
const PEOPLE = /^\s*(?:all|a|r|people)\s*:\s*/i;

/** The editor's text for a part's slides: one block per slide, one line per line, the priest's lines marked "P:". */
export function slidesToText(slides) {
  return (slides ?? [])
    .map((lines) => lines.map((line) => (line.role === 'priest' ? `P: ${line.text}` : line.text)).join('\n'))
    .join('\n\n');
}

/** The slides for the editor's text. Blank lines between blocks start a new slide; empty blocks are dropped. */
export function textToSlides(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((raw) => raw.trim())
        .filter(Boolean)
        .map((raw) => (PRIEST.test(raw) ? { role: 'priest', text: raw.replace(PRIEST, '').trim() } : { role: 'all', text: raw.replace(PEOPLE, '').trim() }))
        .filter((line) => line.text),
    )
    .filter((lines) => lines.length > 0);
}

/**
 * Checks words for a part before they are saved. Resolves to { ok: true, slides } or { ok: false, error } with what to fix, so the editor and
 * the main process refuse the same things.
 */
export function checkMassOrderText(text) {
  const raw = String(text ?? '');
  if (raw.length > MAX_MASS_ORDER_TEXT) return { ok: false, error: `The text is too long (${raw.length} characters; at most ${MAX_MASS_ORDER_TEXT}).` };
  const slides = textToSlides(raw);
  if (slides.length === 0) return { ok: false, error: 'Type the words of at least one slide, or use Reset to Standard Missal Text.' };
  if (slides.length > MAX_MASS_ORDER_SLIDES) return { ok: false, error: `That makes ${slides.length} slides; at most ${MAX_MASS_ORDER_SLIDES}.` };
  return { ok: true, slides };
}

/** A title as it is kept: trimmed, on one line. Null when empty. Throws when too long. */
export function cleanTitle(title) {
  if (title == null) return null;
  const clean = String(title).replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length > MAX_MASS_ORDER_TITLE) throw new Error(`The title is too long (${clean.length} characters; at most ${MAX_MASS_ORDER_TITLE}).`);
  return clean;
}

/** The language a part's words are kept in. Each of English, Tagalog and Cebuano has its own; anything else reads English. */
export function massOrderLang(lang) {
  return MASS_ORDER_LANGS.includes(lang) ? lang : 'en';
}

/** The order a missing language is looked for in a parish item: the language asked for, then English, Tagalog, Cebuano. */
const fallbackOrder = (l) => [l, ...MASS_ORDER_LANGS.filter((x) => x !== l)];

/**
 * The slides a part shows: the parish's own words when it has saved some for that language, otherwise the standard text. A parish item has no
 * standard text, so it shows its words in the nearest language that has some. `overrides` maps a part id to { en?, tl?, ceb? }, each
 * { text, title } as the store holds them.
 */
export function effectiveSlides(part, lang, overrides) {
  const l = massOrderLang(lang);
  const own = (x) => {
    const text = overrides?.[part.id]?.[x]?.text;
    if (typeof text !== 'string') return null;
    const slides = textToSlides(text);
    return slides.length > 0 ? slides : null;
  };
  const mine = own(l);
  if (mine) return mine;
  if (part.slides?.[l]?.length) return part.slides[l];
  for (const x of fallbackOrder(l)) {
    const found = own(x) ?? (part.slides?.[x]?.length ? part.slides[x] : null);
    if (found) return found;
  }
  return [];
}

/** A part's title: the parish's title for that language, the standard name, or (for a parish item) its title in the nearest language. */
export function effectiveTitle(part, lang, overrides) {
  const l = massOrderLang(lang);
  for (const x of fallbackOrder(l)) {
    const own = overrides?.[part.id]?.[x]?.title;
    if (typeof own === 'string' && own) return own;
    if (part.name?.[x]) return part.name[x];
  }
  return part.id;
}

/** Whether the parish has changed this part's words or title in this language. */
export function isCustomized(partId, lang, overrides) {
  const entry = overrides?.[partId]?.[massOrderLang(lang)];
  return Boolean(entry && (typeof entry.text === 'string' || typeof entry.title === 'string'));
}

/** The rows the main process lists, as the store keeps them: { [partId]: { [lang]: { text, title } } }. */
export function overridesFromRows(rows) {
  const out = {};
  for (const row of rows ?? []) {
    if (!row || !MASS_ORDER_ID.test(row.partId) || !MASS_ORDER_LANGS.includes(row.lang)) continue;
    const text = typeof row.text === 'string' ? row.text : null;
    const title = typeof row.title === 'string' && row.title ? row.title : null;
    if (text === null && title === null) continue;
    out[row.partId] = { ...out[row.partId], [row.lang]: { text, title } };
  }
  return out;
}

/**
 * The parish's own items as parts the rest of the app can list and stage: { id, name, slides, custom: true }, in the order they were made.
 * Their names and slides are left empty here; effectiveTitle and effectiveSlides read them from the overrides.
 */
export function customParts(items) {
  return (items ?? [])
    .filter((item) => item && isCustomId(item.id) && MASS_ORDER_ID.test(item.id))
    .map((item) => ({ id: item.id, name: {}, slides: {}, custom: true }));
}

/**
 * What the editor saves for one language of a built-in part: the words and the title, each null when it is the standard one (so an unchanged
 * field is not stored, and a later fix to the standard text still reaches it).
 */
export function entryForSave({ text, title }, { standardText, standardTitle }) {
  const words = String(text ?? '').trim();
  const name = String(title ?? '').trim();
  return {
    text: !words || words === String(standardText ?? '').trim() ? null : words,
    title: !name || name === String(standardTitle ?? '').trim() ? null : name,
  };
}

/**
 * Plan rows with each Holy Mass Order part shown under its title now, so a renamed part is renamed on every planner card and queue entry at once
 * (a plan keeps the title it had when the part was added). `nameOf(id)` answers the part's title, or null when there is no such part: a parish
 * item that was deleted, which is then marked missing. Other rows, and rows already under their title, are returned as they were.
 */
export function withPartNames(items, nameOf) {
  return items.map((item) => {
    if (item.module !== 'mass_order') return item;
    const name = nameOf(item.sourceId);
    if (name == null) return isCustomId(item.sourceId) && !item.stale ? { ...item, stale: true } : item;
    return name === item.label ? item : { ...item, label: name };
  });
}
