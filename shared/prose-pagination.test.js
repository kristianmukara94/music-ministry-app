// Prose pagination for prayers, readings and scripture: slides break only between whole words, short sentences are grouped instead of
// chopped, a tiny trailing stub joins the slide before it, verse numbers stay bound to their first word, and slide text never wraps inside a
// word. Every string here is synthetic. Run with: node --test shared/prose-pagination.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  NBSP,
  PROSE_STUB,
  bindVerseNumber,
  isStub,
  mergeTrailingStub,
  paginateProse,
  proseChars,
  proseSentences,
  verseLine,
} from './prose-pagination.js';
import { prayerSlidesFor } from './prayer-slides.js';
import { splitSlide, wrappedRows } from './projector-autofit.js';
import { ON_AIR_LIMITS, autoSplitText, normalizeText } from '../src/utils/textOptimizer.ts';

/** A fit test by characters, standing in for the projector's measurement. */
const fitsChars = (max) => (text) => proseChars(text) <= max;
/** Every word of a text, in order, whatever whitespace separated them. */
const wordsOf = (text) => text.split(/\s+/).filter(Boolean);

const SENTENCES = Array.from({ length: 12 }, (_, i) => `Sample prayer sentence number ${i + 1} for testing.`);
const PRAYER = SENTENCES.join(' ');

/** Asserts that pages hold exactly the source's words, in order, and that no page starts or ends inside a source word. */
function assertWholeWords(pages, source) {
  assert.deepEqual(wordsOf(pages.join(' ')), wordsOf(source), 'no word is lost, added or changed');
  const words = new Set(wordsOf(source));
  for (const page of pages) {
    const pageWords = wordsOf(page);
    assert.ok(words.has(pageWords[0]), `page starts on a whole word: "${pageWords[0]}"`);
    assert.ok(words.has(pageWords[pageWords.length - 1]), `page ends on a whole word: "${pageWords[pageWords.length - 1]}"`);
  }
}

test('a multi-sentence prayer never splits a word across consecutive slides', () => {
  for (const budget of [60, 97, 130, 180, 260]) {
    const pages = paginateProse(PRAYER, fitsChars(budget));
    assert.ok(pages.length > 1, `split at ${budget}`);
    assertWholeWords(pages, PRAYER);
  }
});

test('one run-on sentence longer than a slide breaks at clauses or spaces, never inside a word', () => {
  const runOn = `${Array.from({ length: 30 }, (_, i) => `sample clause ${i + 1} with several words`).join(', ')}.`;
  const pages = paginateProse(runOn, fitsChars(120));
  assert.ok(pages.length > 2);
  assertWholeWords(pages, runOn);
  for (const page of pages.slice(0, -1)) assert.match(page, /,$/, 'a page of a run-on sentence ends at a clause mark');
});

test('short related sentences are grouped onto cohesive slides, not one sentence per slide', () => {
  const pages = paginateProse(PRAYER, fitsChars(260));
  assert.ok(pages.length < SENTENCES.length / 2, `${pages.length} slides for ${SENTENCES.length} short sentences`);
  for (const page of pages) {
    assert.ok(proseSentences(page).length >= 2, `a slide holds several sentences: "${page}"`);
    assert.match(page, /\.$/, 'a slide ends at a sentence end');
  }
});

test('the last two slides are evened out instead of leaving a sliver', () => {
  // Five sentences fill a slide, so a plain fill would leave one sentence on the last slide.
  const text = SENTENCES.slice(0, 6).join(' ');
  const pages = paginateProse(text, fitsChars(5 * 50), { mergeStub: false });
  assert.equal(pages.length, 2);
  const [a, b] = pages.map(proseChars);
  assert.ok(b >= a * 0.5, `last slide (${b}) is not a sliver beside ${a}`);
});

test('a trailing 1–3 word stub merges into the slide before it', () => {
  const pages = ['Sample prayer sentence one for testing. Sample prayer sentence two for testing.', 'Sample end.'];
  assert.ok(isStub(pages[1]));
  assert.deepEqual(mergeTrailingStub(pages), [`${pages[0]}\nSample end.`]);
  // The source's own whitespace joins them.
  assert.deepEqual(mergeTrailingStub(pages, { source: pages.join(' ') }), [pages.join(' ')]);
});

test('a stub is not merged when the merged slide would pass the safe upper bound', () => {
  const full = 'Sample scripture verse two with multiple words. '.repeat(7).trim();
  assert.ok(proseChars(full) + 10 > PROSE_STUB.mergedMaxChars);
  const pages = [full, 'Sample end.'];
  assert.deepEqual(mergeTrailingStub(pages), pages);
  // Nor when a measured fit says it would not fit.
  assert.deepEqual(mergeTrailingStub(['Short sample.', 'Two words.'], { fits: () => false }), ['Short sample.', 'Two words.']);
});

test('a slide that is not a stub is never merged', () => {
  const pages = ['Sample prayer sentence one for testing.', 'Sample prayer sentence two for testing, longer.'];
  assert.equal(isStub(pages[1]), false);
  assert.deepEqual(mergeTrailingStub(pages), pages);
});

