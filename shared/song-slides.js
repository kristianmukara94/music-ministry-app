// A song's default slide arrangement: the slides an operator left the song in, saved on the song (hymns.default_slides_json) so every later
// use plays exactly those slides: a Praise & Worship card, a Holy Mass song, Quick-Live, and the next run of the app.
//
// The arrangement never changes the song's own words (its stanzas in Song Lyrics). It is a separate list of slides, stamped with a hash of
// the words it was made from (`lyricsHash`). When the words in Song Lyrics are rewritten the hash no longer matches, the arrangement is
// ignored (and cleared on that save), and the song is paged automatically again.
//
// Plain JS with no Electron or React, so the main process (storing, export/import), the renderer (Go Live, the planner, Quick-Live) and the
// tests share the rules.
import { sanitizeSlideLook } from './slide-look.js';
import { sectionChip } from './pw.js';

export const SONG_SLIDES_VERSION = 1;
/** The most slides an arrangement keeps. */
export const MAX_SONG_SLIDES = 200;
const MAX_LABEL = 60;
const MAX_LINES = 40;
const MAX_LINE = 500;
const MAX_NOTES = 300;
const HASH = /^v1-[0-9a-f]{16}$/;

const text = (value, max) => (typeof value === 'string' ? value.replace(/\0/g, '').trim().slice(0, max).trim() : '');
/** Words as compared: line breaks of any kind made one, spaces at line ends and blank lines around the words dropped. */
const words = (value) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

function fnv1a(input, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const hex = (n) => n.toString(16).padStart(8, '0');
const hash64 = (input) => `${hex(fnv1a(input, 0x811c9dc5))}${hex(fnv1a(input, 0x9e3779b9))}`;

/**
 * A fingerprint of a song's words as Song Lyrics holds them: each stanza's part and words, in order. Two songs with the same words (line
 * endings and trailing spaces aside) have the same hash; any other change to a word, a part or the order gives another.
 */
export function lyricsHash(stanzas) {
  const body = (Array.isArray(stanzas) ? stanzas : []).map((s) => `${text(s?.stanzaType, MAX_LABEL)}\u0001${words(s?.lyricsText)}`).join('\u0002');
  return `v1-${hash64(body)}`;
}

/** One slide as it may be saved, or null when it has no words. */
function sanitizeSlide(slide) {
  if (!slide || typeof slide !== 'object') return null;
  const raw = Array.isArray(slide.lines) ? slide.lines : typeof slide.text === 'string' ? slide.text.split('\n') : [];
  const lines = raw.map((line) => String(line ?? '').replace(/\0/g, '').replace(/\r/g, '').trimEnd().slice(0, MAX_LINE));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return null;
  const label = text(slide.label, MAX_LABEL) || text(slide.sectionTag, MAX_LABEL) || 'Verse 1';
  const out = { label, sectionTag: text(slide.sectionTag, MAX_LABEL) || sectionChip(label), lines: lines.slice(0, MAX_LINES) };
  const notes = text(slide.notes, MAX_NOTES);
  if (notes) out.notes = notes;
  const style = sanitizeSlideLook(slide.style);
  if (style) out.style = style;
  return out;
}

/**
 * An arrangement as it may be stored or used: `{ version, lyricsHash, slides }`, or null when there is none (nothing given, unreadable JSON,
 * no hash, or no slide with words). Accepts the stored JSON text too. Slides with no words are dropped; past MAX_SONG_SLIDES are cut.
 */
export function sanitizeSongSlides(value) {
  let data = value;
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || !HASH.test(String(data.lyricsHash ?? ''))) return null;
  const slides = (Array.isArray(data.slides) ? data.slides : []).map(sanitizeSlide).filter(Boolean).slice(0, MAX_SONG_SLIDES);
  return slides.length ? { version: SONG_SLIDES_VERSION, lyricsHash: data.lyricsHash, slides } : null;
}

/** The arrangement to store for a song whose words in Song Lyrics are `stanzas`: the slides given, stamped with those words' hash. */
export function songSlidesFor(stanzas, slides) {
  return sanitizeSongSlides({ lyricsHash: lyricsHash(stanzas), slides });
}

