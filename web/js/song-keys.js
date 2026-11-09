// Song keys for the Praise & Worship editor. parseKey, transposeKey and the spellings are a copy of the laptop's shared/setlist-tools.js, because
// the website serves only web/. A test keeps the two equal.

const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

/** A song key read as a pitch (0 = C) and a mode. Null for anything else, such as an empty key. */
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

const shiftLabel = (step) => (step > 0 ? `+${step}` : `−${-step}`);

/**
 * The keys a song can be sung in for one plan: { value, label }. The value '' means the song's own key from the list. A readable key offers the
 * twelve keys of its mode, from five semitones down to six up, so each appears once. A key that cannot be read, or none, offers every key. The
 * key the plan already has is always offered, so opening the list never changes it.
 */
export function keyChoices(original, current = '') {
  const own = String(original ?? '').trim();
  const home = { value: '', label: own ? `${own} (song's key)` : 'No key set' };
  const choices = parseKey(own)
    ? Array.from({ length: 12 }, (_, i) => i - 5).map((step) => {
        if (step === 0) return home;
        const value = transposeKey(own, step);
        return { value, label: `${value} (${shiftLabel(step)})` };
      })
    : [home, ...[...MAJOR, ...MINOR].map((value) => ({ value, label: value }))];
  return current && !choices.some((c) => c.value === current) ? [...choices, { value: current, label: current }] : choices;
}
