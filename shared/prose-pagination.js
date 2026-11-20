// Prose pagination rules shared by the prayer, reading and scripture splitters: where a slide may break, how the last two slides are evened
// out, and when a tiny trailing slide is folded back into the one before it. Every rule works on whole words: text is only ever cut at
// whitespace, so a word is never carried half onto the next slide. Pure, so the tests run it under Node.

/** A no-break space: binds a verse number to its first word, so the number never ends a slide or a line on its own. */
export const NBSP = ' ';

/**
 * A trailing slide this small is a stub: fewer than `maxChars` characters, or at most `maxWords` words. It is merged into the slide before it
 * when the two together stay within `mergedMaxChars`.
 */
export const PROSE_STUB = Object.freeze({ maxChars: 35, maxWords: 4, mergedMaxChars: 310 });

/** Characters on a slide, line breaks not counted. */
export const proseChars = (text) => String(text).replace(/\n/g, '').length;

/** A scripture line: its verse number bound to its first word with a no-break space. */
export function verseLine(number, text) {
  return `${number}${NBSP}${String(text ?? '').trim()}`;
}

/** A line that starts with a verse number ("12 Word", "12a Word") gets its number bound to the first word. Other lines are unchanged. */
export function bindVerseNumber(line) {
  return String(line).replace(/^(\d{1,3}[a-z]?) +(?=\S)/, `$1${NBSP}`);
}

/** Whether a slide's text is a stub (see PROSE_STUB). */
export function isStub(text, limits = PROSE_STUB) {
  const t = String(text).trim();
  if (!t) return true;
  return t.length < limits.maxChars || t.split(/\s+/).filter(Boolean).length <= limits.maxWords;
}

/** Splits at sentence ends (. ? ! ; : and an ellipsis, with any closing quote or bracket) followed by whitespace. The text is not changed. */
export function proseSentences(line) {
  return String(line)
    .split(/(?<=[.!?;:…]["'”’)\]]*)\s+/)
    .filter(Boolean);
}

/** Splits at clause marks (, — –) followed by whitespace. */
export function proseClauses(sentence) {
  return String(sentence)
    .split(/(?<=[,—–])\s+/)
    .filter(Boolean);
}

/**
 * The units a section of prose is packed from, each `{ text, joiner }` (`joiner` joins it to the unit before: a line break or a space). A line
 * that fits a slide is one unit. A longer line is cut at sentence ends; a sentence still too long at its clauses; a clause still too long into
 * single words. Blank lines are kept as empty units, so paragraph spacing survives.
 */
export function proseUnits(section, fits) {
  const units = [];
  for (const line of String(section).split('\n')) {
    if (!line.trim() || fits(line)) {
      units.push({ text: line, joiner: '\n' });
      continue;
    }
    const pieces = proseSentences(line.trim()).flatMap((sentence) =>
      fits(sentence) ? [sentence] : proseClauses(sentence).flatMap((clause) => (fits(clause) ? [clause] : clause.split(/ +/).filter(Boolean))),
    );
    pieces.forEach((text, i) => units.push({ text, joiner: i === 0 ? '\n' : ' ' }));
  }
  return units;
}

const joinUnits = (units) => units.reduce((acc, u, k) => acc + (k === 0 ? '' : u.joiner) + u.text, '');

/** A page without blank lines at its top or bottom. */
const trimBlankEdges = (text) => text.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');

/**
 * Units packed into pages: each page is filled while it fits, then the last two pages are evened out (units move from the page before into
 * the last page while the last stays no longer than it and still fits), so a passage does not end on a sliver. A unit too big for a page on its
 * own still gets a page, so nothing is lost. Returns the pages' texts.
 */
export function packProse(units, fits) {
  const ranges = [];
  let start = 0;
  for (let end = 1; end <= units.length; end += 1) {
    if (end - start > 1 && !fits(joinUnits(units.slice(start, end)))) {
      ranges.push([start, end - 1]);
      start = end - 1;
    }
  }
  if (start < units.length) ranges.push([start, units.length]);

  while (ranges.length >= 2) {
    const before = ranges[ranges.length - 2];
    const last = ranges[ranges.length - 1];
    if (before[1] - before[0] < 2) break;
    const keep = trimBlankEdges(joinUnits(units.slice(before[0], before[1] - 1)));
    const grown = trimBlankEdges(joinUnits(units.slice(before[1] - 1, last[1])));
    if (proseChars(grown) > proseChars(keep) || !fits(grown)) break;
    before[1] -= 1;
    last[0] -= 1;
  }
  return ranges.map(([a, b]) => trimBlankEdges(joinUnits(units.slice(a, b)))).filter((page) => page.trim());
}

/** The whitespace that stood between two pages in the source text: a blank line, a line break or a space. */
function gapBetween(before, after, source) {
  if (source != null) {
    const src = String(source);
    const at = src.lastIndexOf(after.trimStart());
    if (at > 0) {
      const gap = /\s*$/.exec(src.slice(0, at))[0];
      if (gap.includes('\n\n')) return '\n\n';
      if (gap.includes('\n')) return '\n';
      if (gap) return ' ';
    }
  }
  // Without the source: a verse or a new sentence starts its own line, anything else continues the line.
  return /^\d/.test(after) || /[.!?;:…]["'”’)\]]*$/.test(before) ? '\n' : ' ';
}

/**
 * A trailing stub (see PROSE_STUB) folded into the page before it, when the two together stay within `mergedMaxChars` and, when `fits` is
 * given, still fit. The words are joined with the whitespace they had in `source`, when given. Other pages are returned as they were.
 */
export function mergeTrailingStub(pages, { source, fits, limits = PROSE_STUB } = {}) {
  if (pages.length < 2) return pages;
  const before = pages[pages.length - 2];
  const last = pages[pages.length - 1];
  if (!isStub(last, limits)) return pages;
  const merged = `${before}${gapBetween(before, last, source)}${last}`;
  if (proseChars(merged) > limits.mergedMaxChars) return pages;
  if (fits && !fits(merged)) return pages;
  return [...pages.slice(0, -2), merged];
}

/** One section of prose as pages: packed at sentence and word boundaries, the tail evened out, and a trailing stub merged. */
export function paginateProse(section, fits, { mergeStub = true } = {}) {
  const pages = packProse(proseUnits(section, fits), fits);
  return mergeStub ? mergeTrailingStub(pages, { source: section }) : pages;
}