/** True when `hymn` (as Song Lyrics holds it) has an arrangement made from its words as they are now. */
export function hasCurrentSongSlides(hymn) {
  const saved = sanitizeSongSlides(hymn?.defaultSlides);
  return Boolean(saved && saved.lyricsHash === lyricsHash(hymn?.stanzas));
}

/**
 * The stanza ids a resolved arrangement gives its slides: negative (never a stored stanza's), the same every time for the same slides (so a
 * lineup order saved with them still holds after a restart), and new for any other arrangement (so an order made for an older arrangement,
 * or for the song's own stanzas, matches none of them and the card sings the arrangement as saved).
 */
export function songSlideIds(arrangement) {
  const slides = arrangement?.slides ?? [];
  const seed = fnv1a(JSON.stringify(slides.map((s) => [s.label, s.lines])), 0x811c9dc5) % 4_000_000;
  return slides.map((_, i) => -(1_000_000 + seed * 256 + i));
}

/**
 * The song as Go Live plays it: with a current arrangement, its stanzas are the saved slides, one stanza per slide, each fixed as exactly
 * one slide (`pages`), so nothing re-splits them for the text size or the stanza length; a saved look rides on the stanza as `look`. Without
 * one (none saved, or the words were rewritten since), the song comes back as it is and is paged as usual. `slideLayout` says which.
 */
export function resolveSongSlides(hymn) {
  if (!hymn || !Array.isArray(hymn.stanzas)) return hymn;
  const saved = sanitizeSongSlides(hymn.defaultSlides);
  if (!saved || saved.lyricsHash !== lyricsHash(hymn.stanzas)) return { ...hymn, slideLayout: 'auto' };
  const ids = songSlideIds(saved);
  const stanzas = saved.slides.map((slide, i) => {
    const page = slide.lines.join('\n');
    return {
      id: ids[i],
      stanzaType: slide.label,
      lyricsText: page,
      order: i + 1,
      pages: [page],
      ...(slide.style ? { look: slide.style } : {}),
      ...(slide.notes ? { notes: slide.notes } : {}),
    };
  });
  return { ...hymn, stanzas, slideLayout: 'default' };
}

/**
 * A song's slides as an arrangement's slides, in the order given (stanza ids as strings; every stanza when left out). `pagesOf(stanza)` gives
 * a stanza's slides as the console shows them; left out, a stanza's own fixed pages, else its words as one slide. Each slide keeps its
 * stanza's look and notes.
 */
export function songSlidesOf(hymn, { order, pagesOf } = {}) {
  const stanzas = hymn?.stanzas ?? [];
  const sung = Array.isArray(order) ? order.map((id) => stanzas.find((s) => String(s.id) === String(id))).filter(Boolean) : stanzas;
  const slides = [];
  for (const stanza of sung) {
    const own = Array.isArray(stanza.pages) && stanza.pages.length ? stanza.pages : null;
    const pages = (pagesOf ? pagesOf(stanza) : null) ?? own ?? [stanza.lyricsText];
    for (const page of pages) {
      slides.push({
        label: stanza.stanzaType,
        sectionTag: sectionChip(stanza.stanzaType),
        lines: String(page ?? '').split('\n'),
        ...(stanza.look ? { style: stanza.look } : {}),
        ...(stanza.notes ? { notes: stanza.notes } : {}),
      });
    }
  }
  return slides;
}

/** The slides with slide `index`'s look and notes set (a null look or empty notes drops them). Other slides are returned as they are. */
export function withSlideDetails(slides, index, { look, notes } = {}) {
  return (slides ?? []).map((slide, i) => {
    if (i !== index) return slide;
    const { style: _style, notes: _notes, ...rest } = slide;
    const ownLook = look === undefined ? slide.style : sanitizeSlideLook(look);
    const ownNotes = notes === undefined ? slide.notes : text(notes, MAX_NOTES);
    return { ...rest, ...(ownLook ? { style: ownLook } : {}), ...(ownNotes ? { notes: ownNotes } : {}) };
  });
}
