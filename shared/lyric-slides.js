// The song form's slides: typed lyrics taken apart into projector slides, each with its part (Verse 1, Chorus, …) or marked as a
// continuation of the slide before it. Long stanzas are cut into slides of up to four lines, so the words stay large on the projector.
//
// The text in the lyrics box and the slide list always agree: a part chosen on a slide card is written back into the text as a tag on its
// own line, and a continuation is a slide with no tag after a blank line. What is saved is the slides themselves, as fully tagged lyrics
// (a continuation repeats the part it continues), so the main process's parseLyrics reads back exactly the slides shown.
import { MAX_STANZAS, sectionHeader, toTaggedLyrics } from './lyrics-parser.js';

/** The most lines an automatically split slide gets. */
export const SLIDE_LINES = 4;
/** About how many characters fit on one projected line; a longer line counts as two (or more) of the four. */
export const SLIDE_WRAP_CHARS = 45;
/** The part value of a continuation slide: no tag of its own, it carries on the part before it. */
export const CONTINUATION = '';
/** The parts a slide card offers, after Continuation. A slide with another part (Verse 6, Chorus 2) keeps it as an extra choice. */
export const PART_CHOICES = ['Verse 1', 'Verse 2', 'Verse 3', 'Verse 4', 'Verse 5', 'Chorus', 'Bridge', 'Tag', 'Outro'];

const weight = (line, wrapChars) => Math.max(1, Math.ceil(String(line).trim().length / wrapChars));

/**
 * A stanza's lines cut into slides of up to `maxLines` projected lines, as evenly as they go: 12 lines make three slides of 4, and 5 lines
 * make 3 + 2 rather than 4 + 1. A line longer than `wrapChars` counts as the lines it wraps to. A stanza that fits stays one slide.
 */
export function splitStanza(lines, { maxLines = SLIDE_LINES, wrapChars = SLIDE_WRAP_CHARS } = {}) {
  const list = [...(lines ?? [])];
  const w = list.map((l) => weight(l, wrapChars));
  const total = w.reduce((a, b) => a + b, 0);
  if (list.length <= 1 || total <= maxLines) return list.length ? [list] : [];
  const target = total / Math.ceil(total / maxLines);
  const n = list.length;
  // best[j]: the cheapest way to cut the first j lines; fewer slides first, then slides closest to the even size.
  const best = Array(n + 1).fill(Infinity);
  const from = Array(n + 1).fill(0);
  best[0] = 0;
  for (let j = 1; j <= n; j += 1) {
    let size = 0;
    for (let i = j - 1; i >= 0; i -= 1) {
      size += w[i];
      if (size > maxLines && j - i > 1) break;
      const cost = best[i] + 1000 + (size - target) ** 2;
      if (cost < best[j]) {
        best[j] = cost;
        from[j] = i;
      }
    }
  }
  const slides = [];
  for (let j = n; j > 0; j = from[j]) slides.unshift(list.slice(from[j], j));
  return slides;
}

/**
 * The slides typed lyrics make: [{ stanzaType, lyricsText, continuation }], with the warnings and errors parseLyrics gives.
 *
 * Tags and blank lines work as in parseLyrics, with one addition: inside a tagged part, a blank line starts a continuation slide, which
 * keeps the part. Without any tags, a blank line starts a new verse, as before. With `autoSplit` (the default), a part longer than four
 * projected lines is cut into slides (see splitStanza); the first keeps the part and the rest are continuations.
 */
