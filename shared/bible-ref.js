// Bible passage references, shared by the main process (plan validation) and the renderer.
//
// A plan item stores a passage as one source id: `TRANSLATION|Book name|chapter|verses`,
// for example `WEB|John|3|16-17`. The verse part is one verse (`16`) or an inclusive range (`16-17`).
// Book names are the translation's own names, so the translation is part of the id.

export const BIBLE_TRANSLATION_IDS = ['WEB', 'TGL', 'CEB'];

const RANGE = /^(\d+)(?:-(\d+))?$/;

/** Builds a source id. `verses` is a range string such as "16" or "16-17". */
export function formatSourceId(translationId, bookName, chapter, verses) {
  return `${translationId}|${bookName}|${chapter}|${verses}`;
}

/** Splits a source id. Returns null when the id is not a valid passage. */
export function parseSourceId(sourceId) {
  const parts = String(sourceId ?? '').split('|');
  if (parts.length !== 4) return null;
  const [translationId, bookName, chapterText, verses] = parts;
  const range = RANGE.exec(verses);
  const chapter = Number(chapterText);
  if (!BIBLE_TRANSLATION_IDS.includes(translationId) || !bookName.trim()) return null;
  if (!/^\d+$/.test(chapterText) || chapter < 1 || !range) return null;
  const from = Number(range[1]);
  const to = range[2] === undefined ? from : Number(range[2]);
  if (from < 1 || to < from) return null;
  return { translationId, bookName, chapter, from, to };
}

/**
 * Reads a typed reference such as "John 3:16-18" or "1 Corinthians 13:4". The book name is
 * everything before the chapter, so names that start with a number still parse.
 * Returns null when the text is not a reference.
 */
export function parsePassageInput(text) {
  const match = /^(.*?)\s*(\d+)\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(String(text ?? '').trim());
  if (!match || !match[1].trim()) return null;
  const from = Number(match[3]);
  const to = match[4] === undefined ? from : Number(match[4]);
  if (from < 1 || to < from) return null;
  return { bookName: match[1].trim(), chapter: Number(match[2]), from, to };
}

/**
 * Common Catholic abbreviations and full names, keyed without spaces or full stops, lowercase.
 * Values are the USFM book codes the Bible data uses, which are the same in every translation.
 */
