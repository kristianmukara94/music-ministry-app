// The Text Boundary Optimizer: raw prayers, readings and pasted lyrics cut into slides that fit the screen, with a blank line (\n\n) between
// slides. It is rule-based and runs offline: the text is measured in characters and wrapped lines, never in a window, so every caller (the
// custom note box, the stanza editors, the Holy Mass pre-air check) gets the same slides. Pure, so the tests run it under Node.
//
// How a slide is cut:
//   - the operator's own blank lines are kept: a block that already fits is left exactly as it was;
//   - a block that does not fit is cut into pieces: its lines, and a line too long for one slide into sentences, then clauses, then runs of
//     words about one screen line long;
//   - the pieces are packed into the fewest slides that fit, and among those the cuts that fall on the strongest pause (a full stop, then a
//     semicolon or colon, then a comma or line end) with the slides kept about the same size, so a prayer is never left with one stray line.

import { SPLIT_LIMITS } from '../../shared/projector-autofit.js';

export interface OptimizationResult {
  formattedText: string;
  slideCount: number;
  slides: string[];
  wasModified: boolean;
}

export interface OptimizerOptions {
  /** Default: 4 lines */
  maxLinesPerSlide?: number;
  /** Default: 45 characters */
  maxCharsPerLine?: number;
  /** Default: 180 characters */
  maxCharsPerSlide?: number;
}

/** The slide the operator formats for: four short lines, easy to read from the back of the church. */
export const DEFAULT_LIMITS: Required<OptimizerOptions> = Object.freeze({ maxLinesPerSlide: 4, maxCharsPerLine: 45, maxCharsPerSlide: 180 });

/**
 * What a slide on air may hold before the projector has to shrink it past reading size and cut it off: the projector's own split budget (see
 * SPLIT_LIMITS), with lines about as wide as the text box holds at that size. The pre-air check uses these, so it only warns about a slide
 * that would really be cut off, not every stanza longer than four lines.
 */
export const ON_AIR_LIMITS: Required<OptimizerOptions> = Object.freeze({ maxLinesPerSlide: SPLIT_LIMITS.maxLines, maxCharsPerLine: SPLIT_LIMITS.charsPerLine, maxCharsPerSlide: SPLIT_LIMITS.maxChars });

/** Short words that end in a full stop without ending the sentence: titles, saints, and the books of the Bible as readings cite them. */
const ABBREVIATIONS = new Set(
  ['st', 'sts', 'sto', 'sta', 'fr', 'frs', 'msgr', 'rev', 'bro', 'sr', 'mr', 'mrs', 'ms', 'dr', 'jr', 'vs', 'cf', 'etc', 'vol', 'vv', 'gen', 'ex', 'lev', 'deut', 'isa', 'jer', 'ez', 'mt', 'mk', 'lk', 'jn', 'rom', 'cor', 'gal', 'eph', 'phil', 'thess', 'tim', 'heb', 'jas', 'pet', 'ps', 'prov', 'wis'],
);

/** How strong a pause the end of a piece is, which says how good a place it is to start a new slide. */
const Pause = { None: 0, Comma: 1, LineEnd: 2, Clause: 3, Sentence: 4 } as const;
type Pause = (typeof Pause)[keyof typeof Pause];

/** What a cut costs after each kind of pause. A cut mid-clause is a last resort; a cut after a full stop is free. */
const CUT_COST: Record<Pause, number> = { [Pause.None]: 400, [Pause.Comma]: 60, [Pause.LineEnd]: 40, [Pause.Clause]: 20, [Pause.Sentence]: 0 };
/** What each slide costs: more than any cut, so the fewest slides always win and the cuts are chosen among them. */
const SLIDE_COST = 10_000;

interface Piece {
  text: string;
  /** How the piece joins the one before it on the same slide: a new line (it began a line of its own) or a space (it continues a line). */
  joiner: '\n' | ' ';
  pause: Pause;
}

