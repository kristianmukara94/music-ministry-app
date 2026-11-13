// Word (.docx) worship lineup importer: one document holding many songs, read straight from word/document.xml and taken apart into songs,
// sections and a sung arrangement. Modelled on the parish's own lineup files, where every song title is a bold paragraph, lyrics are typed in
// capitals as long paragraphs (often padded with spaces instead of line breaks), and the flow is written as cues such as "(REPEAT CHORUS 2x)".
// Pure apart from the optional JSZip read, so the renderer, the review modal and the tests share the same rules.
import { MAX_STANZAS, toTaggedLyrics } from './lyrics-parser.js';

/** The fewest and most lines a projector slide gets when a long stanza is broken up. */
export const SLIDE_MIN_LINES = 2;
export const SLIDE_MAX_LINES = 4;
/** The longest a projected line should be before it is broken at a clause or between words. */
export const LINE_MAX_CHARS = 40;
/** The most songs one document can make. */
export const MAX_DOCX_SONGS = 300;
/** The largest .docx file the importer reads. */
export const MAX_DOCX_BYTES = 10 * 1024 * 1024;
/** The longest a song title may be, as the hymn library allows. */
export const MAX_TITLE_CHARS = 120;

// A paragraph longer than this is a "wall of text": a whole stanza typed as one line.
const WALL_CHARS = 60;
const TITLE_MAX_WORDS = 10;
const TITLE_MAX_CHARS = 70;
/** Kinds that are sung once, at the end, and so are left out of "REPEAT ALL". */
const CLOSING_KINDS = new Set(['Coda', 'Ending', 'Tag']);

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Reading word/document.xml

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

const isOn = (props, tag) => {
  const m = new RegExp(`<w:${tag}(?:\\s+w:val="([^"]*)")?\\s*/>`).exec(props);
  return Boolean(m) && !/^(0|false|off|none)$/i.test(m[1] ?? '');
};

/**
 * The paragraphs of a Word document's body, from its word/document.xml: each paragraph's text (a line break inside it is "\n", a tab is
 * three spaces), and whether it is bold all through, underlined all through, or set in a Heading or Title style. Deleted tracked changes and
 * the fallback copies of drawings are left out.
 */
export function paragraphsFromDocumentXml(xml) {
  const body = String(xml ?? '')
    .replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '')
    .replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '');
  const paragraphs = [];
  const PARA = /<w:p\b[^>]*?\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let p;
  while ((p = PARA.exec(body))) {
    const inner = p[1] ?? '';
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(inner)?.[1] ?? '';
    let text = '';
    let runsWithText = 0;
    let boldRuns = 0;
    let underlineRuns = 0;
    const RUN = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
    let r;
    while ((r = RUN.exec(inner))) {
      const run = r[1];
      const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? '';
      let runText = '';
      const PIECE = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>|<w:noBreakHyphen\s*\/>/g;
      let piece;
      while ((piece = PIECE.exec(run))) {
        if (piece[1] !== undefined) runText += decodeXml(piece[1]);
        else if (piece[0].startsWith('<w:tab')) runText += '   ';
        else if (piece[0].startsWith('<w:noBreakHyphen')) runText += '-';
        else runText += '\n';
      }
      if (runText.trim()) {
        runsWithText += 1;
        if (isOn(props, 'b')) boldRuns += 1;
        if (isOn(props, 'u')) underlineRuns += 1;
      }
      text += runText;
    }
    const some = runsWithText > 0;
    paragraphs.push({
      text,
      bold: some && boldRuns === runsWithText,
      underline: some && underlineRuns === runsWithText,
      heading: /^(heading|title|berschrift|titre|t[ií]tulo)/i.test(style),
    });
  }
  return paragraphs;
}

/** Reads a .docx file (an ArrayBuffer, Uint8Array or Buffer) into its paragraphs. Refuses a file that is not a Word document. */
export async function readDocxParagraphs(data) {
  const { default: JSZip } = await import('jszip');
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (err) {
    throw new Error(`This file could not be read as a Word document. It may be damaged, or be an older .doc file. (${err?.message ?? err})`);
  }
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('This file is not a Word (.docx) document.');
  return paragraphsFromDocumentXml(await doc.async('string'));
}

/** Reads a .docx file and takes it apart into songs. See parseLineup for the options and the result. */
export async function parseDocxSongs(data, options = {}) {
  return parseLineup(await readDocxParagraphs(data), options);
}

/**
 * A plain-text lineup as paragraphs: one per line, none of them bold or a heading, so song titles are found from the shape of the lines
 * (short stand-alone lines, numbered titles), as in a Word file typed without bold titles.
 */
export function paragraphsFromText(text) {
  return String(text ?? '')
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .map((line) => ({ text: line.replace(/\t/g, '   ').trimEnd(), bold: false, underline: false, heading: false }));
}

