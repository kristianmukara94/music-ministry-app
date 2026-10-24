// Prayer text splitting for the rosary deck and its editor. Pure: no DOM, no database, so the same rules
// run in the deck, the Settings preview and the tests.

/** One projected slide of a prayer. `partIndex` is 1-based, so it reads as "Part 1 of 3". */
export interface PrayerSlideChunk {
  partIndex: number;
  totalParts: number;
  text: string;
}

export interface ChunkOptions {
  /** Most lines on one slide. Null is Auto: the character limit alone decides where a slide ends. */
  maxLines: number | null;
  /** Off means only the explicit breaks (blank lines, `---`, `[SLIDE]`) split the text. */
  autoSplit: boolean;
}

/** The character limit for one slide. Long enough for a sentence group, short enough to read from the back of a church. */
export const CHUNK_MAX_CHARS = 200;
export const MAX_LINES_CHOICES: (number | null)[] = [3, 4, 5, 6, null];

export const CHUNK_OPTION_DEFAULTS: ChunkOptions = { maxLines: 4, autoSplit: true };

const CHUNK_KEY = 'apccmma.rosary.chunks';

/** A blank line, a `---` line or a `[SLIDE]` line ends a slide. */
const EXPLICIT_BREAK = /\n[ \t]*\n|^[ \t]*(?:---|\[SLIDE\])[ \t]*$/m;

/**
 * Splits a long line at the sentence punctuation (`.`, `;`, `!`, `?`) nearest to the limit. With no punctuation,
 * it splits at the last space. The text is only cut in a last resort, when it has neither.
 */
function splitLongLine(line: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = line.trim();
  while (rest.length > max) {
    let cut = -1;
    for (let i = max; i >= 1; i--) {
      if (/[.;!?]/.test(rest[i - 1]) && (i === rest.length || /\s/.test(rest[i]))) {
        cut = i;
        break;
      }
    }
    if (cut <= 0) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Packs one explicit block into slides, by line count and character count. */
function packBlock(block: string, options: ChunkOptions): string[] {
  const units = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => splitLongLine(line, CHUNK_MAX_CHARS));
  if (!options.autoSplit) return [units.join('\n')];

  const slides: string[] = [];
  let current: string[] = [];
  for (const unit of units) {
    const candidate = [...current, unit];
    const tooManyLines = options.maxLines !== null && candidate.length > options.maxLines;
    const tooLong = candidate.join('\n').length > CHUNK_MAX_CHARS;
    if (current.length > 0 && (tooManyLines || tooLong)) {
      slides.push(current.join('\n'));
      current = [unit];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) slides.push(current.join('\n'));
  return slides;
}

/**
 * Splits prayer text into the slides it is projected on. Explicit breaks always apply. With auto-split on, each
 * slide is also held to the line limit and to CHUNK_MAX_CHARS characters.
 */
export function splitPrayerText(text: string, options: ChunkOptions = CHUNK_OPTION_DEFAULTS): PrayerSlideChunk[] {
  const blocks = text.replace(/\r\n?/g, '\n').split(EXPLICIT_BREAK).map((b) => b.trim()).filter(Boolean);
  const slides = blocks.flatMap((block) => packBlock(block, options));
  return slides.map((slide, i) => ({ partIndex: i + 1, totalParts: slides.length, text: slide }));
}

/** Reads the saved options. Anything unreadable, or a value outside the choices, falls back to the defaults. */
export function loadChunkOptions(): ChunkOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(CHUNK_KEY) ?? 'null') as Partial<ChunkOptions> | null;
    if (!raw || typeof raw !== 'object') return CHUNK_OPTION_DEFAULTS;
    const maxLines = MAX_LINES_CHOICES.includes(raw.maxLines as number | null) ? (raw.maxLines as number | null) : CHUNK_OPTION_DEFAULTS.maxLines;
    const autoSplit = typeof raw.autoSplit === 'boolean' ? raw.autoSplit : CHUNK_OPTION_DEFAULTS.autoSplit;
    return { maxLines, autoSplit };
  } catch {
    return CHUNK_OPTION_DEFAULTS;
  }
}

/** Saves the options on this machine. A failed write keeps the choice for this session only. */
export function saveChunkOptions(options: ChunkOptions) {
  try {
    localStorage.setItem(CHUNK_KEY, JSON.stringify(options));
  } catch {
    /* storage unavailable: the options still apply for this session */
  }
}
