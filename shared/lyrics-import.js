// Pure helpers for importing lyrics from a file or a pasted song sheet. No Electron or DOM imports, so the main process,
// the PDF renderer, the Create Hymn form and the tests can all use them.
import { sectionHeader } from './lyrics-parser.js';

// A vertical gap wider than this many line steps is a blank line between verses.
const BLANK_LINE_RATIO = 1.6;
// Items closer than this in y are on the same line.
const SAME_LINE_TOLERANCE = 0.5;
// With no section headers, a single-line first block is a title only up to this length.
const SHORT_TITLE_LENGTH = 80;
// Before the first section header, the one line above it is the title only up to this length.
const SHEET_TITLE_LENGTH = 120;

// Lines from a lyrics website that describe the song rather than sing it. Matched at the start of the line.
const METADATA = /^\s*(official lyrics|words and music by|words by|music by|lyrics by|arr\.?|arranged by|copyright|©|tune:|translation)/i;

/**
 * Builds lyric text from pdf.js text items, in the order pdf.js gives them. A new line starts where the y position moves
 * or where pdf.js marks the end of a line. A vertical gap wider than BLANK_LINE_RATIO times the smallest line step
 * becomes a blank line, so verses stay apart.
 */
export function lyricTextFromItems(items) {
  const lines = [];
  let current = null;

  for (const item of items ?? []) {
    if (!item || typeof item.str !== 'string') continue;
    const y = Number(item.transform?.[5] ?? 0);
    if (!current || Math.abs(y - current.y) > SAME_LINE_TOLERANCE) {
      current = { y, text: '' };
      lines.push(current);
    }
    current.text += `${item.str} `;
    if (item.hasEOL) current = null;
  }

  const cleaned = lines.map((line) => ({ y: line.y, text: line.text.replace(/\s+/g, ' ').trim() })).filter((line) => line.text);

  // The smallest positive step between consecutive lines is one line of text; anything wider is a gap.
  const steps = cleaned.slice(1).map((line, i) => cleaned[i].y - line.y).filter((step) => step > SAME_LINE_TOLERANCE);
  const lineStep = steps.length > 0 ? Math.min(...steps) : 0;

  const out = [];
  cleaned.forEach((line, i) => {
    if (i > 0 && lineStep > 0 && cleaned[i - 1].y - line.y > lineStep * BLANK_LINE_RATIO) out.push('');
    out.push(line.text);
  });
  return cleanLyricText(out.join('\n'));
}

/** Normalises line endings, removes trailing spaces, and collapses runs of blank lines to one. */
export function cleanLyricText(raw) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True for a line that describes the song (credits, copyright, tune), not a line to sing. */
export function isMetadataLine(line) {
  return METADATA.test(String(line ?? ''));
}

/**
 * Takes a pasted song sheet apart: the credit lines are dropped, and the title is found. With section headers, the title
 * is the one non-blank line above the first header (up to 120 characters). Without headers, the first block is the title
 * when it is a single short line followed by a blank line. Returns { title, raw }, with title '' when there is none.
 */
export function splitSongSheet(raw) {
  const lines = cleanLyricText(raw)
    .split('\n')
    .filter((line) => !isMetadataLine(line));
  const firstHeader = lines.findIndex((line) => sectionHeader(line));
  if (firstHeader < 0) return splitUntitled(lines);

  const before = lines.slice(0, firstHeader).filter((line) => line.trim());
  const titled = before.length === 1 && before[0].trim().length <= SHEET_TITLE_LENGTH;
  const body = titled ? lines.slice(firstHeader) : lines;
  return { title: titled ? before[0].trim() : '', raw: cleanLyricText(body.join('\n')) };
}

/** A sheet with no section headers: a single short first line followed by a blank line is the title. */
function splitUntitled(lines) {
  const text = cleanLyricText(lines.join('\n'));
  if (!text) return { title: '', raw: '' };
  const blocks = text.split(/\n\n+/);
  const first = blocks[0].split('\n');
  const rest = blocks.slice(1).join('\n\n').trim();
  if (first.length === 1 && first[0].trim().length <= SHORT_TITLE_LENGTH && rest) return { title: first[0].trim(), raw: rest };
  return { title: '', raw: text };
}