const limitsOf = (options?: OptimizerOptions): Required<OptimizerOptions> => {
  const pick = (value: number | undefined, fallback: number) => (Number.isFinite(value) && (value as number) >= 1 ? Math.floor(value as number) : fallback);
  return {
    maxLinesPerSlide: pick(options?.maxLinesPerSlide, DEFAULT_LIMITS.maxLinesPerSlide),
    maxCharsPerLine: pick(options?.maxCharsPerLine, DEFAULT_LIMITS.maxCharsPerLine),
    maxCharsPerSlide: pick(options?.maxCharsPerSlide, DEFAULT_LIMITS.maxCharsPerSlide),
  };
};

/** The text tidied: Windows line ends, tabs and runs of spaces made plain, spaces at line ends dropped, and three or more newlines made one break. */
export function normalizeText(raw: string): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** How many screen lines one line of text takes when the projector wraps it between words at `width` characters. */
export function wrappedLineCount(line: string, width: number): number {
  const words = line.split(' ').filter(Boolean);
  if (words.length === 0) return 1;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (used === 0) {
      // A word wider than the screen runs over as many lines as it needs.
      lines += Math.ceil(word.length / width) - 1;
      used = word.length % width || width;
    } else if (used + 1 + word.length <= width) {
      used += 1 + word.length;
    } else {
      lines += Math.ceil(word.length / width);
      used = word.length % width || width;
    }
  }
  return lines;
}

/** The size of a slide's text: its screen lines once wrapped, and its characters (line breaks not counted). */
export function measureSlide(text: string, options?: OptimizerOptions): { lines: number; chars: number } {
  const { maxCharsPerLine } = limitsOf(options);
  const rows = text.split('\n');
  return {
    lines: rows.reduce((n, row) => n + wrappedLineCount(row, maxCharsPerLine), 0),
    chars: rows.reduce((n, row) => n + row.length, 0),
  };
}

/** Whether a slide's text fits within the limits. */
export function slideFits(text: string, options?: OptimizerOptions): boolean {
  const limits = limitsOf(options);
  const { lines, chars } = measureSlide(text, limits);
  return lines <= limits.maxLinesPerSlide && chars <= limits.maxCharsPerSlide;
}

