// Song Lyrics setlist helpers: the in-setlist filter and the key stepper. Plain JS with no React, so the console and the tests share them.

/** Lower case, accents dropped and spaces squeezed, so "Pagbabalik-Loób" matches "pagbabalik-loob". */
export function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The setlist rows that match `query`, each with its index in the whole setlist, so a filtered row keeps its own number (the 13th
 * song still shows 13). Every word of the query must appear in the title or the composer. An empty query gives every row.
 */
export function filterSetlist(entries, query) {
  const rows = (entries ?? []).map((entry, index) => ({ entry, index }));
  const words = foldText(query).split(' ').filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter(({ entry }) => {
    const hay = foldText(`${entry.title} ${entry.composer ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
}

const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// The usual spelling of each key, as the song form offers them: flats where a flat key is the common one, sharps otherwise.
const MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

/**
 * A song key read as a pitch (0 = C) and a mode. Takes the keys the song form offers ("E", "Bb", "F#m") and the common long forms
 * ("C minor", "D major", "F♯"). Null for anything else, such as an empty key.
 */
export function parseKey(key) {
  const m = /^\s*([A-Ga-g])\s*([#b♯♭]?)\s*(m|min|minor|maj|major)?\s*$/.exec(String(key ?? ''));
  if (!m) return null;
  const accidental = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  const pitch = (PITCH[m[1].toUpperCase()] + accidental + 12) % 12;
  const minor = Boolean(m[3]) && /^m(in(or)?)?$/i.test(m[3]) && !/^maj/i.test(m[3]);
  return { pitch, minor };
}

/** The key `semitones` above (or below) `key`, in its usual spelling. Null when the key cannot be read; the key itself at 0. */
export function transposeKey(key, semitones) {
  const parsed = parseKey(key);
  if (!parsed) return null;
  const step = Math.trunc(Number(semitones) || 0);
  if (step === 0) return String(key).trim();
  const pitch = (((parsed.pitch + step) % 12) + 12) % 12;
  return (parsed.minor ? MINOR : MAJOR)[pitch];
}

/** The furthest the stepper goes either way: a fifth up or down covers every key without wrapping round. */
export const MAX_TRANSPOSE = 6;

/** A transposition kept in range, as a whole number of semitones. */
export function clampTranspose(semitones) {
  const n = Math.trunc(Number(semitones) || 0);
  return Math.max(-MAX_TRANSPOSE, Math.min(MAX_TRANSPOSE, n));
}

/** "+2", "−1", or "" at 0: the shift shown beside the key. */
export function transposeLabel(semitones) {
  const n = clampTranspose(semitones);
  return n === 0 ? '' : n > 0 ? `+${n}` : `−${-n}`;
}

/** Where a song's transposition is kept for the session: per setlist and song, so reordering the setlist keeps it. */
export function transposeId(setlistId, hymnId) {
  return `${setlistId ?? 'none'}:${hymnId}`;
}
