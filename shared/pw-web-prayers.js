// The laptop's side of the Web Planner's Prayers catalog (web/js/prayer-scripture.js PRAYER_CATALOG), which sends a prayer as its title only.
// Titles only, never words: electron/plan-sync.test.mjs keeps the titles equal to the website's. `rosary` names the same prayer in the
// laptop's Rosary prayers (electron/rosary.js), whose wording is used only once the parish has marked it approved. Plain JS, no imports.

export const WEB_PRAYERS = Object.freeze([
  { title: 'I Confess (Confiteor)' },
  { title: 'Kyrie (Lord, Have Mercy)' },
  { title: 'Gloria' },
  { title: 'Opening Prayer (Collect)' },
  { title: "Credo (Apostles' Creed)", rosary: 'creed' },
  { title: 'Nicene Creed' },
  { title: 'Prayer of the Faithful' },
  { title: 'May the Lord Accept the Sacrifice' },
  { title: 'Sanctus (Holy, Holy, Holy)' },
  { title: 'Memorial Acclamation' },
  { title: 'Doxology' },
  { title: 'Pater Noster (Our Father)', rosary: 'our_father' },
  { title: 'Agnus Dei (Lamb of God)' },
  { title: 'Lord, I Am Not Worthy' },
  { title: 'Prayer after Communion' },
  { title: 'Hail Mary', rosary: 'hail_mary' },
  { title: 'Glory Be', rosary: 'glory_be' },
  { title: 'Act of Contrition' },
  { title: 'The Angelus', also: ['Angelus'] },
  { title: 'Prayer to the Holy Spirit' },
  { title: 'Prayer to Take Authority' },
  { title: 'Consecration to Mary, Our Lady of Nazareth' },
  { title: 'Prayer to St. Michael the Archangel', rosary: 'st_michael' },
  { title: 'The Holy Rosary' },
  { title: 'Divine Mercy Chaplet' },
  { title: 'Intercessions' },
  { title: 'Closing Prayer and Blessing' },
]);

/** A prayer's title as it is compared: case, spacing and the kind of apostrophe do not make it another prayer. */
export const prayerTitleKey = (title) => String(title ?? '').normalize('NFKC').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

/** The catalog entry a title names, or null. */
export const webPrayerOf = (title) => WEB_PRAYERS.find((p) => prayerTitleKey(p.title) === prayerTitleKey(title)) ?? null;

/**
 * The titles a parish's own note for this prayer may go by, compared form, the exact title first. A catalog title written as "Name (Other
 * name)" is also looked for under each name on its own ("Pater Noster (Our Father)": "Pater Noster", "Our Father").
 */
export function prayerTitleKeys(title) {
  const entry = webPrayerOf(title);
  const both = entry ? /^(.+?) \((.+)\)$/.exec(entry.title) : null;
  return [...new Set([title, ...(both ? [both[1], both[2]] : []), ...(entry?.also ?? [])].map(prayerTitleKey))].filter(Boolean);
}
