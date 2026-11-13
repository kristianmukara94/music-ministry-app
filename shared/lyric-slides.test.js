// The song form's slides: long parts cut into slides of up to four lines, continuation slides, and the part chosen on a slide card written
// back into the lyrics box. Run with: node --test shared/lyric-slides.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTINUATION,
  duplicateSlide,
  lyricSlides,
  moveSlide,
  removeSlide,
  setSlidePart,
  slidePart,
  slidesToSaved,
  slidesToText,
  splitStanza,
  withContinuations,
} from './lyric-slides.js';
import { parseLyrics } from './lyrics-parser.js';

const lines = (n, word = 'Line') => Array.from({ length: n }, (_, i) => `${word} ${i + 1}`);
const shape = (slides) => slides.map((s) => [s.continuation ? CONTINUATION : s.stanzaType, s.lyricsText.split('\n').length]);

test('a 12-line untagged song makes three slides of four: Verse 1, then two continuations of it', () => {
  const { slides, errors } = lyricSlides(lines(12).join('\n'));
  assert.deepEqual(errors, []);
  assert.deepEqual(shape(slides), [['Verse 1', 4], ['', 4], ['', 4]]);
  assert.deepEqual(slides.map((s) => s.stanzaType), ['Verse 1', 'Verse 1', 'Verse 1'], 'continuations carry the part');
  assert.equal(slides[1].lyricsText, 'Line 5\nLine 6\nLine 7\nLine 8');
});

test('a tagged part splits the same way, and the next tag starts its own part', () => {
  const raw = `[Verse 1]\n${lines(8).join('\n')}\n\n[Chorus]\nSample lyric line A\nSample lyric line B`;
  assert.deepEqual(shape(lyricSlides(raw).slides), [['Verse 1', 4], ['', 4], ['Chorus', 2]]);
});

test('with auto-split off, a long part stays one slide', () => {
  assert.deepEqual(shape(lyricSlides(lines(12).join('\n'), { autoSplit: false }).slides), [['Verse 1', 12]]);
});

test('parts split evenly, and long lines count as the lines they wrap to', () => {
  assert.deepEqual(splitStanza(lines(5)).map((s) => s.length), [3, 2], 'not 4 + 1');
  assert.deepEqual(splitStanza(lines(4)).map((s) => s.length), [4], 'four lines fit one slide');
  const long = 'x'.repeat(80); // wraps to two projected lines
  assert.deepEqual(splitStanza([long, long, long]).map((s) => s.length), [2, 1]);
  assert.deepEqual(splitStanza(['y'.repeat(400)]).map((s) => s.length), [1], 'one line too long for a slide is still a slide');
});

test('without tags a blank line still starts a new verse; under a tag it starts a continuation of the part', () => {
  assert.deepEqual(shape(lyricSlides('A\nB\n\nC\nD').slides), [['Verse 1', 2], ['Verse 2', 2]]);
  assert.deepEqual(shape(lyricSlides('[Chorus]\nA\nB\n\nC\nD').slides), [['Chorus', 2], ['', 2]]);
});

test('choosing Chorus on slide 2 writes [Chorus] above its lines; Continuation takes it out and keeps the slide apart', () => {
  const raw = lines(12).join('\n');
  const slides = lyricSlides(raw).slides;
  const chorus = slidesToText(setSlidePart(slides, 1, 'Chorus'));
  assert.match(chorus, /Line 4\n\n\[Chorus\]\nLine 5\n/);
  const back = lyricSlides(chorus).slides;
  assert.deepEqual(shape(back), [['Verse 1', 4], ['Chorus', 4], ['', 4]], 'slide 3 carries on the chorus');
  assert.equal(slidePart(back, 1), 'Chorus');

  const cont = slidesToText(setSlidePart(back, 1, CONTINUATION));
  assert.doesNotMatch(cont, /\[Chorus\]/);
  assert.match(cont, /Line 4\n\nLine 5/, 'a blank line keeps it a slide of its own');
  assert.deepEqual(shape(lyricSlides(cont).slides), [['Verse 1', 4], ['', 4], ['', 4]]);
});

test('the first slide is never a continuation', () => {
  const slides = lyricSlides('[Verse 1]\nA').slides;
  assert.deepEqual(setSlidePart(slides, 0, CONTINUATION), slides);
  assert.equal(slidePart(slides, 0), 'Verse 1');
});

test('moving or removing slides never changes another slide’s part', () => {
  const slides = lyricSlides(`[Verse 1]\n${lines(8).join('\n')}\n\n[Chorus]\nSample lyric line A`).slides; // V1, cont, Chorus
  const moved = moveSlide(slides, 2, 0);
  assert.deepEqual(moved.map((s) => s.stanzaType), ['Chorus', 'Verse 1', 'Verse 1']);
  assert.deepEqual(shape(lyricSlides(slidesToText(moved)).slides), [['Chorus', 1], ['Verse 1', 4], ['', 4]]);
  const removed = removeSlide(slides, 0);
  assert.deepEqual(shape(removed), [['Verse 1', 4], ['Chorus', 1]], 'the continuation left first becomes Verse 1');
  assert.deepEqual(shape(duplicateSlide(slides, 1)), [['Verse 1', 4], ['', 4], ['Verse 1', 4], ['Chorus', 1]]);
});

test('what is saved reads back, through the main process parser, as the slides shown, continuations under their inherited part', () => {
  const slides = lyricSlides(`${lines(12).join('\n')}\n\n[Chorus]\n${lines(6, 'Sample lyric line').join('\n')}`).slides;
  const saved = parseLyrics(slidesToSaved(slides));
  assert.deepEqual(saved.errors, []);
  assert.deepEqual(
    saved.stanzas.map((s) => s.stanzaType),
    ['Verse 1', 'Verse 1', 'Verse 1', 'Chorus', 'Chorus'],
  );
  assert.deepEqual(saved.stanzas.map((s) => s.lyricsText), slides.map((s) => s.lyricsText));
});

test('a saved song opens with each repeated part as a continuation, and its text reads back the same', () => {
  const stored = [
    { stanzaType: 'Verse 1', lyricsText: 'A\nB' },
    { stanzaType: 'Verse 1', lyricsText: 'C\nD' },
    { stanzaType: 'Chorus', lyricsText: 'E' },
  ];
  const text = slidesToText(withContinuations(stored));
  assert.equal(text, '[Verse 1]\nA\nB\n\nC\nD\n\n[Chorus]\nE');
  assert.deepEqual(lyricSlides(text).slides, withContinuations(stored));
});

test('the parser’s warnings and errors still come through', () => {
  assert.match(lyricSlides('[X]\nA').errors[0], /Unknown tag/);
  assert.match(lyricSlides('').errors[0], /at least one stanza/);
  assert.deepEqual(lyricSlides('Intro\n[Chorus]\nA').warnings, ['Lyrics before the first tag were placed in Verse 1.']);
  assert.deepEqual(lyricSlides('[Bridge]\n\n[Chorus]\nA').warnings, ['Bridge is empty and was skipped.']);
});