export function lyricSlides(raw, { autoSplit = true, maxLines = SLIDE_LINES, wrapChars = SLIDE_WRAP_CHARS } = {}) {
  const lines = String(raw ?? '').replace(/\r\n?/g, '\n').split('\n');
  const tagged = lines.some((line) => sectionHeader(line));
  const warnings = [];
  const errors = [];
  const blocks = [];
  let verseCount = 0;
  let part = null;
  let block = null;
  const open = (label, continuation) => {
    block = { label, continuation, lines: [] };
    blocks.push(block);
  };

  for (const line of lines) {
    const header = tagged ? sectionHeader(line) : null;
    if (header) {
      const { kind, number } = header;
      if (!kind) {
        errors.push(`Unknown tag ${header.tag}. Use [V1], [C], [B], [T], or [O].`);
        part = null;
        block = null;
        continue;
      }
      if (kind === 'Verse') {
        verseCount += 1;
        part = `Verse ${number ? Number(number) : verseCount}`;
      } else {
        part = number ? `${kind} ${Number(number)}` : kind;
      }
      open(part, false);
      continue;
    }
    if (!line.trim()) {
      if (block?.lines.length) block = null;
      continue;
    }
    if (!block) {
      if (!tagged) open(`Verse ${++verseCount}`, false);
      else if (part) open(part, true);
      else {
        part = 'Verse 1';
        open(part, false);
        warnings.push('Lyrics before the first tag were placed in Verse 1.');
      }
    }
    block.lines.push(line);
  }

  const slides = [];
  for (const b of blocks) {
    const text = b.lines.join('\n').trim();
    if (!text) {
      if (!b.continuation) warnings.push(`${b.label} is empty and was skipped.`);
      continue;
    }
    const parts = autoSplit ? splitStanza(text.split('\n'), { maxLines, wrapChars }) : [text.split('\n')];
    parts.forEach((p, i) => slides.push({ stanzaType: b.label, lyricsText: p.join('\n').trim(), continuation: b.continuation || i > 0 }));
  }
  if (slides[0]) slides[0] = { ...slides[0], continuation: false };

  if (slides.length === 0 && errors.length === 0) {
    errors.push('Add at least one stanza. Paste the lyrics, or mark parts with tags like [V1] and [C].');
  }
  if (slides.length > MAX_STANZAS) errors.push(`A hymn can have at most ${MAX_STANZAS} stanzas.`);
  return { slides, warnings: [...new Set(warnings)], errors };
}

/** Stored stanzas as slides: a stanza with the same part as the one before it reads as its continuation. */
export function withContinuations(stanzas) {
  return (stanzas ?? []).map((s, i, all) => ({
    stanzaType: s.stanzaType,
    lyricsText: s.lyricsText,
    continuation: i > 0 && all[i - 1].stanzaType === s.stanzaType,
  }));
}

/** Slides as the text of the lyrics box: each part under its tag, a continuation with no tag, slides apart by a blank line. */
export function slidesToText(slides) {
  return (slides ?? []).map((s, i) => (s.continuation && i > 0 ? s.lyricsText : `[${s.stanzaType}]\n${s.lyricsText}`)).join('\n\n');
}

/** Slides as the lyrics that are saved: every slide under its own tag, a continuation repeating the part it continues. */
export function slidesToSaved(slides) {
  return toTaggedLyrics((slides ?? []).map(({ stanzaType, lyricsText }) => ({ stanzaType, lyricsText })));
}

/** The part a slide card shows: CONTINUATION, or its part. The first slide is never a continuation. */
export const slidePart = (slides, index) => (index > 0 && slides[index]?.continuation ? CONTINUATION : slides[index]?.stanzaType ?? '');

/**
 * The slides with slide `index` given `part`. A continuation takes the part before it (the first slide cannot be one); the continuations
 * straight after the slide follow its new part, as they carry it on.
 */
export function setSlidePart(slides, index, part) {
  const next = (slides ?? []).map((s) => ({ ...s }));
  const slide = next[index];
  if (!slide) return next;
  if (part === CONTINUATION) {
    if (index === 0) return next;
    slide.continuation = true;
    slide.stanzaType = next[index - 1].stanzaType;
  } else {
    slide.continuation = false;
    slide.stanzaType = String(part);
  }
  for (let j = index + 1; j < next.length && next[j].continuation; j += 1) next[j].stanzaType = next[j - 1].stanzaType;
  return next;
}

/** A continuation left after a slide of another part (by a move or a removal) becomes that part's own slide, so no slide changes part. */
function settle(slides) {
  return slides.map((s, i, all) => (s.continuation && (i === 0 || all[i - 1].stanzaType !== s.stanzaType) ? { ...s, continuation: false } : s));
}

/** The slides with the one at `from` moved to `to`. Every slide keeps its part. */
export function moveSlide(slides, from, to) {
  const list = [...(slides ?? [])];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, { ...moved, continuation: false });
  return settle(list);
}

/** The slides with a copy of slide `index` straight after it, under its part's own tag. */
export function duplicateSlide(slides, index) {
  const list = [...(slides ?? [])];
  if (!list[index]) return list;
  list.splice(index + 1, 0, { ...list[index], continuation: false });
  return list;
}

/** The slides without slide `index`. Every other slide keeps its part. */
export function removeSlide(slides, index) {
  return settle((slides ?? []).filter((_, i) => i !== index));
}