test('paginating a passage that ends on a short sentence folds it into the slide before', () => {
  const text = `${SENTENCES.slice(0, 5).join(' ')} Sample end.`;
  const pages = paginateProse(text, fitsChars(5 * 50));
  assert.equal(pages.length, 1, 'the two-word ending does not get a slide of its own');
  assertWholeWords(pages, text);
});

test('a verse number is bound to its first word with a no-break space', () => {
  assert.equal(verseLine(7, ' Sample scripture verse seven. '), `7${NBSP}Sample scripture verse seven.`);
  assert.equal(bindVerseNumber('12 Sample scripture verse twelve.'), `12${NBSP}Sample scripture verse twelve.`);
  assert.equal(bindVerseNumber('Sample line 12 inside.'), 'Sample line 12 inside.');
  assert.equal(bindVerseNumber('12'), '12', 'a bare number has no word to bind to');
});

test('a verse number never ends a slide while its verse starts the next one', () => {
  const verses = Array.from({ length: 14 }, (_, i) => verseLine(i + 1, `Sample scripture verse ${i + 1} with multiple words and more words here.`));
  const passage = verses.join('\n');
  for (const budget of [70, 100, 150, 200]) {
    const pages = paginateProse(passage, fitsChars(budget));
    for (const page of pages) {
      // The last token of a slide is never a bare number, and every verse line starts with its number bound to a word.
      assert.doesNotMatch(page, /(^|\s)\d+$/, `slide ends on a bare verse number at ${budget}`);
      for (const line of page.split('\n')) if (/^\d/.test(line)) assert.match(line, new RegExp(`^\\d+${NBSP}\\S`));
    }
  }
});

test('the reading optimizer keeps a verse number bound, and other no-break spaces become plain spaces', () => {
  assert.equal(normalizeText(`3${NBSP}Sample verse${NBSP}${NBSP}text.`), `3${NBSP}Sample verse text.`);
  const reading = Array.from({ length: 10 }, (_, i) => verseLine(i + 1, `Sample scripture verse ${i + 1} with multiple words for the reading.`)).join('\n');
  const slides = autoSplitText(reading, ON_AIR_LIMITS).slides;
  assert.ok(slides.length > 1);
  for (const slide of slides) for (const line of slide.split('\n')) assert.match(line, new RegExp(`^\\d+${NBSP}\\S`), 'each verse keeps its number');
  assertWholeWords(slides, reading);
});

test('a prayer split keeps decimals, times and closing quotes exactly as written', () => {
  const body = 'Sample prayer at 10:30 today with 3.5 parts. He said "Sample quote." Then more words follow.';
  const { pages } = prayerSlidesFor(body, null);
  assert.equal(pages.map((p) => p.text).join(' '), body);
});

test('a prayer ending on a short stub folds it into the slide before when the two still fit', () => {
  const body = `${SENTENCES.slice(0, 7).join(' ')} Amen sample.`;
  const { pages } = prayerSlidesFor(body, null);
  assert.ok(pages.every((p) => !isStub(p.text)), `no stub slide: ${JSON.stringify(pages.map((p) => p.text))}`);
  assert.deepEqual(wordsOf(pages.map((p) => p.text).join(' ')), wordsOf(body));
});

test('a Holy Mass part split never leaves a few-word last part', () => {
  const lines = [{ text: SENTENCES.slice(0, 5).join(' ') }, { text: 'Sample end.' }];
  const parts = splitSlide(lines, { maxChars: 260, maxLines: 8, charsPerLine: 64 });
  assert.ok(parts.length >= 1);
  assert.ok(!isStub(parts[parts.length - 1].map((l) => l.text).join(' ')));
});

test('screen rows are counted between words (not at every letter s)', () => {
  assert.equal(wrappedRows('sss sss', 64), 1);
  assert.equal(wrappedRows('Sample words sit side by side.', 10), 4);
});

test('slide text uses word-break: normal and overflow-wrap: break-word, never break-all or anywhere', () => {
  const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
  const css = read('../src/styles.css');
  const rule = /\.apcc-prose\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the apcc-prose rule exists');
  assert.match(rule[1], /word-break:\s*normal/);
  assert.match(rule[1], /overflow-wrap:\s*break-word/);
  for (const file of ['../src/output/ProjectorView.tsx', '../src/praise-worship/PwSlideFace.tsx']) {
    const src = read(file);
    assert.match(src, /apcc-prose/, `${file} draws slide text with apcc-prose`);
    assert.doesNotMatch(src, /break-all|overflow-wrap:\s*anywhere|\[overflow-wrap:anywhere\]|wordBreak:\s*'break-all'/, `${file} never breaks inside words`);
  }
  // The fitters measure with words unbreakable, so they shrink to the widest word before any word could wrap.
  for (const file of ['../src/output/useTextAutoFit.ts', '../src/output/useProjectorTextAutoFit.ts', '../src/output/useHeadedTextFit.ts']) {
    assert.match(read(file), /overflowWrap = 'normal'/, `${file} measures with overflow-wrap: normal`);
  }
});
