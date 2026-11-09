// A plan's own Content Hub on the web: prayers, readings, announcements and notes typed here and reused across the plan's slots. Pure, so the
// planners and their tests use the same rules. The entries are saved in the plan's body on the website, and come down to the church laptop's Content Hub with the plan.

export const HUB_TYPES = [
  { value: 'prayer', label: 'Prayer' },
  { value: 'scripture', label: 'Scripture / Reading' },
  { value: 'announcement', label: 'Announcement' },
  { value: 'note', label: 'General Note' },
];

/**
 * The categories offered for each type. The prayer, announcement and booth lists follow the laptop's Content Hub (shared/notes.js). Holy Mass intentions are left
 * out on purpose: the laptop can seal those with the parish passphrase, and text typed here is stored on the website in the clear.
 */
export const HUB_CATEGORIES = {
  prayer: ['Holy Mass Response', 'Creed', 'Gloria', 'Kyrie', 'Sanctus', 'Agnus Dei', 'Eucharistic Preface', 'Special Intercession', 'Oratio Imperata', 'Novena', 'Consecration', 'Community Prayer'],
  scripture: ['First Reading', 'Responsorial Psalm', 'Second Reading', 'Gospel', 'Other Reading'],
  announcement: ['Pastoral Notice', 'Bulletin Update', 'Event Reminder', 'Emergency Notice'],
  note: ['Liturgical Cue', 'Presider Note', 'Choir / Booth Prompt'],
};

export const MAX_HUB_ITEMS = 50;
export const MAX_HUB_TITLE = 120;
export const MAX_HUB_TEXT = 4000;
export const MAX_HUB_SPEAKER = 500;

export const hubTypeLabel = (value) => HUB_TYPES.find((type) => type.value === value)?.label ?? 'Note';

const NICENE_EN = [
  'I believe in one God, the Father almighty, maker of heaven and earth, of all things visible and invisible.',
  'I believe in one Lord Jesus Christ, the Only Begotten Son of God, born of the Father before all ages.',
  'God from God, Light from Light, true God from true God, begotten, not made, consubstantial with the Father; through him all things were made.',
  'For us men and for our salvation he came down from heaven, and by the Holy Spirit was incarnate of the Virgin Mary, and became man.',
  'For our sake he was crucified under Pontius Pilate, he suffered death and was buried, and rose again on the third day in accordance with the Scriptures.',
  'He ascended into heaven and is seated at the right hand of the Father. He will come again in glory to judge the living and the dead and his kingdom will have no end.',
  'I believe in the Holy Spirit, the Lord, the giver of life, who proceeds from the Father and the Son, who with the Father and the Son is adored and glorified, who has spoken through the prophets.',
  'I believe in one, holy, catholic and apostolic Church. I confess one Baptism for the forgiveness of sins and I look forward to the resurrection of the dead and the life of the world to come. Amen.',
].join('\n\n');

const NICENE_CEB = [
  'Nagatoo ako sa usa ka Dios, ang Amahan ang makagagahum sa tanan, magbubuhat sa langit ug sa yuta, ug sa tanang mga makita ug dili makita.',
  'Nagatoo ako sa usa ka Ginoo, si Jesu Kristo ang bugtong anak sa Dios, gianak sa amahan sa wala pa’y katuigan.',
  'DIOS gikan sa DIOS, kahayag gikan sa kahayag, matuod nga DIOS gikan sa Dios nga matuod, gianak, dili binuhat, usa’g kinaiya sa Amahan. Pinaagi kaniya nangahimu ang tanan.',
  'Tungod kanatong mga tawo ug alang sa atong kaluwasan, mikanaog siya gikan sa langit, sa lalang sa Spiritu Santo, nahimo siya nga lawas gikan ni Maria nga ulay ug nahimong tawo.',
  'Tungod kanato gilansang siya sa krus sa sugo ni Poncio Pilato, nag-antos siya namatay ug gilubong. Sa ikatulong adlaw nabanhaw siya aron matuman ang kasulatan.',
  'Misaka siya sa langit ug nagalingkod sa too sa Amahan. Mubalik siya nga mahimayaon aron paghukom sa mga buhi ug sa mga minatay, ug ang iyang gingharian walay katapusan.',
  'Nagatoo ako sa Espiritu Santo, ang Ginoo ug maghahatag sa kinabuhi. Nagagikan siya sa Amahan ug sa Anak. Dunga sa Amahan ug sa Anak, gisimba siya ug gihimaya, ug misulti pinaagi sa mga propeta.',
  'Nagatoo ako sa usa ka Santos, Katoliko ug Apostoliko nga simbahan. Nagaila ako sa usa ka bunyag alang sa kapasaylo-an sa mga sala. Nagapaabot ako sa pagkabanhaw sa mga minatay, ug sa kinabuhi sa umaabot nga kalibutan. Amen.',
].join('\n\n');

