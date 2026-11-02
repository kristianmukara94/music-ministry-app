// Batch song import: one Word or text file holding many songs, taken apart into one song each. Pure: no Electron or DOM imports, so the main
// process (which reads the file), the review screen (which splits it again when the operator changes how) and the tests all use the same rules.
import { cleanLyricText, isMetadataLine } from './lyrics-import.js';
import { MAX_STANZAS, parseLyrics, sectionHeader, toTaggedLyrics } from './lyrics-parser.js';

/** The largest file a batch import reads. */
export const MAX_BATCH_FILE_BYTES = 10 * 1024 * 1024;
export const BATCH_FILE_TYPES = ['docx', 'txt'];
/** The most songs one file can make, so a file read the wrong way cannot flood the review screen. */
export const MAX_BATCH_SONGS = 300;
/** The longest a song title may be, as the hymn library allows. */
export const MAX_SONG_TITLE = 120;
/** The kinds of stanza a song can have, as the hymn library stores them. */
export const STANZA_KINDS = ['Verse', 'Chorus', 'Bridge', 'Tag', 'Outro'];

// A title line is short: longer lines are lyrics.
const TITLE_MAX_CHARS = 70;
const TITLE_MAX_WORDS = 10;
// "Title: Amazing Grace", "Song Title - Amazing Grace", "Pamagat: …".
const TITLE_TAG = /^\s*(?:song\s+title|title|pamagat|titulo)\s*[:\-–]\s*(.+?)\s*$/i;
// "Song 1: Amazing Grace", "Hymn #12 - Holy", "Awit 3. Ama Namin". The name after it is optional.
const SONG_NUMBER = /^\s*(?:song|hymn|awit|kanta)\s*#?\s*\d{1,3}\s*[:.\-–)]?\s*(.*?)\s*$/i;
// "01. Amazing Grace", "12) Holy". The name must start with a letter.
const NUMBERED = /^\s*(\d{1,3})\s*[.)]\s+(\p{L}.*?)\s*$/u;
// A line that is only a separator: three or more of - _ = * ~ #, with spaces allowed between.
const SEPARATOR = /^\s*(?:[-_=*~#]\s*){3,}$/;

const text = (line) => String(line?.text ?? '');
const isBlank = (line) => !text(line).trim();
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const isShort = (s) => s.trim().length > 0 && s.trim().length <= TITLE_MAX_CHARS && words(s) <= TITLE_MAX_WORDS;
/** Letters, and none of them lower case. */
const isAllCaps = (s) => /\p{L}/u.test(s) && !/\p{Ll}/u.test(s);

/** The lines of a text file. Line endings are made one kind, and a byte order mark is dropped. */
export function linesFromText(raw) {
  return String(raw ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((t) => ({ text: t.replace(/[ \t]+$/g, '') }));
}

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
const stripTags = (s) => decode(s.replace(/<[^>]*>/g, ''));

/**
 * The lines of a Word document, from the HTML mammoth makes of it. Each paragraph, heading or list item is a line, a line break inside one
 * starts a new line, and an empty paragraph is a blank line. A heading is marked, and so is a line that is bold all through, as both are
 * how a song title is usually set in Word.
 */
export function linesFromDocxHtml(html) {
  const lines = [];
  const body = String(html ?? '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const block = /<(p|h[1-6]|li)\b[^>]*>([\s\S]*?)<\/\1>|<(p|h[1-6])\b[^>]*\/>/gi;
  let m;
  while ((m = block.exec(body))) {
    const tag = (m[1] ?? m[3]).toLowerCase();
    const inner = m[2] ?? '';
    const heading = /^h[1-6]$/.test(tag);
    for (const part of inner.split(/<br\s*\/?>/i)) {
      const t = stripTags(part).replace(/\s+$/g, '');
      // Bold all through: once the bold runs are taken out, nothing but spaces is left.
      const bold = t.trim().length > 0 && !stripTags(part.replace(/<(strong|b)\b[^>]*>[\s\S]*?<\/\1>/gi, '')).trim();
      lines.push({ text: t, ...(heading ? { heading: true } : {}), ...(bold ? { bold: true } : {}) });
    }
  }
  return lines;
}

/**
 * Why a line is taken as the title of a new song, or null when it is not one. `i` is its place in `lines`, and `caps` says whether a line in
 * capitals counts (it does not when most of the lyrics are written in capitals). A title stands on its own: it starts the file or follows a
 * blank line or a separator, and a song section header ("Verse 1", "[C]") is never a title.
 */
export function titleRule(lines, i, { caps = true } = {}) {
  const line = text(lines[i]).trim();
  if (!line || sectionHeader(line) || SEPARATOR.test(line) || isMetadataLine(line)) return null;
  const prev = i === 0 ? null : lines[i - 1];
  const standsAlone = i === 0 || isBlank(prev) || SEPARATOR.test(text(prev));
  const next = lines.slice(i + 1).find((l) => !isBlank(l));
  const nextIsBlankOrHeader = i + 1 >= lines.length || isBlank(lines[i + 1]) || Boolean(sectionHeader(text(lines[i + 1])));

  if (TITLE_TAG.test(line)) return 'tag';
  if (lines[i].heading && line.length <= 150) return 'heading';
  if (!standsAlone) return null;
  const songNumber = SONG_NUMBER.exec(line);
  if (songNumber && line.length <= 150) return 'number';
  // "01. Amazing Grace" is a title only when it stands apart from what follows; a numbered verse runs straight into its next line.
  if (NUMBERED.test(line) && isShort(line) && nextIsBlankOrHeader) return 'number';
  // A bold line on its own, with no bold line under it (bold lyrics run for several lines).
  if (lines[i].bold && isShort(line) && !(next && lines[i + 1] === next && next.bold)) return 'bold';
  if (caps && isAllCaps(line) && isShort(line) && (nextIsBlankOrHeader || (next && !isAllCaps(text(next))))) return 'caps';
  return null;
}

/** The title written in a title line, without its "Title:" or "Song 3:" or "01." in front. */
export function titleText(line) {
  const t = String(line ?? '').trim();
  const tag = TITLE_TAG.exec(t);
  if (tag) return tag[1];
  const song = SONG_NUMBER.exec(t);
  if (song) return song[1] || t;
  const numbered = NUMBERED.exec(t);
  if (numbered) return numbered[2];
  return t;
}

/** Most of the lyric lines are in capitals, so a line in capitals says nothing about where a song starts. */
function mostlyCaps(lines) {
  const lyric = lines.map(text).filter((t) => t.trim() && !sectionHeader(t) && !SEPARATOR.test(t));
  if (lyric.length === 0) return false;
  return lyric.filter(isAllCaps).length / lyric.length > 0.5;
}

/** A song's lines made into stanzas with the hymn library's own rules: section headers where there are any, blank lines otherwise. */
export function stanzasFromLines(bodyLines) {
  const body = cleanLyricText(bodyLines.map(text).filter((t) => !isMetadataLine(t) && !SEPARATOR.test(t)).join('\n'));
  if (!body) return [];
  // Labels such as "Chorus:" or "Verse 1." are headers; the parser reads them. Stanzas it cannot place are left out, as they would be on save.
  return parseLyrics(body).stanzas.map((s) => ({ type: s.stanzaType, text: s.lyricsText }));
}

let counter = 0;
/** A key for a song or stanza on the review screen, unique in this window. */
export const newKey = (prefix = 'k') => `${prefix}${(counter += 1)}`;

/** One song: its title, its stanzas, the source text it came from, and why it was split there. */
function makeSong(title, bodyLines, rule) {
  return {
    key: newKey('s'),
    title: title.trim().slice(0, MAX_SONG_TITLE),
    stanzas: stanzasFromLines(bodyLines).map((s) => ({ key: newKey('z'), ...s })),
    source: cleanLyricText(bodyLines.map(text).join('\n')),
    rule,
  };
}

/** A piece of the file with no title rule of its own: a short first line followed by a blank line is its title. */
function songFromChunk(chunk, rule) {
  const lines = chunk.slice();
  while (lines.length && isBlank(lines[0])) lines.shift();
  if (lines.length === 0) return null;
  const first = text(lines[0]).trim();
  const titled = TITLE_TAG.test(first) || SONG_NUMBER.test(first) || (isShort(first) && lines.length > 1 && isBlank(lines[1]));
  const song = titled ? makeSong(titleText(first), lines.slice(1), rule) : makeSong('', lines, rule);
  song.source = cleanLyricText(lines.map(text).join('\n'));
  return song;
}

/** Splits wherever a line is the delimiter (or, with no delimiter given, any separator line such as "---" or "***"). */
function splitByDelimiter(lines, delimiter) {
  const wanted = String(delimiter ?? '').trim();
  const isCut = (l) => (wanted ? text(l).trim() === wanted : SEPARATOR.test(text(l)));
  const chunks = [[]];
  for (const line of lines) {
    if (isCut(line)) chunks.push([]);
    else chunks[chunks.length - 1].push(line);
  }
  return chunks;
}

/** Splits wherever two or more blank lines in a row are. */
function splitByBlankLines(lines) {
  const chunks = [[]];
  let blanks = 0;
  for (const line of lines) {
    if (isBlank(line)) {
      blanks += 1;
      chunks[chunks.length - 1].push(line);
      continue;
    }
    if (blanks >= 2 && chunks[chunks.length - 1].some((l) => !isBlank(l))) chunks.push([]);
    blanks = 0;
    chunks[chunks.length - 1].push(line);
  }
  return chunks;
}

/** Splits at every line a title rule picks out. Anything before the first title is a song of its own, with no title. */
function splitByTitles(lines) {
  const caps = !mostlyCaps(lines);
  const songs = [];
  let current = { title: '', rule: null, body: [] };
  const flush = () => {
    if (current.title || current.body.some((l) => !isBlank(l))) songs.push(makeSong(current.title, current.body, current.rule ?? 'start'));
  };
  lines.forEach((line, i) => {
    const rule = titleRule(lines, i, { caps });
    if (rule) {
      flush();
      current = { title: titleText(text(line)), rule, body: [] };
    } else {
      current.body.push(line);
    }
  });
  flush();
  return songs;
}

/**
 * Takes a file's lines apart into songs.
 *
 * `auto` looks for song titles: a "Title:" line, a Word heading, a numbered title ("01. Amazing Grace", "Song 3:"), a bold line on its own,
 * or a short line in capitals on its own (unless most of the lyrics are in capitals). When it finds none, it splits at separator lines
 * ("---"), then at two or more blank lines, and otherwise keeps the whole file as one song. `blank` splits at two or more blank lines, and
 * `delimiter` at every line that is exactly `delimiter` (any separator line when it is empty).
 *
 * Resolves to `{ songs, method }`, where `method` says how the file was split: 'titles', 'delimiter', 'blank' or 'single'.
 */
export function splitSongs(lines, options = {}) {
  const mode = options.mode ?? 'auto';
  const all = Array.isArray(lines) ? lines : [];
  const finish = (songs, method) => ({ songs: songs.filter(Boolean).slice(0, MAX_BATCH_SONGS), method });

  if (mode === 'delimiter') return finish(splitByDelimiter(all, options.delimiter).map((c) => songFromChunk(c, 'delimiter')), 'delimiter');
  if (mode === 'blank') return finish(splitByBlankLines(all).map((c) => songFromChunk(c, 'blank')), 'blank');

  const byTitles = splitByTitles(all);
  if (byTitles.filter((s) => s.rule !== 'start').length >= 1 && byTitles.length >= 2) return finish(byTitles, 'titles');
  if (all.some((l) => SEPARATOR.test(text(l)))) return finish(splitByDelimiter(all, '').map((c) => songFromChunk(c, 'delimiter')), 'delimiter');
  const byBlank = splitByBlankLines(all).map((c) => songFromChunk(c, 'blank')).filter(Boolean);
  if (byBlank.length >= 2) return finish(byBlank, 'blank');
  if (byTitles.length === 1 && byTitles[0].rule !== 'start') return finish(byTitles, 'titles');
  // One song: a short first line on its own is still its title.
  return finish([songFromChunk(all, 'single')], 'single');
}

/** The title a song is saved with: its own, or, when it has none, the first line of its first stanza. */
export function effectiveTitle(song) {
  const own = String(song?.title ?? '').trim();
  if (own) return own.slice(0, MAX_SONG_TITLE);
  const first = String(song?.stanzas?.[0]?.text ?? '').split('\n').find((l) => l.trim());
  return (first ?? '').trim().slice(0, MAX_SONG_TITLE);
}

/**
 * What is wrong with a song before it is imported. A `warning` lets it be imported; an `error` does not.
 * `existing` is a set of the library's titles in lower case, so a song already there is pointed out.
 */
export function songIssues(song, existing = new Set()) {
  const issues = [];
  const stanzas = (song?.stanzas ?? []).filter((s) => String(s.text ?? '').trim());
  const title = String(song?.title ?? '').trim();
  if (stanzas.length === 0) issues.push({ level: 'error', code: 'noStanzas' });
  if (stanzas.length > MAX_STANZAS) issues.push({ level: 'error', code: 'tooManyStanzas' });
  if (title.length > MAX_SONG_TITLE) issues.push({ level: 'error', code: 'titleTooLong' });
  if (!title) issues.push({ level: stanzas.length ? 'warning' : 'error', code: 'emptyTitle' });
  if ((song?.stanzas ?? []).some((s) => !String(s.text ?? '').trim())) issues.push({ level: 'warning', code: 'emptyStanza' });
  const name = effectiveTitle(song).toLowerCase();
  if (name && existing.has(name)) issues.push({ level: 'warning', code: 'duplicate' });
  return issues;
}

/** A song's stanzas as the tagged lyrics the hymn library saves ([V1], [C], …). Empty stanzas are left out. */
export function songToTagged(song) {
  const stanzas = (song?.stanzas ?? []).filter((s) => String(s.text ?? '').trim()).map((s) => ({ stanzaType: s.type, lyricsText: s.text.trim() }));
  return toTaggedLyrics(stanzas);
}

/** Splits a song in two before stanza `at`: the stanzas from there on become a new song, with no title yet. */
export function splitSongAt(song, at) {
  if (at <= 0 || at >= song.stanzas.length) return [song];
  return [
    { ...song, stanzas: song.stanzas.slice(0, at) },
    { key: newKey('s'), title: '', stanzas: song.stanzas.slice(at), source: song.source, rule: 'manual' },
  ];
}

/** Joins a song onto the end of the one before it. The earlier song keeps its title; the later title, if any, is kept as nothing lost. */
export function mergeSongs(first, second) {
  return {
    ...first,
    title: first.title.trim() ? first.title : second.title,
    stanzas: [...first.stanzas, ...second.stanzas],
    source: [first.source, second.source].filter(Boolean).join('\n\n'),
  };
}

/** The label a new stanza gets: the next verse number after the song's verses. */
export function nextVerseLabel(stanzas) {
  const numbers = stanzas.map((s) => /^Verse\s+(\d+)$/.exec(s.type)?.[1]).filter(Boolean).map(Number);
  return `Verse ${numbers.length ? Math.max(...numbers) + 1 : 1}`;
}
