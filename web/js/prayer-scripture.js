// Prayers and Scripture references in the web planners: the Prayers catalog, the Scripture reference builder, how an entry is told apart (the PRAYER and
// SCRIPTURE badges), and the markup of the two library tabs, which the Holy Mass library and both editors' inline quick-assign panels share.
//
// Titles and references only. No prayer's words and no Bible text are written here or sent to the server: a prayer is its title, a passage is its
// reference ("Sample Book 1:1-6 (WEB)"). The church laptop turns a reference into the passage from its own offline Bible, and a prayer title that is one
// of its Holy Mass Order parts into that part. The server accepts both as a plain item: kind 'reading' (or a spoken 'rite' for a prayer), `text` and
// `contentType` 'prayer' or 'scripture' (server/lib/plan-sync.js). Pure, so the tests run it without a browser. Every value written into markup goes through esc().

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lower = (value) => String(value ?? '').trim().toLowerCase();

// ---- Prayers ----

/**
 * The Prayers catalog. `slotId` is the Holy Mass slot's id (web/js/mass-slots.js), never its number, so the catalog follows the slots if they are renumbered.
 * `part` is the laptop's Holy Mass Order part (shared/mass-parts.js) when it has one: such a prayer's `title` is exactly the laptop's name for the part, which is
 * how the laptop recognises it and shows its own text. A test keeps the two equal. `group` is 'mass' (the Holy Mass prayers) or 'devotional'.
 */
export const PRAYER_CATALOG = Object.freeze([
  { id: 'confiteor', title: 'I Confess (Confiteor)', slotId: 'confess', group: 'mass' },
  { id: 'kyrie', title: 'Kyrie (Lord, Have Mercy)', slotId: 'kyrie', part: 'kyrie', group: 'mass' },
  { id: 'gloria', title: 'Gloria', slotId: 'gloria', part: 'gloria', group: 'mass' },
  { id: 'collect', title: 'Opening Prayer (Collect)', slotId: 'collect', group: 'mass' },
  { id: 'apostles-creed', title: "Credo (Apostles' Creed)", slotId: 'creed', part: 'credo', group: 'mass' },
  { id: 'nicene-creed', title: 'Nicene Creed', slotId: 'creed', group: 'mass' },
  { id: 'prayer-faithful', title: 'Prayer of the Faithful', slotId: 'prayer-faithful', group: 'mass' },
  { id: 'accept-sacrifice', title: 'May the Lord Accept the Sacrifice', slotId: 'accept-sacrifice', group: 'mass' },
  { id: 'sanctus', title: 'Sanctus (Holy, Holy, Holy)', slotId: 'sanctus', part: 'sanctus', group: 'mass' },
  { id: 'memorial-acclamation', title: 'Memorial Acclamation', slotId: 'memorial-acclamation', part: 'memorial-acclamation', group: 'mass' },
  { id: 'doxology', title: 'Doxology', slotId: 'doxology', group: 'mass' },
  { id: 'lords-prayer', title: 'Pater Noster (Our Father)', slotId: 'lords-prayer', part: 'pater-noster', group: 'mass' },
  { id: 'agnus-dei', title: 'Agnus Dei (Lamb of God)', slotId: 'agnus-dei', part: 'agnus-dei', group: 'mass' },
  { id: 'not-worthy', title: 'Lord, I Am Not Worthy', slotId: 'not-worthy', group: 'mass' },
  { id: 'prayer-after-communion', title: 'Prayer after Communion', slotId: 'prayer-after-communion', group: 'mass' },
  { id: 'hail-mary', title: 'Hail Mary', group: 'devotional' },
  { id: 'glory-be', title: 'Glory Be', group: 'devotional' },
  { id: 'act-of-contrition', title: 'Act of Contrition', group: 'devotional' },
  { id: 'angelus', title: 'The Angelus', group: 'devotional' },
  { id: 'holy-spirit', title: 'Prayer to the Holy Spirit', group: 'devotional' },
  { id: 'take-authority', title: 'Prayer to Take Authority', group: 'devotional' },
  { id: 'consecration-mary', title: 'Consecration to Mary, Our Lady of Nazareth', group: 'devotional' },
  { id: 'st-michael', title: 'Prayer to St. Michael the Archangel', group: 'devotional' },
  { id: 'holy-rosary', title: 'The Holy Rosary', group: 'devotional' },
  { id: 'divine-mercy', title: 'Divine Mercy Chaplet', group: 'devotional' },
  { id: 'intercessions', title: 'Intercessions', group: 'devotional' },
  { id: 'blessing', title: 'Closing Prayer and Blessing', group: 'devotional' },
]);