const BOOK_ALIASES = {
  GEN: ['gen', 'ge', 'gn', 'genesis'],
  EXO: ['exo', 'ex', 'exod', 'exodus'],
  LEV: ['lev', 'lv', 'leviticus'],
  NUM: ['num', 'nm', 'nb', 'numbers'],
  DEU: ['deu', 'deut', 'dt', 'deuteronomy'],
  JOS: ['jos', 'josh', 'joshua'],
  JDG: ['jdg', 'judg', 'jg', 'judges'],
  RUT: ['rut', 'ru', 'ruth'],
  "1SA": ['1sa', '1sam', '1samuel'],
  "2SA": ['2sa', '2sam', '2samuel'],
  "1KI": ['1ki', '1kgs', '1kings'],
  "2KI": ['2ki', '2kgs', '2kings'],
  "1CH": ['1ch', '1chr', '1chronicles'],
  "2CH": ['2ch', '2chr', '2chronicles'],
  EZR: ['ezr', 'ezra'],
  NEH: ['neh', 'nehemiah'],
  EST: ['est', 'esth', 'esther'],
  JOB: ['job', 'jb'],
  PSA: ['psa', 'ps', 'psl', 'pss', 'psalm', 'psalms'],
  PRO: ['pro', 'prov', 'pr', 'proverbs'],
  ECC: ['ecc', 'eccl', 'qoh', 'ecclesiastes'],
  SNG: ['sng', 'song', 'sg', 'cant', 'songofsolomon', 'songofsongs'],
  ISA: ['isa', 'is', 'isaiah'],
  JER: ['jer', 'jeremiah'],
  LAM: ['lam', 'lamentations'],
  EZK: ['ezk', 'ez', 'ezek', 'ezekiel'],
  DAN: ['dan', 'dn', 'daniel'],
  HOS: ['hos', 'hosea'],
  JOL: ['jol', 'jl', 'joel'],
  AMO: ['amo', 'am', 'amos'],
  OBA: ['oba', 'ob', 'obad', 'obadiah'],
  JON: ['jon', 'jonah'],
  MIC: ['mic', 'mi', 'micah'],
  NAM: ['nam', 'na', 'nahum'],
  HAB: ['hab', 'habakkuk'],
  ZEP: ['zep', 'zeph', 'zephaniah'],
  HAG: ['hag', 'haggai'],
  ZEC: ['zec', 'zech', 'zechariah'],
  MAL: ['mal', 'malachi'],
  MAT: ['mat', 'matt', 'mt', 'matthew'],
  MRK: ['mrk', 'mark', 'mk', 'mr'],
  LUK: ['luk', 'luke', 'lk'],
  JHN: ['jhn', 'john', 'jn'],
  ACT: ['act', 'acts'],
  ROM: ['rom', 'romans'],
  "1CO": ['1co', '1cor', '1corinthians'],
  "2CO": ['2co', '2cor', '2corinthians'],
  GAL: ['gal', 'galatians'],
  EPH: ['eph', 'ephesians'],
  PHP: ['php', 'phil', 'philippians'],
  COL: ['col', 'colossians'],
  "1TH": ['1th', '1thess', '1thessalonians'],
  "2TH": ['2th', '2thess', '2thessalonians'],
  "1TI": ['1ti', '1tim', '1timothy'],
  "2TI": ['2ti', '2tim', '2timothy'],
  TIT: ['tit', 'titus'],
  PHM: ['phm', 'phlm', 'philemon'],
  HEB: ['heb', 'hebrews'],
  JAS: ['jas', 'jm', 'james'],
  "1PE": ['1pe', '1pet', '1peter'],
  "2PE": ['2pe', '2pet', '2peter'],
  "1JN": ['1jn', '1john'],
  "2JN": ['2jn', '2john'],
  "3JN": ['3jn', '3john'],
  JUD: ['jud', 'jude'],
  REV: ['rev', 'rv', 'revelation'],
  TOB: ['tob', 'tb', 'tobit'],
  JDT: ['jdt', 'judith'],
  WIS: ['wis', 'wisdom'],
  SIR: ['sir', 'sirach', 'ecclesiasticus'],
  BAR: ['bar', 'baruch'],
  "1MA": ['1ma', '1mac', '1macc', '1maccabees'],
  "2MA": ['2ma', '2mac', '2macc', '2maccabees'],
};

const ALIAS_CODE = new Map(Object.entries(BOOK_ALIASES).flatMap(([code, names]) => names.map((n) => [n, code])));

/** The USFM code for a typed book name or abbreviation ("1 Cor", "Jn", "Ps"), or null when unknown. */
export function resolveBookCode(text) {
  const key = String(text ?? '').toLowerCase().replace(/[.\s]/g, '');
  return ALIAS_CODE.get(key) ?? null;
}

/**
 * Reads a citation as typed: "John 3:16", "1 Cor 13:1-8", "Ps 23", "Song of Songs 2:1–7". The chapter
 * is required; verses are optional. Returns null for plain words, which are searched instead.
 */
export function parseCitation(text) {
  const match = /^((?:[1-3]\s*)?[A-Za-z][A-Za-z.]*(?:\s+[A-Za-z][A-Za-z.]*)*?)\s*(\d+)(?:\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const chapter = Number(match[2]);
  if (chapter < 1) return null;
  const from = match[3] === undefined ? undefined : Number(match[3]);
  const to = match[4] === undefined ? from : Number(match[4]);
  if (from !== undefined && (from < 1 || to < from)) return null;
  return { book: match[1].trim(), chapter, from, to };
}

/** Groups verse numbers into contiguous runs: [16, 17, 19] -> [{from:16,to:17}, {from:19,to:19}]. */
export function runsOf(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const runs = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && n === last.to + 1) last.to = n;
    else runs.push({ from: n, to: n });
  }
  return runs;
}

/** "16-17,19" for runs [{16,17},{19,19}]. */
export function formatRuns(runs) {
  return runs.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join(',');
}

/** Removes the « » markers that the search service puts around matched words. */
export function stripHits(snippet) {
  return String(snippet ?? '').replace(/[«»]/g, '');
}
