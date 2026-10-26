// Hymn lyric parsing. Shared by the renderer (live preview while typing) and the
// main process (the authoritative check when a hymn is saved).
export const CATEGORIES = ['Entrance', 'Offertory', 'Communion', 'Recessional', 'General'];
export const LANGUAGES = ['EN', 'TL', 'CEB'];
export const MAX_STANZAS = 40;

// A tag sits alone on its line: [V1], [V2], [C], [B], [T], or a spelled-out form like [Verse 2].
const TAG = /^\s*\[\s*([A-Za-z]+)\s*(\d*)\s*\]\s*$/;
const TAG_KIND = {
  v: 'Verse', verse: 'Verse',
  c: 'Chorus', ch: 'Chorus', chorus: 'Chorus',
  b: 'Bridge', br: 'Bridge', bridge: 'Bridge',
  t: 'Tag', tag: 'Tag',
  o: 'Outro', outro: 'Outro',
};

const TAG_FOR_KIND = { Verse: 'V', Chorus: 'C', Bridge: 'B', Tag: 'T', Outro: 'O' };

// A section written as a word: "Verse 1", "VERSE 1:", "Chorus", "Refrain". The colon or full stop is optional.
const WORD_HEADER = /^\s*(verse|chorus|refrain|bridge|tag|outro)\s*(\d*)\s*[:.]?\s*$/i;
const WORD_KIND = { verse: 'Verse', chorus: 'Chorus', refrain: 'Chorus', bridge: 'Bridge', tag: 'Tag', outro: 'Outro' };

/**
 * The section a line starts, or null for a lyric line. Recognises the bracket tags ([V1], [C], [B], [T], [O]) and the word
 * headers ("Verse 1", "VERSE 1:", "Chorus", "Refrain"). A bracket tag that is not known comes back with kind null, so the
 * parser can report it. Short forms such as "C" are not headers: they stay lyric lines.
 */
export function sectionHeader(line) {
  const text = String(line ?? '');
  const bracket = text.match(TAG);
  if (bracket) {
    return { kind: TAG_KIND[bracket[1].toLowerCase()] ?? null, number: bracket[2], tag: `[${bracket[1]}${bracket[2]}]` };
  }
  const word = text.match(WORD_HEADER);
  if (word) return { kind: WORD_KIND[word[1].toLowerCase()], number: word[2], tag: null };
  return null;
}

/** The inverse of parseLyrics: stored stanzas back to tagged text, for the edit dialog. */
export function toTaggedLyrics(stanzas) {
  return stanzas
    .map((s) => {
      const m = s.stanzaType.match(/^(Verse|Chorus|Bridge|Tag|Outro)\s*(\d*)$/);
      const tag = m ? `[${TAG_FOR_KIND[m[1]]}${m[2]}]` : `[${s.stanzaType}]`;
      return `${tag}\n${s.lyricsText}`;
    })
    .join('\n\n');
}

/**
 * Splits pasted lyrics into stanzas.
 *
 * With tags, each tag starts a new stanza and the lines under it belong to it.
 * Without tags, blank lines separate verses. Returns { stanzas, warnings, errors }.
 * Anything in `errors` means the hymn cannot be saved.
 */
export function parseLyrics(raw) {
  const lines = String(raw ?? '').replace(/\r\n?/g, '\n').split('\n');
  const warnings = [];
  const errors = [];
  const sections = [];
  let verseCount = 0;

  const startSection = (label) => {
    const section = { label, lines: [] };
    sections.push(section);
    return section;
  };

  if (lines.some((line) => sectionHeader(line))) {
    let current = null;
    for (const line of lines) {
      const header = sectionHeader(line);
      if (header) {
        const { kind, number } = header;
        if (!kind) {
          errors.push(`Unknown tag ${header.tag}. Use [V1], [C], [B], [T], or [O].`);
          current = null;
          continue;
        }
        if (kind === 'Verse') {
          verseCount += 1;
          current = startSection(`Verse ${number ? Number(number) : verseCount}`);
        } else {
          current = startSection(number ? `${kind} ${Number(number)}` : kind);
        }
      } else if (line.trim()) {
        if (!current) {
          current = startSection('Verse 1');
          warnings.push('Lyrics before the first tag were placed in Verse 1.');
        }
        current.lines.push(line);
      }
    }
  } else {
    let block = [];
    const closeBlock = () => {
      if (block.length) startSection(`Verse ${++verseCount}`).lines = block;
      block = [];
    };
    for (const line of lines) {
      if (line.trim()) block.push(line);
      else closeBlock();
    }
    closeBlock();
  }

  const stanzas = [];
  for (const section of sections) {
    const lyricsText = section.lines.join('\n').trim();
    if (!lyricsText) {
      warnings.push(`${section.label} is empty and was skipped.`);
      continue;
    }
    stanzas.push({ stanzaType: section.label, lyricsText });
  }

  if (stanzas.length === 0 && errors.length === 0) {
    errors.push('Add at least one stanza. Paste the lyrics, or mark parts with tags like [V1] and [C].');
  }
  if (stanzas.length > MAX_STANZAS) {
    errors.push(`A hymn can have at most ${MAX_STANZAS} stanzas.`);
  }
  return { stanzas, warnings, errors };
}