export const PRAYER_GROUPS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'mass', label: 'Holy Mass' },
  { id: 'devotional', label: 'Praise & Worship' },
]);
export const prayerGroupOf = (value) => (PRAYER_GROUPS.some((g) => g.id === value) ? value : 'all');

/** The catalog narrowed by group and by a search of the title. */
export function filterPrayers(query = '', group = 'all') {
  const needle = lower(query);
  return PRAYER_CATALOG.filter((p) => (group === 'all' || p.group === group) && (!needle || lower(p.title).includes(needle)));
}

/** The entry a Prayers card puts in a slot: its title, marked as a prayer. */
export const prayerEntry = (prayer) => ({ text: prayer.title, contentType: 'prayer' });

/** The slot a catalog prayer goes to when nothing is selected: its own Holy Mass slot's row, or null (a devotional prayer needs a slot picked). */
export function slotForPrayer(prayer, rows, activeId = null) {
  if (activeId && rows.some((row) => row.id === activeId)) return activeId;
  if (!prayer?.slotId) return null;
  return rows.find((row) => row.massSlotId === prayer.slotId)?.id ?? null;
}

const PRAYER_TITLES = new Set(PRAYER_CATALOG.map((p) => lower(p.title)));

// ---- Scripture ----

/** The translations the church laptop's offline Bible has (shared/bible-ref.js), each with the language it reads in. */
export const SCRIPTURE_VERSIONS = Object.freeze([
  { id: 'WEB', label: 'WEB', name: 'World English Bible', language: 'EN' },
  { id: 'TGL', label: 'TGL', name: 'Tagalog Bible', language: 'TL' },
  { id: 'CEB', label: 'CEB', name: 'Cebuano Bible', language: 'CEB' },
]);
export const versionOf = (value) => SCRIPTURE_VERSIONS.find((v) => v.id === String(value ?? '').toUpperCase()) ?? null;

const OT = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Tobit', 'Judith', 'Esther', '1 Maccabees', '2 Maccabees', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Songs', 'Wisdom', 'Sirach', 'Isaiah', 'Jeremiah', 'Lamentations', 'Baruch', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'];
const NT = ['Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'];
/** The books the builder offers, in canon order, each with its testament. */
export const SCRIPTURE_BOOKS = Object.freeze([...OT.map((name) => ({ name, testament: 'OT' })), ...NT.map((name) => ({ name, testament: 'NT' }))]);

const MAX_TEXT = 200;
const VERSES = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/;

/**
 * A reference from the builder: book, chapter, verse or verse range, and version. Returns { text, reference } (`text` is what is stored: "Sample Book 1:1-6 (WEB)")
 * or { error } in plain words. The same shape is read back by parseScripture, so what is built is what the laptop reads.
 */