/**
 * Standard texts to start an entry from. Each is copied into the form, where the planner reviews it before it is saved. PROOFREAD every text against
 * the approved Roman Missal before it is used at Holy Mass. The Nicene Creed repeats shared/mass-order-text.js, and a test keeps the two equal; its
 * Cebuano is unverified there too. A language with no text here falls back to English and says so: a translation is never made up in this file.
 */
export const HUB_TEMPLATES = [
  {
    id: 'confiteor',
    type: 'prayer',
    category: 'Holy Mass Response',
    title: 'I Confess (Confiteor)',
    speakerNote: 'All, led by the priest',
    text: {
      EN: 'I confess to almighty God and to you, my brothers and sisters, that I have greatly sinned, in my thoughts and in my words, in what I have done and in what I have failed to do, through my fault, through my fault, through my most grievous fault;\n\ntherefore I ask blessed Mary ever-Virgin, all the Angels and Saints, and you, my brothers and sisters, to pray for me to the Lord our God.',
    },
  },
  {
    id: 'nicene-creed',
    type: 'prayer',
    category: 'Creed',
    title: 'Nicene Creed',
    speakerNote: 'All stand',
    text: { EN: NICENE_EN, CEB: NICENE_CEB },
  },
  {
    id: 'universal-prayer',
    type: 'prayer',
    category: 'Special Intercession',
    title: 'Universal Prayer / Prayers of the Faithful',
    speakerNote: 'Priest introduces and concludes; a reader leads the intentions',
    text: {
      EN: 'P: [Priest’s invitation to prayer]\n\nFor the Church: [intention]\nLet us pray to the Lord.\nAll: [the response of the day]\n\nFor those who govern and for the world: [intention]\nLet us pray to the Lord.\nAll: [the response of the day]\n\nFor those in need: [intention]\nLet us pray to the Lord.\nAll: [the response of the day]\n\nFor our parish and community: [intention]\nLet us pray to the Lord.\nAll: [the response of the day]\n\nP: [Priest’s concluding prayer]\nAll: Amen.',
    },
  },
];

/** A template's words in the plan's language, and whether they had to fall back to English. */
export function templateText(template, language) {
  const text = template.text[language];
  return text ? { text, fellBack: false } : { text: template.text.EN, fellBack: language !== 'EN' };
}

/** The entries the list shows, narrowed by type and by the search text. */
export function visibleHubItems(items, { type = '', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return items.filter((item) => (!type || item.type === type) && (!q || `${item.title} ${item.category} ${item.text}`.toLowerCase().includes(q)));
}

/** Checks the form. Returns { entry } ready to keep, or { error } with the first plain problem. */
export function checkHubDraft(draft) {
  const title = String(draft.title ?? '').trim();
  const text = String(draft.text ?? '').trim();
  const speakerNote = String(draft.speakerNote ?? '').trim();
  if (!HUB_TYPES.some((type) => type.value === draft.type)) return { error: 'Choose a type for this entry.' };
  if (title === '') return { error: 'Enter a title for this entry.' };
  if (title.length > MAX_HUB_TITLE) return { error: `A title can be up to ${MAX_HUB_TITLE} characters.` };
  if (text.length > MAX_HUB_TEXT) return { error: `The text can be up to ${MAX_HUB_TEXT} characters.` };
  if (speakerNote.length > MAX_HUB_SPEAKER) return { error: `A speaker note can be up to ${MAX_HUB_SPEAKER} characters.` };
  return { entry: { id: draft.id, type: draft.type, title, category: String(draft.category ?? '').trim(), text, speakerNote } };
}

/** The entries with one added, or replaced when its id is already there. */
export function withHubItem(items, entry) {
  return items.some((item) => item.id === entry.id) ? items.map((item) => (item.id === entry.id ? entry : item)) : [...items, entry];
}

/** Every Content Hub id a plan's steps use. `segments` is the planner's state. */
export function usedHubIds(segments) {
  const ids = new Set();
  for (const segment of Object.values(segments)) {
    if (segment?.contentHubId) ids.add(segment.contentHubId);
    for (const entry of segment?.more ?? []) if (entry.contentHubId) ids.add(entry.contentHubId);
  }
  return ids;
}