/** The pause at the end of a piece. The end of a line is at least a line-end pause: a lyric's line breaks are where it is sung in breaths. */
const pauseAfter = (text: string, lineEnd: boolean): Pause => {
  const end = text.replace(/["'”’)\]]+$/, '');
  const mark = /[.!?…]$/.test(end) ? Pause.Sentence : /[;:]$/.test(end) ? Pause.Clause : /[,—–-]$/.test(end) ? Pause.Comma : Pause.None;
  return lineEnd ? (Math.max(mark, Pause.LineEnd) as Pause) : mark;
};

/** A line cut into sentences. A full stop after a title or a book of the Bible ("St.", "Jn.") or an initial ("John F.") does not end a sentence. */
export function sentencesOf(line: string): string[] {
  const parts = line.split(/(?<=[.!?…]["'”’)\]]*)\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])/u);
  const out: string[] = [];
  for (const part of parts) {
    const before = out[out.length - 1];
    const lastWord = before?.split(' ').pop()?.replace(/\.$/, '') ?? '';
    // "I." and "O." are words, not initials: "so do I." ends a sentence.
    const initial = /^\p{Lu}$/u.test(lastWord) && lastWord !== 'I' && lastWord !== 'O';
    if (before !== undefined && (ABBREVIATIONS.has(lastWord.toLowerCase()) || initial)) out[out.length - 1] = `${before} ${part}`;
    else out.push(part);
  }
  return out;
}

/** Words packed into runs of about one screen line each, for a clause too long for one slide. */
function wordRuns(clause: string, width: number): string[] {
  const runs: string[] = [];
  let current = '';
  for (const word of clause.split(' ').filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width || !current) current = next;
    else {
      runs.push(current);
      current = word;
    }
  }
  if (current) runs.push(current);
  return runs;
}

/** One line as pieces small enough to pack: the whole line when it fits a slide, otherwise its sentences, clauses and runs of words. */
function piecesOfLine(line: string, limits: Required<OptimizerOptions>): Piece[] {
  if (slideFits(line, limits)) return [{ text: line, joiner: '\n', pause: pauseAfter(line, true) }];
  const small = sentencesOf(line).flatMap((sentence) => {
    if (slideFits(sentence, limits)) return [sentence];
    return sentence.split(/(?<=[,;:—–])\s+/).flatMap((clause) => (slideFits(clause, limits) ? [clause] : wordRuns(clause, limits.maxCharsPerLine)));
  });
  return small.map((text, i) => ({ text, joiner: i === 0 ? '\n' : ' ', pause: pauseAfter(text, i === small.length - 1) }));
}

const joinPieces = (pieces: Piece[]) => pieces.map((p, i) => (i === 0 ? p.text : `${p.joiner}${p.text}`)).join('');

/**
 * The pieces packed into slides. Of every way to cut them that fits, the one chosen has the fewest slides, then the cheapest cuts and the most
 * even slides. A piece too big for a slide on its own (one enormous word) still gets a slide, so nothing is ever lost.
 */
function packPieces(pieces: Piece[], limits: Required<OptimizerOptions>): string[] {
  const n = pieces.length;
  const best: number[] = [0, ...Array<number>(n).fill(Infinity)];
  const from: number[] = Array<number>(n + 1).fill(0);
  for (let end = 1; end <= n; end += 1) {
    for (let start = end - 1; start >= 0; start -= 1) {
      const text = joinPieces(pieces.slice(start, end));
      const fits = slideFits(text, limits);
      if (!fits && end - start > 1) break;
      const { lines, chars } = measureSlide(text, limits);
      const fill = Math.min(1, Math.max(lines / limits.maxLinesPerSlide, chars / limits.maxCharsPerSlide));
      const slack = (1 - fill) * 10;
      const cut = end < n ? CUT_COST[pieces[end - 1].pause] : 0;
      const cost = best[start] + SLIDE_COST + cut + slack * slack;
      if (cost < best[end]) {
        best[end] = cost;
        from[end] = start;
      }
    }
  }
  const slides: string[] = [];
  for (let end = n; end > 0; end = from[end]) slides.unshift(joinPieces(pieces.slice(from[end], end)));
  return slides;
}

/** One block (the text between two blank lines) as slides: as it was when it fits, otherwise cut where it reads best. */
function splitBlock(block: string, limits: Required<OptimizerOptions>): string[] {
  if (slideFits(block, limits)) return [block];
  return packPieces(
    block.split('\n').flatMap((line) => piecesOfLine(line, limits)),
    limits,
  );
}

/**
 * Raw text cut into slides that fit, with a blank line between slides. The operator's own blank lines stay where they are; a block too long for
 * one slide is cut at the best pauses. `wasModified` is true when the text that comes back differs from the text given, and false when it was
 * already set out in slides that fit.
 */
export function autoSplitText(rawText: string, options?: OptimizerOptions): OptimizationResult {
  const limits = limitsOf(options);
  const blocks = normalizeText(rawText).split('\n\n').filter(Boolean);
  const slides = blocks.flatMap((block) => splitBlock(block, limits));
  const formattedText = slides.join('\n\n');
  return { formattedText, slideCount: slides.length, slides, wasModified: formattedText !== String(rawText ?? '') };
}

/** Whether any slide of the text (its blocks between blank lines) is over the limits, so cutting it would help. */
export function needsSplit(text: string, options?: OptimizerOptions): boolean {
  const limits = limitsOf(options);
  return normalizeText(text)
    .split('\n\n')
    .some((block) => block && !slideFits(block, limits));
}

/**
 * One song stanza as the stanzas Smart Break makes of it, or null when it already fits one slide and there is nothing to cut. The words of each
 * part are kept line for line; only where the slides break is chosen.
 */
export function smartBreakParts(stanza: string, options?: OptimizerOptions): string[] | null {
  const { slides } = autoSplitText(stanza, options);
  return slides.length > 1 ? slides : null;
}