export function buildScripture({ book, chapter, verses, version = 'WEB' } = {}) {
  const name = String(book ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'Choose a book.' };
  const chapterNumber = Number(String(chapter ?? '').trim());
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1 || chapterNumber > 150) return { error: 'Enter a chapter number, such as 3.' };
  const range = VERSES.exec(String(verses ?? '').trim());
  if (!range) return { error: 'Enter a verse or a range of verses, such as 16 or 1-6.' };
  const from = Number(range[1]);
  const to = range[2] === undefined ? from : Number(range[2]);
  if (from < 1 || to < from) return { error: 'The last verse must come after the first.' };
  const chosen = versionOf(version);
  if (!chosen) return { error: 'Choose a version.' };
  const reference = `${name} ${chapterNumber}:${from}${to > from ? `-${to}` : ''}`;
  const text = `${reference} (${chosen.id})`;
  if (text.length > MAX_TEXT) return { error: 'That reference is too long.' };
  return { text, reference, version: chosen.id };
}

const TRAILING_VERSION = /^(.*?)\s*\(\s*([A-Za-z]{2,5})\s*\)\s*$/;
const TYPED = /^(.*?)\s*(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/;

/** Reads a stored or typed reference ("Sample Book 1:1-6 (WEB)", or without the version). Null when the text is not one. `version` is null when none is named. */
export function parseScripture(text) {
  let body = String(text ?? '').trim();
  let version = null;
  const tail = TRAILING_VERSION.exec(body);
  if (tail) {
    version = versionOf(tail[2])?.id ?? null;
    if (!version) return null;
    body = tail[1];
  }
  const match = TYPED.exec(body);
  if (!match || !match[1].trim()) return null;
  const built = buildScripture({ book: match[1], chapter: match[2], verses: match[4] ? `${match[3]}-${match[4]}` : match[3], version: version ?? 'WEB' });
  if (built.error) return null;
  return { book: match[1].replace(/\s+/g, ' ').trim(), chapter: Number(match[2]), reference: built.reference, version, text: version ? built.text : built.reference };
}

/** A typed reference with no version takes the one chosen beside it. Returns what buildScripture returns. */
export function scriptureFromTyped(typed, defaultVersion = 'WEB') {
  const parsed = parseScripture(typed);
  if (!parsed) return { error: 'Type a reference like "Sample Book 1:1-6".' };
  return buildScripture({ book: parsed.book, chapter: parsed.chapter, verses: parsed.reference.split(':')[1], version: parsed.version ?? defaultVersion });
}

/** The entry a Scripture add puts in a slot: the reference, marked as scripture. */
export const scriptureEntry = (text) => ({ text, contentType: 'scripture' });

// ---- How an entry is told apart ----

/**
 * 'prayer', 'scripture' or '' for an entry ({ text, contentType, songId, contentHubId }). A saved type wins. Without one (an item the laptop sent back, or a
 * plan from before), a title that is in the Prayers catalog is a prayer, and a reference with a version is Scripture. A song and a Content Hub entry are neither.
 */
export function entryBadge(entry) {
  if (!entry || entry.songId || entry.contentHubId) return '';
  if (entry.contentType === 'prayer') return 'prayer';
  if (entry.contentType === 'scripture') return 'scripture';
  if (entry.contentType && entry.contentType !== 'text_note') return '';
  const text = String(entry.text ?? '').trim();
  if (!text) return '';
  if (PRAYER_TITLES.has(lower(text))) return 'prayer';
  const parsed = parseScripture(text);
  return parsed?.version ? 'scripture' : '';
}

/** The language tag a badge row shows: the version's language for a reference, otherwise the plan's own. */
export function languageTagOf(entry, planLanguage = 'EN') {
  if (badgeOf(entry) !== 'scripture') return planLanguage;
  return versionOf(parseScripture(entry.text ?? entry.title)?.version)?.language ?? planLanguage;
}

/** The badge an entry already carries (describeEntries sets it), or the one its fields give. */
const badgeOf = (entry) => entry?.badge ?? entryBadge(entry);

export const BADGE_LABEL = Object.freeze({ prayer: 'Prayer', scripture: 'Scripture' });

/** The small PRAYER or SCRIPTURE badge, and the language tag beside it. Empty for any other entry. */
export function kindBadgeHtml(entry, planLanguage = 'EN') {
  const badge = badgeOf(entry);
  if (!badge) return '';
  const tag = languageTagOf(entry, planLanguage);
  return `<span class="lp-kind-badge is-${badge}">${esc(BADGE_LABEL[badge])}</span>${tag ? `<span class="lp-lang-tag">${esc(tag)}</span>` : ''}`;
}

/**
 * "Also in this plan": the items the church laptop put in the plan that fill no slot or segment here (a Bible passage or a prayer added without a slot).
 * They are kept and sent back when the plan is saved, so they are listed rather than hidden. `entries` are described entries (describeEntries).
 */
export function extraItemsHtml(entries, language = '') {
  if (!entries.length) return '';
  const rows = entries.map((e) => `<li class="lp-pill is-${esc(e.source)}${e.badge ? ` is-${e.badge}` : ''}">${kindBadgeHtml(e, language)}<span class="lp-pill-title">${esc(e.title)}</span></li>`).join('');
  return `
        <section class="lp-section lp-extra" aria-label="Also in this plan">
          <h2 class="lp-section-head"><span>Also in this plan</span><span class="lp-section-count">${entries.length}</span></h2>
          <ul class="lp-pills">${rows}</ul>
          <p class="lp-lib-hint">These came from the church laptop without a slot. They are kept, and sent back when you save.</p>
        </section>`;
}

// ---- The tabs ----

const SEARCH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

/** The prayer cards: the PRAYER badge, title, where it goes, and + (✓ when `held` has its title; pressing it then takes it out). */
export function prayerListHtml({ query = '', group = 'all', canEdit = true, held = new Set(), into = '', planLanguage = 'EN', slotNameOf = () => '' } = {}) {
  const lock = canEdit ? '' : ' disabled';
  const list = filterPrayers(query, group);
  if (!list.length) return '<p class="lp-empty">No prayers match. Try another group, or clear the search.</p>';
  return `<ul class="lp-songs lp-prayers">${list.map((p) => {
    const has = held.has(lower(p.title));
    const slot = p.slotId ? slotNameOf(p.slotId) : '';
    return `<li class="lp-song lp-prayer-card${has ? ' is-added' : ''}">
          <span class="lp-kind-badge is-prayer">Prayer</span>
          <span class="lp-song-text"><strong>${esc(p.title)}</strong><span>${esc([p.group === 'mass' ? (slot ? `Goes to ${slot}` : 'Holy Mass') : 'Praise & Worship', planLanguage].filter(Boolean).join(' · '))}</span></span>
          <button type="button" class="lp-song-add" data-lib-prayer="${esc(p.id)}"${into ? ` data-into="${esc(into)}"` : ''} aria-pressed="${has}" aria-label="${has ? 'Take out' : 'Add'} ${esc(p.title)}" title="${has ? 'In the slot. Press to take it out.' : 'Add to the slot'}"${lock}>${has ? '✓' : '+'}</button>
        </li>`;
  }).join('')}</ul>`;
}

/**
 * The Prayers tab: a search, Holy Mass / Praise & Worship / All, and the cards. `into` is the row a panel inside a slot adds to; the library leaves it
 * out and adds to the target slot, or to the prayer's own slot.
 */
export function prayersPanelHtml(options = {}) {
  const { query = '', group = 'all', into = '' } = options;
  const segs = PRAYER_GROUPS.map((g) => `<button type="button" class="lp-seg${g.id === group ? ' is-on' : ''}" data-prayer-group="${g.id}" aria-pressed="${g.id === group}">${esc(g.label)}</button>`).join('');
  return `
      <p class="lp-lib-hint">A prayer is added by its title. The church laptop shows its own approved text for the Holy Mass parts it has; no prayer words are kept on the website.</p>
      <label class="lp-search">${SEARCH_ICON}
        <input type="search" data-prayer-search aria-label="Search prayers by title" placeholder="Search prayers" value="${esc(query)}" autocomplete="off">
      </label>
      <div class="lp-segs" role="group" aria-label="Prayer group">${segs}</div>
      <div data-prayer-list${into ? ` data-into="${esc(into)}"` : ''} class="lp-lib-list">${prayerListHtml(options)}</div>`;
}

/** The reference a draft would add, or '' while it is not a whole reference yet. A typed reference wins over the fields. */
export function scripturePreview(draft = {}) {
  const typed = String(draft.typed ?? '').trim();
  const made = typed ? scriptureFromTyped(typed, draft.version) : buildScripture(draft);
  return made.text ?? '';
}

/**
 * The Scripture tab's builder: a typed reference, or Book, Chapter, Verses and Version, with the reference it makes shown before it is added. `draft` is
 * { book, chapter, verses, version, typed }. The Bible text itself is never on the website: the church laptop reads the passage from its own offline Bible.
 */
export function scripturePanelHtml({ draft = {}, error = '', canEdit = true, into = '', newSegment = false } = {}) {
  const lock = canEdit ? '' : ' disabled';
  const version = versionOf(draft.version)?.id ?? 'WEB';
  const books = (testament, label) => `<optgroup label="${label}">${SCRIPTURE_BOOKS.filter((b) => b.testament === testament).map((b) => `<option value="${esc(b.name)}"${b.name === draft.book ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</optgroup>`;
  const versions = SCRIPTURE_VERSIONS.map((v) => `<button type="button" class="lp-seg${v.id === version ? ' is-on' : ''}" data-sf-version="${v.id}" aria-pressed="${v.id === version}" title="${esc(v.name)}">${esc(v.label)}</button>`).join('');
  const preview = scripturePreview({ ...draft, version });
  return `
      <div class="lp-sf" data-sf-root>
        <p class="lp-lib-hint">Pick the passage by its reference. The church laptop shows the verses from its own offline Bible; no Bible text is kept on the website.</p>
        <label class="lp-field"><span>Type a reference</span>
          <input type="text" data-sf="typed" maxlength="120" placeholder="e.g. Sample Book 1:1-6" value="${esc(draft.typed ?? '')}" autocomplete="off"${lock}>
        </label>
        <label class="lp-field"><span>Book</span>
          <select data-sf="book"${lock}><option value="">Choose a book</option>${books('OT', 'Old Testament')}${books('NT', 'New Testament')}</select>
        </label>
        <div class="lp-sf-row">
          <label class="lp-field"><span>Chapter</span><input type="number" min="1" max="150" inputmode="numeric" data-sf="chapter" value="${esc(draft.chapter ?? '')}"${lock}></label>
          <label class="lp-field"><span>Verse or range</span><input type="text" inputmode="numeric" data-sf="verses" maxlength="8" placeholder="1-6" value="${esc(draft.verses ?? '')}"${lock}></label>
        </div>
        <div class="lp-segs" role="group" aria-label="Version">${versions}</div>
        <p class="lp-sf-preview" data-sf-preview${preview ? '' : ' hidden'}>${preview ? `Adds <strong>${esc(preview)}</strong>` : ''}</p>
        <p class="lp-popover-error" role="alert" data-sf-error>${esc(error)}</p>
        ${newSegment
          ? `<label class="lp-field"><span>Segment title (optional)</span>
          <input type="text" data-sf="title" maxlength="80" placeholder="Sample Segment Title" value="${esc(draft.title ?? '')}" autocomplete="off"${lock}>
        </label>
        <div class="pw-lib-actions">
          <button type="button" class="btn-primary lp-lib-wide" data-add-scripture${into ? ` data-into="${esc(into)}"` : ''}${lock}>Insert into segment</button>
          <button type="button" class="btn-quiet lp-lib-wide" data-add-scripture-new${lock}>Add as new segment</button>
        </div>`
          : `<button type="button" class="btn-primary lp-lib-wide" data-add-scripture${into ? ` data-into="${esc(into)}"` : ''}${lock}>Add Scripture</button>`}
      </div>`;
}