/** Takes a plain-text (.txt) lineup apart into songs, the same way as a Word one. */
export function parseTextSongs(text, options = {}) {
  return parseLineup(paragraphsFromText(text), options);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Whitespace and case

/**
 * A paragraph's text with its whitespace made regular: non-breaking spaces become spaces, and a run of three or more spaces (typed to push
 * the next words onto a new line) becomes a line break. Each line is trimmed and empty lines are dropped.
 */
export function normalizeSpacing(text) {
  return String(text ?? '')
    .replace(/[   ]/g, ' ')
    .replace(/[​﻿]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '   ')
    .split('\n')
    .flatMap((line) => line.split(/ {3,}/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const letters = (s) => String(s ?? '').match(/\p{L}/gu) ?? [];

/** True when most of the letters in these texts are capitals: the document was typed in ALL CAPS. */
export function isMostlyUpperCase(texts) {
  const all = (Array.isArray(texts) ? texts : [texts]).flatMap(letters);
  if (all.length === 0) return false;
  return all.filter((c) => c !== c.toLowerCase() && c === c.toUpperCase()).length / all.length >= 0.8;
}

// Words that keep a capital in sentence case: God's names, sacred words, and places.
const PROPER = new Map(
  [
    'God', 'Lord', 'Jesus', 'Christ', 'Hesus', 'Hesukristo', 'Jesukristo', 'Kristo', 'Cristo', 'Diyos', 'Dios', 'Ginoo', 'Panginoon', 'Yahweh',
    'Jehovah', 'Emmanuel', 'Immanuel', 'Messiah', 'Mary', 'Maria', 'David', 'Israel', 'Zion', 'Jerusalem', 'Calvary', 'Satan', 'Alleluia',
    'Alleluya', 'Aleluya', 'Hallelujah', 'Halleluyah', 'Hosanna', 'Amen', 'Abba', 'Adonai', 'Elohim', 'Agnus', 'Dei', 'Ama', 'Amang',
  ].map((w) => [w.toLowerCase(), w]),
);
// Typed in capitals. A multiplier such as "(6x)" does not count: its small x is not a lower-case word.
const isUpperLine = (line) => {
  const words = String(line ?? '').replace(/\(\d+x\)/gi, '');
  return /\p{Lu}/u.test(words) && !/\p{Ll}/u.test(words);
};

/** One line in sentence case: lower case, with a capital at the start, after a full stop, for "I", and for God's names. */
export function toSentenceCase(line) {
  let out = String(line ?? '').toLowerCase();
  out = out.replace(/\p{L}[\p{L}\p{M}'’-]*/gu, (word) => {
    const bare = word.replace(/['’].*$/, '');
    if (bare === 'i') return 'I' + word.slice(1);
    const proper = PROPER.get(bare);
    return proper ? proper + word.slice(bare.length) : word;
  });
  out = out.replace(/\bholy spirit\b/g, 'Holy Spirit').replace(/(^|[^\p{L}])o (?=(Lord|God|Jesus|Diyos|Ginoo|Panginoon)\b)/gu, '$1O ');
  // A capital at the start of the line and after . ! ? (with any quotes or brackets in between).
  out = out.replace(/(^|[.!?…]\s+)([("“‘'¡¿]*)(\p{Ll})/gu, (_, before, open, ch) => before + open + ch.toUpperCase());
  return out;
}

const SMALL_WORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'to', 'and', 'or', 'for', 'at', 'by', 'with', 'ng', 'sa', 'ang', 'ug', 'nga', 'at', 'ni']);
/** A title in title case: each word capitalised except short joining words, unless they come first. */
export function toTitleCase(title) {
  let first = true;
  return String(title ?? '')
    .toLowerCase()
    .replace(/\p{L}[\p{L}\p{M}'’-]*/gu, (word) => {
      const keepSmall = !first && SMALL_WORDS.has(word);
      first = false;
      if (word === 'i') return 'I';
      return keepSmall ? word : word[0].toUpperCase() + word.slice(1);
    });
}

/**
 * A line as it is shown with the chosen case: `sentence` turns a line typed in capitals into sentence case (a line that already has small
 * letters is left as it is), `preserve` keeps it as typed.
 */
export function applyCase(line, mode = 'preserve') {
  return mode === 'sentence' && isUpperLine(line) ? toSentenceCase(line) : String(line ?? '');
}

/** A title as it is shown with the chosen case. */
export function applyTitleCase(title, mode = 'preserve') {
  return mode === 'sentence' && isUpperLine(title) ? toTitleCase(title) : String(title ?? '');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Lines: section markers, verse numbers, cues, repeat marks and multipliers

const SECTION_WORDS = {
  chorus: 'Chorus', cho: 'Chorus', refrain: 'Chorus', koro: 'Chorus', korus: 'Chorus',
  bridge: 'Bridge', coda: 'Coda', tag: 'Tag',
  fade: 'Ending', end: 'Ending', ending: 'Ending', outro: 'Ending',
  verse: 'Verse', berso: 'Verse', instrumental: 'Instrumental',
};
const MARKER_LEAD = String.raw`^[\s\x60'"‘’“”*•]*`;
// "CHORUS:", "CHORUS II:", "CODA: words…", "END: I'M FREE", "VERSE 2 -".
const MARKER = new RegExp(`${MARKER_LEAD}(chorus|cho|refrain|koro|korus|bridge|coda|tag|fade|ending|end|outro|verse|berso|instrumental)\\.?\\s*(\\d{1,2}|[ivx]{1,4})?\\s*[:\\-–—]\\s*(.*)$`, 'i');
// The same words alone on their line, with no colon: "CHORUS", "Bridge.", "Verse 2".
const MARKER_BARE = new RegExp(`${MARKER_LEAD}(chorus|refrain|koro|bridge|coda|verse\\s*\\d{1,2})\\s*\\.?\\s*$`, 'i');
// "I.TEXT", "II. TEXT", "IV.TEXT".
const ROMAN_VERSE = /^\s*(x|ix|iv|v?i{1,3}|v)\s*\.\s*(\S.*)$/i;
// "V1- TEXT", "V2: TEXT".
const V_VERSE = /^\s*v(\d{1,2})\s*[-–—:.)]\s*(.*)$/i;
// A line that is only cues in brackets: "(REPEAT CHORUS 2x)", "(KORO)", "(REPEAT: I -4x-)(REPEAT: II)".
const CUE_ONLY = /^\s*(?:\([^()]*\)\s*)+[.…:;]*\s*$/;
// A cue written without brackets: "REPEAT CHORUS:", "Ulitin ang koro".
const CUE_LEAD = /^\s*(?:repeat|ulitin|ulit)\b/i;
const CUE_IN_LINE = /\((?:repeat|ulitin|ulit)\b[^()]*\)/gi;
// A multiplier at the end of a line: "(2x)", " 2x", "– 6X", "-4x-", "HEART.2x".
const MULTIPLIER = /\s*[-–—]?\s*\(?\s*(?<![\p{L}\d])(\d{1,2})\s*[x×]\s*\)?\s*[-–—]?\s*[.:]?\s*$/iu;
const REPEAT_OPEN = /^\s*\/{1,2}\s*:\s*/;
const REPEAT_CLOSE = /\s*:\s*\/{1,2}\s*$/;

const ROMAN = { i: 1, v: 5, x: 10 };
export function romanToInt(s) {
  const chars = String(s ?? '').toLowerCase().split('');
  if (!chars.length || chars.some((c) => !ROMAN[c])) return null;
  return chars.reduce((sum, c, i) => sum + (ROMAN[c] < (ROMAN[chars[i + 1]] ?? 0) ? -ROMAN[c] : ROMAN[c]), 0);
}
const numberOf = (s) => (s == null || s === '' ? null : /^\d+$/.test(s) ? Number(s) : romanToInt(s));

/** A lyric line taken apart: its words, a multiplier at its end, and whether it opens or closes a //: … :// repeat. */
export function parseLyricLine(line) {
  let text = String(line ?? '').trim();
  let mult = 0;
  let open = false;
  let close = false;
  const takeMult = () => {
    const m = MULTIPLIER.exec(text);
    if (m && m.index > 0) {
      mult = Number(m[1]);
      text = text.slice(0, m.index).trim();
    }
  };
  takeMult();
  if (REPEAT_CLOSE.test(text)) {
    close = true;
    text = text.replace(REPEAT_CLOSE, '').trim();
    if (!mult) takeMult();
  }
  if (REPEAT_OPEN.test(text)) {
    open = true;
    text = text.replace(REPEAT_OPEN, '').trim();
  }
  return { text: text.replace(/\s+/g, ' '), mult, open, close };
}

/**
 * What one line of a song is: a section marker ({ kind: 'marker' }), a numbered verse ({ kind: 'verse' }), a flow cue ({ kind: 'cue' }) or a
 * lyric line ({ kind: 'lyric' }). A marker or verse may carry words after it on the same line.
 */
export function classifyLine(line) {
  const text = String(line ?? '').trim();
  if (!text) return { kind: 'blank' };
  if (CUE_ONLY.test(text) || CUE_LEAD.test(text)) return { kind: 'cue', text };
  const marker = MARKER.exec(text) ?? MARKER_BARE.exec(text);
  if (marker) {
    const [word, num] = marker[1].toLowerCase().split(/\s+/);
    const section = SECTION_WORDS[word];
    const n = numberOf(marker[2] ?? num);
    const rest = (marker[3] ?? '').trim();
    if (section === 'Instrumental') return { kind: 'cue', text };
    if (section === 'Verse') return { kind: 'verse', n, text: rest };
    return { kind: 'marker', section, n, text: rest };
  }
  const v = V_VERSE.exec(text);
  if (v) return { kind: 'verse', n: Number(v[1]), text: v[2].trim() };
  const roman = ROMAN_VERSE.exec(text);
  if (roman) return { kind: 'verse', n: romanToInt(roman[1]), text: roman[2].trim() };
  return { kind: 'lyric', text };
}

/** Splits a cue in brackets off the start or end of a lyric line: "… CALL ME HAPPY. (REPEAT)" is a lyric line and a cue. */
function splitCues(line) {
  if (CUE_ONLY.test(line) || !CUE_IN_LINE.test(line)) return [line];
  CUE_IN_LINE.lastIndex = 0;
  const parts = [];
  let last = 0;
  for (const m of line.matchAll(CUE_IN_LINE)) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts.map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Flow cues

const kindOf = (label) => String(label ?? '').replace(/\s+\d+$/, '');
const CUE_SKIP = new Set(['AND', 'THEN', ',', 'ANG', 'THE', 'ONCE', 'AGAIN', 'MORE', 'SING', 'TO', 'BACK', 'FROM', 'NG', 'AT', 'UG', 'DAYON', 'PAGKATAPOS', 'WITH']);
const CUE_REPEAT = new Set(['REPEAT', 'ULITIN', 'ULIT', 'BALIK']);
const CUE_ALL = new Set(['ALL', 'LAHAT', 'TANAN']);
const CUE_CHORUS = new Set(['CHORUS', 'CHO', 'KORO', 'KORUS', 'REFRAIN', 'REF']);
const CUE_KIND = { BRIDGE: 'Bridge', CODA: 'Coda', TAG: 'Tag', END: 'Ending', ENDING: 'Ending', OUTRO: 'Ending', FADE: 'Ending' };
const CUE_VERSE = new Set(['V', 'VERSE', 'VERSES', 'BERSO']);
const CUE_NOOP = new Set(['INSTRUMENTAL', 'INSTUMENTAL', 'INSTRUMENT', 'MUSIC', 'INTERLUDE']);
const ROMAN_TOKEN = /^(I|II|III|IV|VI|VII|VIII|IX|X)$/;

/**
 * Reads one flow cue into the steps it adds to the arrangement. `labels` are the song's sections so far and `arrangement` the flow so far.
 *
 *   (REPEAT CHORUS 2X)                 → Chorus, Chorus
 *   (REPEAT 1 & 2 THEN CHORUS 2X)      → Verse 1, Verse 2, Chorus, Chorus
 *   (REPEAT V2 & V3)                   → Verse 2, Verse 3
 *   (REPEAT ALL THEN CHORUS)           → the flow so far (without a coda, ending or tag), then Chorus
 *   (REPEAT)                           → the step before it, again
 *   (2x)                               → the step before it, once more
 *
 * A multiplier counts the step just before it. Resolves to { steps, missing, unknown }: `missing` names sections the cue asks for that the
 * song does not have, and `unknown` the words it could not read.
 */
export function parseFlowDirective(text, { labels = [], arrangement = [] } = {}) {
  const has = new Set(labels);
  const tokens =
    String(text ?? '')
      .toUpperCase()
      .replace(/[()“”"]/g, ' ')
      .replace(/&/g, ' AND ')
      .replace(/\//g, ' THEN ')
      .replace(/[:;]/g, ' ')
      .match(/\d+\s*[X×](?![A-Z])|\d+(?:ST|ND|RD|TH)\b|[A-Z]+|\d+|,/g) ?? [];
  const groups = [];
  const missing = [];
  const unknown = [];
  let sawRepeat = false;
  let leadMult = 0;

  // A section the song does not have still takes its place, empty, so a multiplier after it counts nothing.
  const target = (label, wanted) => {
    if (label) groups.push([label]);
    else {
      missing.push(wanted);
      groups.push([]);
    }
  };
  const verse = (n) => target(has.has(`Verse ${n}`) ? `Verse ${n}` : null, `Verse ${n}`);
  const section = (kind, n) => {
    const exact = n ? `${kind} ${n}` : kind;
    target(has.has(exact) ? exact : !n ? labels.find((l) => kindOf(l) === kind) : null, exact);
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const mult = /^(\d+)\s*[X×]$/.exec(tok);
    if (mult) {
      const n = Number(mult[1]);
      if (groups.length) groups[groups.length - 1] = Array.from({ length: n }, () => groups[groups.length - 1]).flat();
      else leadMult = n;
      continue;
    }
    if (/^\d+(ST|ND|RD|TH)?$/.test(tok)) {
      verse(parseInt(tok, 10));
      continue;
    }
    if (ROMAN_TOKEN.test(tok)) {
      verse(romanToInt(tok));
      continue;
    }
    if (CUE_REPEAT.has(tok)) sawRepeat = true;
    else if (CUE_ALL.has(tok)) groups.push(arrangement.filter((l) => !CLOSING_KINDS.has(kindOf(l))));
    else if (CUE_CHORUS.has(tok)) {
      // Two names for it side by side ("REFRAIN CHORUS") are one chorus.
      while (CUE_CHORUS.has(tokens[i + 1])) i += 1;
      const next = tokens[i + 1];
      const n = next && (ROMAN_TOKEN.test(next) || /^\d+$/.test(next)) ? numberOf(next.toLowerCase()) : null;
      if (n && has.has(`Chorus ${n}`)) i += 1;
      section('Chorus', n && has.has(`Chorus ${n}`) ? n : null);
    } else if (CUE_KIND[tok]) section(CUE_KIND[tok], null);
    else if (!CUE_VERSE.has(tok) && !CUE_SKIP.has(tok) && !CUE_NOOP.has(tok)) unknown.push(tok);
  }

  const prev = arrangement[arrangement.length - 1];
  let steps = groups.flat();
  if (leadMult && prev) steps = [...Array(sawRepeat && !steps.length ? leadMult : leadMult - 1).fill(prev), ...steps];
  else if (!steps.length && sawRepeat && prev && !missing.length) steps = [prev];
  return { steps, missing, unknown };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Projector slides

const ENDS_SENTENCE = /[.!?…]["”’)\]]*$/;

/**
 * A line too long for the projector, wrapped into lines no longer than `maxChars` (unless one word is). The breaks are chosen together, not
 * one at a time: lines of about even length, a break at a full stop is best, at a comma fine, and between two words of a phrase worst, and
 * a last line of a word or two is avoided.
 */
export function breakLongLine(line, maxChars = LINE_MAX_CHARS) {
  const text = String(line ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text ? [text] : [];
  const words = text.split(' ');
  const target = text.length / Math.ceil(text.length / maxChars);
  const n = words.length;
  // starts[k]: where word k begins, so the length of words i..j-1 is starts[j] - starts[i] - 1.
  const starts = [0];
  for (const w of words) starts.push(starts[starts.length - 1] + w.length + 1);
  const best = Array(n + 1).fill(Infinity);
  const from = Array(n + 1).fill(0);
  best[0] = 0;
  for (let j = 1; j <= n; j += 1) {
    for (let i = j - 1; i >= 0; i -= 1) {
      const len = starts[j] - starts[i] - 1;
      if (len > maxChars && j - i > 1) break;
      const last = j === n;
      const short = Math.max(0, target - len) / target;
      const long = Math.max(0, len - target) / target;
      let cost = 4 + (last ? (len < maxChars * 0.3 ? 30 : 0) : short * short * 40 + long * long * 30);
      if (!last) cost += ENDS_SENTENCE.test(words[j - 1]) ? -20 : /[,;:]["”’)]*$/.test(words[j - 1]) ? 0 : 25;
      if (best[i] + cost < best[j]) {
        best[j] = best[i] + cost;
        from[j] = i;
      }
    }
  }
  const lines = [];
  for (let j = n; j > 0; j = from[j]) lines.unshift(words.slice(from[j], j).join(' '));
  return lines;
}

/**
 * A stanza's lines as projector slides of 2 to 4 lines. Long lines (a wall of text typed as one paragraph) are broken first; a slide ends at a
 * full stop where it can, and a last slide of one line is avoided by moving a line down from the slide before it.
 * Resolves to the slides, each its lines joined by "\n".
 */
export function chunkSlides(lines, { minLines = SLIDE_MIN_LINES, maxLines = SLIDE_MAX_LINES, maxChars = LINE_MAX_CHARS } = {}) {
  const all = (Array.isArray(lines) ? lines : String(lines ?? '').split('\n')).flatMap((l) => breakLongLine(l, maxChars));
  if (all.length <= maxLines) return all.length ? [all.join('\n')] : [];
  const slides = [];
  let cur = [];
  all.forEach((line, i) => {
    cur.push(line);
    const rest = all.length - i - 1;
    if (cur.length >= maxLines || (cur.length >= minLines && ENDS_SENTENCE.test(line) && rest >= minLines)) {
      slides.push(cur);
      cur = [];
    }
  });
  if (cur.length) {
    const before = slides[slides.length - 1];
    if (cur.length < minLines && before && before.length + cur.length <= maxLines) before.push(...cur);
    else if (cur.length < minLines && before && before.length > minLines) slides.push([before.pop(), ...cur]);
    else slides.push(cur);
  }
  return slides.map((s) => s.join('\n'));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Language

// God's names (Jesus, Lord, God) are sung in every language, so they are not counted for any of them.
const EN_WORDS = new Set(
  'the and you i my your is of to in me we for will all he his our be that with a it this are love praise who what when where can come let us there here so not no but just how like heart sing give'.split(' '),
);
const TL_WORDS = new Set(
  'ng mga ay at hindi natin tayo ating iyong kanyang ito lahat ngayon araw puso panginoon nang rin din naman kayo aming dahil kung bawat sila siya ikaw akin amin kami ka\'y ika\'y mo\'y ko\'y salamat purihin buhay pag-ibig mahal tanggapin kaya ulitin koro magpuri awit diyos hesus sumasa\'yo aking iyo kanya nating po'.split(' '),
);
const CEB_WORDS = new Set(
  'ug nga dili naa karon kanato nato atong akong imong iyang gyud mao diha kanimo nimo nako ning tanan adlaw gugma ginoo kalipay pagdayeg kamot tiil kay unsa ngano kanunay kasing-kasing mosayaw mokanta mo kami kamo usab pud lang ra didto dinhi niini kaniya ihalad dayegon daygon salig gikan'.split(' '),
);

/**
 * The language of a song's words: EN, TL (Tagalog) or CEB (Cebuano), by counting common words of each. Tagalog and Cebuano share many words
 * (ang, sa, ko), so only the words that tell them apart are counted. Resolves to { language, scores, mixed }, where `mixed` lists every
 * language with a real share of the words, so a song sung half in English and half in Tagalog shows both.
 */
export function detectLanguage(text) {
  const words = String(text ?? '').toLowerCase().replace(/’/g, "'").match(/[\p{L}][\p{L}'-]*/gu) ?? [];
  const scores = { EN: 0, TL: 0, CEB: 0 };
  for (const w of words) {
    if (EN_WORDS.has(w)) scores.EN += 1;
    if (TL_WORDS.has(w)) scores.TL += 1;
    if (CEB_WORDS.has(w)) scores.CEB += 1;
  }
  const total = scores.EN + scores.TL + scores.CEB;
  if (total === 0) return { language: 'EN', scores, mixed: [] };
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const language = ranked[0][0];
  const mixed = ranked.filter(([, s]) => s >= 3 && s / total >= 0.2).map(([l]) => l);
  return { language, scores, mixed: mixed.length > 1 ? mixed : [] };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Titles and songs

/** A title compared with another: lower case, with no punctuation or quotes, and single spaces. */
export function normalizeTitle(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A title as it sorts: quotes, brackets and stray punctuation at either end dropped, so '"This I Believe"' files under T. */
export function songSortKey(title) {
  return String(title ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * The songs A–Z by title: case-insensitive, numbers in natural order ("Psalm 2" before "Psalm 10"), leading punctuation ignored. A new
 * array; songs with the same title keep their order in the file.
 */
export function sortSongsAlphabetically(songs) {
  return [...(songs ?? [])].sort((a, b) =>
    songSortKey(a.title).localeCompare(songSortKey(b.title), undefined, { sensitivity: 'base', numeric: true }),
  );
}

const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const lineKey = (s) => normalizeTitle(String(s ?? '').replace(MULTIPLIER, ''));

/** The title a paragraph would give, or null when it cannot be a title (a section marker, a cue, a lyric too long, a repeat mark…). */
function titleCandidate(text) {
  const lines = normalizeSpacing(text).split('\n').filter(Boolean);
  if (lines.length !== 1) return null;
  const t = lines[0].replace(/\s*[:;,]\s*$/, '').trim();
  if (!t || classifyLine(t).kind !== 'lyric') return null;
  if (REPEAT_OPEN.test(t) || REPEAT_CLOSE.test(t)) return null;
  if (MULTIPLIER.exec(t)?.index > 0) return null;
  if (!/^[\p{L}\p{N}“"'‘(]/u.test(t)) return null;
  if (wordCount(t) > TITLE_MAX_WORDS || t.length > TITLE_MAX_CHARS) return null;
  return t;
}

/** A title with quotes around the whole of it taken off (“LIFE , HOPE” → LIFE, HOPE). A quoted part, as in AGNUS DEI “LAMB OF GOD”, stays. */
const cleanTitle = (t) => {
  let s = String(t ?? '').trim();
  if (/^[“"‘']/.test(s) && /[”"’']$/.test(s)) s = s.replace(/^[“"‘']+|[”"’']+$/g, '');
  return s.replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS);
};

/** How alike two texts are, from 0 to 1, by the edits it takes to turn one into the other. */
function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/**
 * Where each song starts. With `emphasis` the document marks its titles itself (a bold paragraph, or a Heading style), and only those count.
 * Without, a title is a short line on its own: after a blank line (or a line that ends a sentence) and followed by a section marker, a
 * numbered verse, a line that repeats the title's words, a long line, or a gap.
 */
function findTitles(paras, emphasis) {
  const isBlank = (p) => !normalizeSpacing(p.text);
  const starts = [];
  let seen = new Set();
  let currentTitle = '';
  paras.forEach((p, i) => {
    const cand = titleCandidate(p.text);
    const key = cand ? normalizeTitle(cand) : '';
    let isTitle = false;
    if (cand && emphasis) isTitle = p.bold || p.heading;
    else if (cand && !seen.has(key) && key !== normalizeTitle(currentTitle)) {
      let blanks = 0;
      for (let k = i - 1; k >= 0 && isBlank(paras[k]); k -= 1) blanks += 1;
      if (i === 0 || blanks === i) blanks = Infinity;
      const prevText = blanks === 0 ? normalizeSpacing(paras[i - 1].text) : '';
      const prevEnds = blanks === 0 && (ENDS_SENTENCE.test(prevText) || classifyLine(prevText).kind === 'cue');
      let j = i + 1;
      while (j < paras.length && isBlank(paras[j])) j += 1;
      const next = paras[j];
      if (next && !ENDS_SENTENCE.test(cand.replace(/[”"’')]+$/, '')) && !/[,;]$/.test(cand)) {
        const nextText = normalizeSpacing(next.text);
        const nextKind = classifyLine(nextText.split('\n')[0]).kind;
        const strongNext = nextKind === 'marker' || nextKind === 'verse';
        const echo = key.length >= 3 && lineKey(nextText).includes(key);
        const gap = j > i + 1;
        if (blanks >= 1 || prevEnds) {
          if (strongNext || echo) isTitle = true;
          else if (blanks >= 1 && (nextText.length > WALL_CHARS || nextText.includes('\n'))) isTitle = true;
          else if (blanks >= 2 && gap) isTitle = true;
        }
      }
    }
    if (isTitle) {
      starts.push(i);
      seen = new Set();
      currentTitle = cand;
    } else {
      for (const line of normalizeSpacing(p.text).split('\n')) if (line) seen.add(lineKey(line));
    }
  });
  return starts;
}

/** True when the document marks its song titles in bold or with a Heading style (and the bold is not on most of its text: a title with one paragraph of words under it is half bold). */
function usesEmphasisTitles(paras) {
  const filled = paras.filter((p) => normalizeSpacing(p.text));
  const marked = filled.filter((p) => (p.bold || p.heading) && titleCandidate(p.text));
  const bold = filled.filter((p) => p.bold);
  return marked.length > 0 && bold.length / Math.max(1, filled.length) <= 0.6;
}

let keyCounter = 0;
const newKey = (prefix) => `${prefix}${(keyCounter += 1)}`;

/**
 * One song's paragraphs taken apart into sections and the order they are sung in. Resolves to { sections, arrangement, warnings }, where each
 * section is { label, kind, lines, repeat } with `lines` as typed (repeat marks and a whole-stanza multiplier taken off and kept in
 * `repeat`) and `arrangement` lists section labels in sung order.
 */
export function parseSongBody(paras) {
  const tokens = [];
  const paraLength = new Map();
  let paraId = 0;
  for (const p of paras) {
    const text = normalizeSpacing(p.text);
    if (!text) {
      tokens.push({ kind: 'blank' });
      continue;
    }
    paraId += 1;
    paraLength.set(paraId, text.replace(/\n/g, ' ').length);
    for (const line of text.split('\n')) {
      for (const piece of splitCues(line)) tokens.push({ ...classifyLine(piece), para: paraId });
    }
  }

  const sections = [];
  const arrangement = [];
  const warnings = [];
  const explicitVerses = tokens.some((t) => t.kind === 'verse');
  const lastStructure = tokens.reduce((at, t, i) => (t.kind === 'marker' || t.kind === 'verse' ? i : at), -1);
  let cur = null;
  let afterCue = false;

  const verseNumbers = () => sections.filter((s) => s.kind === 'Verse').map((s) => Number(s.label.split(' ')[1]) || 0);
  const nextVerse = () => Math.max(0, ...verseNumbers()) + 1;
  const freeLabel = (kind, n) => {
    if (n && !sections.some((s) => s.label === `${kind} ${n}`)) return `${kind} ${n}`;
    if (!n && !sections.some((s) => s.label === kind)) return kind;
    if (kind === 'Verse') return `Verse ${nextVerse()}`;
    let k = 2;
    while (sections.some((s) => s.label === `${kind} ${k}`)) k += 1;
    return `${kind} ${k}`;
  };

  const open = (kind, n, at) => {
    cur = { kind, n, lines: [], paras: new Set(), lastPara: null, hasWall: false, at };
  };
  const add = (tok) => {
    const parsed = parseLyricLine(tok.text);
    if (!parsed.text && !parsed.open && !parsed.close) return;
    cur.lines.push(parsed);
    cur.paras.add(tok.para);
    cur.lastPara = tok.para;
    if ((paraLength.get(tok.para) ?? 0) > WALL_CHARS) cur.hasWall = true;
  };

  const commit = (block) => {
    const lines = block.lines.filter((l) => l.text);
    if (!lines.length) {
      // A marker with no words under it ("CHORUS:" on its own before a cue) points at the section of that kind already sung.
      const existing = block.kind !== 'auto' && sections.find((s) => kindOf(s.label) === (block.kind === 'Verse' ? 'Verse' : block.kind) && (!block.n || s.label.endsWith(` ${block.n}`)));
      if (existing) arrangement.push(existing.label);
      return;
    }
    let repeat = 1;
    const first = block.lines[0];
    const last = block.lines[block.lines.length - 1];
    if (first.open && last.close) {
      repeat = last.mult || 2;
      first.open = false;
      last.close = false;
      last.mult = 0;
    } else if (block.paras.size === 1 && last.mult && !lines.slice(0, -1).some((l) => l.mult)) {
      repeat = last.mult;
      last.mult = 0;
    }
    const shown = [];
    let inRepeat = false;
    for (const l of block.lines) {
      if (l.open) inRepeat = true;
      let text = l.text;
      if (l.close && inRepeat) {
        text = `${text} (${l.mult || 2}x)`;
        inRepeat = false;
      } else if (l.mult) text = `${text} (${l.mult}x)`;
      if (l.text) shown.push(text);
    }
    const key = shown.map(lineKey).join('|');
    // The same words again are the same section. A labelled section also matches one of its kind that differs only by a typo.
    const same =
      sections.find((s) => s.key === key) ??
      (block.kind !== 'auto' && block.kind !== 'Verse' ? sections.find((s) => s.kind === block.kind && similarity(s.key, key) >= 0.92) : undefined);
    if (same) {
      same.repeat = Math.max(same.repeat, repeat);
      arrangement.push(same.label);
      return;
    }
    let kind = block.kind;
    let n = block.n;
    if (kind === 'auto') {
      // A line or two left after the flow cues, with no section marker after them, is the song's tag; a full stanza is still a verse.
      const short = !block.hasWall && shown.length <= 2;
      kind = afterCue && short && block.at > lastStructure ? 'Tag' : 'Verse';
      n = kind === 'Verse' ? nextVerse() : null;
    }
    const label = freeLabel(kind, kind === 'Verse' ? n ?? nextVerse() : n);
    sections.push({ label, kind, lines: shown, repeat, key });
    arrangement.push(label);
  };

  const close = () => {
    if (cur) commit(cur);
    cur = null;
  };

  tokens.forEach((tok, i) => {
    if (tok.kind === 'blank') {
      // A marker with its words after a blank line ("CHORUS:", blank, words) stays open for them.
      if (cur && (cur.lines.length || cur.kind === 'auto')) close();
      return;
    }
    if (tok.kind === 'cue') {
      close();
      const labels = sections.map((s) => s.label);
      const { steps, missing, unknown } = parseFlowDirective(tok.text, { labels, arrangement });
      arrangement.push(...steps);
      if (missing.length) warnings.push(`${tok.text}: this song has no ${missing.join(', ')}.`);
      else if (!steps.length && unknown.length) warnings.push(`${tok.text}: not read as a flow cue.`);
      afterCue = true;
      return;
    }
    if (tok.kind === 'marker' || tok.kind === 'verse') {
      close();
      open(tok.kind === 'verse' ? 'Verse' : tok.section, tok.n, i);
      if (tok.text) add({ text: tok.text, para: tok.para });
      return;
    }
    // A lyric line.
    if (!cur) open('auto', null, i);
    else if (tok.para !== cur.lastPara && cur.lines.length) {
      // Each wall-of-text paragraph is a stanza of its own, while short lines typed as paragraphs stay together. A labelled section keeps
      // one wall and any short lines; in a song that numbers its verses, a paragraph with no label carries on the section above it.
      const wall = (paraLength.get(tok.para) ?? 0) > WALL_CHARS;
      const labelled = cur.kind !== 'auto';
      const continues = labelled && explicitVerses;
      const splits = labelled ? cur.hasWall && wall : cur.hasWall || wall;
      if (!continues && splits) {
        close();
        open('auto', null, i);
      }
    }
    add(tok);
  });
  close();

  return { sections: sections.map(({ key, ...s }) => s), arrangement, warnings };
}

/**
 * Takes a lineup document's paragraphs apart into songs.
 *
 * Options: `normalizeCase` ('preserve', the default, or 'sentence') sets the case of the titles and lines returned; `existing` is the
 * library's songs ({ id, title }) so a song already there is flagged.
 *
 * Resolves to { songs, allCaps, titleMode }, where `allCaps` says the document is typed in capitals and `titleMode` how titles were found
 * ('emphasis' from bold or heading paragraphs, 'text' from the shape of the lines). Each song is
 * { key, title, language, languages, sections, arrangement, warnings, duplicate: { inFile, existingId } }.
 */
export function parseLineup(paragraphs, { normalizeCase = 'preserve', existing = [] } = {}) {
  const paras = Array.isArray(paragraphs) ? paragraphs : [];
  const emphasis = usesEmphasisTitles(paras);
  const starts = findTitles(paras, emphasis);
  const pieces = [];
  if (!starts.length || starts[0] > 0) pieces.push({ title: '', body: paras.slice(0, starts[0] ?? paras.length) });
  starts.forEach((at, k) => pieces.push({ title: titleCandidate(paras[at].text) ?? '', body: paras.slice(at + 1, starts[k + 1] ?? paras.length) }));

  const songs = [];
  for (const piece of pieces) {
    const { sections, arrangement, warnings } = parseSongBody(piece.body);
    if (!sections.length) continue;
    const allText = sections.flatMap((s) => s.lines).join(' ');
    const lang = detectLanguage(allText);
    const rawTitle = cleanTitle(piece.title) || cleanTitle(sections[0].lines[0] ?? '');
    songs.push({
      key: newKey('d'),
      title: applyTitleCase(rawTitle, normalizeCase),
      language: lang.language,
      languages: lang.mixed,
      sections: sections.map((s) => ({ ...s, lines: s.lines.map((l) => applyCase(l, normalizeCase)) })),
      arrangement,
      warnings,
    });
    if (songs.length >= MAX_DOCX_SONGS) break;
  }
  const allCaps = isMostlyUpperCase(songs.flatMap((s) => s.sections.flatMap((x) => x.lines)));
  return { songs: flagDuplicates(songs, existing), allCaps, titleMode: emphasis ? 'emphasis' : 'text' };
}

/**
 * Marks each song that has the same title as a song before it in the file (`duplicate.inFile`, that song's key) or as a song already in the
 * library (`duplicate.existingId`). `existing` is the library's songs as { id, title }.
 */
export function flagDuplicates(songs, existing = []) {
  const library = new Map();
  for (const h of existing ?? []) {
    const k = normalizeTitle(h?.title);
    if (k && !library.has(k)) library.set(k, h.id);
  }
  const firstInFile = new Map();
  return songs.map((song) => {
    const k = normalizeTitle(song.title);
    const inFile = k && firstInFile.has(k) ? firstInFile.get(k) : null;
    if (k && !firstInFile.has(k)) firstInFile.set(k, song.key);
    return { ...song, duplicate: { inFile, existingId: library.get(k) ?? null } };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The slide deck: the review screen's slides preview is the one place a song's slide order is edited. A deck is a list of slide references,
// { id, label, chunk }: the section a slide comes from and which of that section's slides it is. The words are looked up only when the deck
// is shown or saved, so switching between sentence case and the original capitals never touches the operator's order.

/** Ids for slides added by hand (a section added, a slide duplicated). The arrangement's own slides are d0, d1, … so they stay put. */
let slideCounter = 0;
const newSlideId = () => `n${(slideCounter += 1)}`;

/** Each section's projector slides, cased as asked: label → [text, …]. */
function sectionChunks(song, { caseMode = 'preserve', ...limits } = {}) {
  const chunks = new Map();
  for (const s of song?.sections ?? []) {
    if (!chunks.has(s.label)) chunks.set(s.label, chunkSlides(s.lines.map((l) => applyCase(l, caseMode)), limits));
  }
  return chunks;
}

/** The deck the song's arrangement makes, as parsed from the file: every step in sung order, each section cut into slides. */
export function defaultDeck(song, options = {}) {
  const chunks = sectionChunks(song, options);
  const deck = [];
  for (const label of song?.arrangement ?? []) {
    const n = chunks.get(label)?.length ?? 0;
    for (let chunk = 0; chunk < n; chunk += 1) deck.push({ id: `d${deck.length}`, label, chunk });
  }
  return deck;
}

/** The deck a song is saved with: the operator's own when they have edited it, otherwise the one its arrangement makes. */
export function songDeck(song, options = {}) {
  return Array.isArray(song?.deck) ? song.deck : defaultDeck(song, options);
}

/** True when two decks show the same slides in the same order, with the same parts chosen (ids aside). */
export function sameDeck(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((s, i) => s.label === b[i].label && s.chunk === b[i].chunk && (s.part ?? null) === (b[i].part ?? null));
}

/**
 * `deck` with the slide at `index` given a part chosen on its card: a stored stanza type (Verse 1, Chorus, Bridge, Tag, Outro) or '' for a
 * continuation, which carries on the part of the slide before it. An index out of range gives back an unchanged copy.
 */
export function setDeckSlidePart(deck, index, part) {
  const list = [...(deck ?? [])];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;
  list[index] = { ...list[index], part: String(part ?? '') };
  return list;
}

/** `deck` with every slide of section `label` added at the end, each with a new id. Unknown sections add nothing. */
export function appendSection(deck, song, label, options = {}) {
  const n = sectionChunks(song, options).get(label)?.length ?? 0;
  return [...(deck ?? []), ...Array.from({ length: n }, (_, chunk) => ({ id: newSlideId(), label, chunk }))];
}

/** `deck` with a copy of the slide at `index` straight after it. An index out of range gives back an unchanged copy. */
export function duplicateSlide(deck, index) {
  const list = [...(deck ?? [])];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;
  list.splice(index + 1, 0, { ...list[index], id: newSlideId() });
  return list;
}

/** `deck` without the slide at `index`. The last slide is kept, and an index out of range gives back an unchanged copy. */
export function removeSlide(deck, index) {
  const list = [...(deck ?? [])];
  if (list.length <= 1 || !Number.isInteger(index) || index < 0 || index >= list.length) return list;
  list.splice(index, 1);
  return list;
}

/**
 * `slides` with the one at `fromIndex` moved so it ends up at `toIndex`, as a new array. A drop that leaves it where it is, or an index out
 * of range, gives back an unchanged copy. Works on any list: the review screen moves deck entries with it.
 */
export function reorderPreviewSlides(slides, fromIndex, toIndex) {
  const list = [...(slides ?? [])];
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || fromIndex >= list.length || fromIndex === toIndex) return list;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, moved);
  return list;
}

/**
 * The deck's slides with their words: [{ id, label, chunk, part?, type, text, continuation }], `type` being the stanza type the hymn library
 * stores. A slide is a continuation when its card says so (part ''), or, with no part chosen, when it is the next slide of the same section
 * straight after the one before: it carries on that slide's type. A part chosen on the card is the slide's type. The first slide is never a
 * continuation. A reference to a section or slide the song no longer has is left out.
 */
export function deckSlides(song, deck, options = {}) {
  const chunks = sectionChunks(song, options);
  const labels = [...chunks.keys()];
  const slides = [];
  for (const ref of deck ?? []) {
    const text = chunks.get(ref?.label)?.[ref.chunk];
    if (text == null) continue;
    const prev = slides[slides.length - 1];
    const part = typeof ref.part === 'string' ? ref.part : null;
    const continuation =
      prev != null && (part === '' || (part == null && ref.chunk > 0 && prev.label === ref.label && prev.chunk === ref.chunk - 1));
    const type = continuation ? prev.type : part || storedStanzaType(ref.label, labels);
    slides.push({ id: ref.id, label: ref.label, chunk: ref.chunk, ...(part != null ? { part } : {}), type, text, continuation });
  }
  return slides;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Saving

/**
 * The hymn library's stanza type for a section label. The library keeps Verse, Chorus, Bridge, Tag and Outro, so a Coda and an Ending are
 * saved as Outro (the Ending as Outro 2 when the song has a Coda too).
 */
export function storedStanzaType(label, labels = []) {
  const kind = kindOf(label);
  const n = /\s(\d+)$/.exec(label)?.[1];
  if (kind === 'Verse') return `Verse ${n ?? 1}`;
  if (kind === 'Coda') return n ? `Outro ${n}` : 'Outro';
  if (kind === 'Ending') {
    const codas = new Set(labels.filter((l) => kindOf(l) === 'Coda')).size;
    const k = (n ? Number(n) : 1) + codas;
    return k > 1 ? `Outro ${k}` : 'Outro';
  }
  return label;
}

/**
 * The slides a song is saved with, in deck order: the operator's deck when they have edited it, otherwise every step of its arrangement,
 * each section broken into projector slides. Options: `caseMode` ('preserve' or 'sentence'), and the slide limits `minLines`, `maxLines`
 * and `maxChars`. Resolves to [{ id, label, chunk, type, text }].
 */
export function songSlides(song, options = {}) {
  return deckSlides(song, songDeck(song, options), options);
}

/** A song as the tagged lyrics the hymn library saves ([V1], [C], …), one tag per slide, in sung order. */
export function songToTaggedLyrics(song, options = {}) {
  return toTaggedLyrics(songSlides(song, options).map((s) => ({ stanzaType: s.type, lyricsText: s.text })));
}

/**
 * What stops a song being imported as it is: { level: 'error' | 'warning', code }. Errors: no title, no slides, more slides than a hymn can
 * hold. Warnings: cues that could not be read, and a song already in the library or earlier in the file.
 */
export function docxSongIssues(song, options = {}) {
  const issues = [];
  const slides = songSlides(song, options);
  if (!String(song?.title ?? '').trim()) issues.push({ level: 'error', code: 'noTitle' });
  if (slides.length === 0) issues.push({ level: 'error', code: 'noSlides' });
  if (slides.length > MAX_STANZAS) issues.push({ level: 'error', code: 'tooManySlides' });
  if (song?.duplicate?.existingId != null) issues.push({ level: 'warning', code: 'inLibrary' });
  if (song?.duplicate?.inFile != null) issues.push({ level: 'warning', code: 'inFile' });
  if (song?.warnings?.length) issues.push({ level: 'warning', code: 'cues' });
  return issues;
}
