// One default alignment for every kind of slide: songs, Bible passages, scripture and lectionary readings, psalms and prayers are all centred
// unless the operator chooses Left or Right (on the slide, for every slide, or in the slide's own style). A choice reaches every kind of slide,
// and resetting it brings the centre back. The stage keeps its footer clear and the inline editor follows the words' own alignment.
// Only synthetic strings are used. Run with: node --test shared/slide-align-default.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEMPLATE, segmentFromTemplate, slidesFor } from './pw.js';
import { frameWithAlign, lookChange, resolveSlideLook, slideTextAlign } from './slide-look.js';
import { stageWordsBox } from './stage-words-box.js';
import { EDGE_TO_EDGE, edgeToEdgeBox } from './text-fit.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

/** The alignment a projector frame's words are drawn with, as the renderers resolve it (ProjectorView, PwSlideFace). */
const drawnAlign = (frame) => slideTextAlign(frame.kind === 'pw' ? frame.slide.align : frame.style?.textAlign);

/** Every kind of text slide, with no alignment chosen anywhere. */
const FRAMES = {
  song: { kind: 'lyrics', title: 'Sample Cue Title', label: 'V1', text: 'Sample Song Line', style: { textColor: '#FFFFFF' } },
  bible: { kind: 'deck', title: 'Sample Bible Passage', slides: [[{ role: 'reader', text: 'Sample Bible Passage' }, { role: 'cite', text: 'Sample 1:1' }]], index: 0, style: null },
  reading: { kind: 'deck', title: 'Sample Reading', slides: [[{ role: 'reader', text: 'Sample Scripture Verse' }]], index: 0, style: { fontSize: 72 } },
  psalm: { kind: 'psalm', title: 'Sample Psalm', response: 'Sample Response Line', pages: ['Sample Scripture Verse'], index: 0, style: null },
  prayer: { kind: 'text', title: 'Sample Prayer', headline: 'Sample Prayer', text: 'Sample Prayer Line', bg: null, style: { fontSize: 60 } },
  note: { kind: 'text', title: 'Sample Note', text: 'Sample Prayer Line', bg: null },
  rosary: { kind: 'rosary', section: 'Sample', decade: '', mystery: '', scripture: '', prayer: 'Sample Prayer', text: 'Sample Prayer Line', bead: null, stage: 'prayer', style: null },
  pwSong: { kind: 'pw', segmentName: 'Sample Segment', type: 'song', index: 0, total: 1, footer: '', slide: { kind: 'lyrics', label: 'V1', chip: 'V1', text: 'Sample Song Line', hymnId: 1, hymnTitle: 'Sample Cue Title', sectionId: '1' } },
  pwPrayer: { kind: 'pw', segmentName: 'Sample Segment', type: 'prayer', index: 0, total: 1, footer: '', slide: { kind: 'prayer', label: 'Sample Segment', text: 'Sample Prayer Line' } },
};

test('the default alignment is centre, and only left, centre or right are ever drawn', () => {
  for (const missing of [undefined, null, '', 'start', 'justify', 'sideways', 7]) assert.equal(slideTextAlign(missing), 'center', `${String(missing)} falls back to centre`);
  for (const chosen of ['left', 'center', 'right']) assert.equal(slideTextAlign(chosen), chosen);
});

test('every kind of slide is centred when no alignment is chosen, styled or not', () => {
  for (const [name, frame] of Object.entries(FRAMES)) {
    assert.equal(drawnAlign(frame), 'center', `${name} is centred by default`);
    assert.equal(frameWithAlign(frame, null), frame, `${name} is left as it is with no alignment chosen`);
  }
});

test('a Left or Right choice reaches every kind of slide, Bible passages, readings and rosary prayers included', () => {
  for (const align of ['left', 'right', 'center']) {
    for (const [name, frame] of Object.entries(FRAMES)) assert.equal(drawnAlign(frameWithAlign(frame, align)), align, `${name} is drawn ${align}`);
  }
  const bible = frameWithAlign(FRAMES.reading, 'right');
  assert.deepEqual(bible.style, { fontSize: 72, textAlign: 'right' }, 'the reading keeps its own style and takes the alignment');
  assert.notEqual(bible, FRAMES.reading, 'the frame is copied, never changed in place');
});

test('This Slide and All Slides choices apply, and resetting them brings the centre back', () => {
  // This Slide: the slide's own look holds the choice.
  const own = lookChange(null, 'align', 'left', 'slide');
  assert.deepEqual(own.look, { align: 'left' });
  const withOwn = resolveSlideLook({ slideAlign: null }, own.look);
  assert.equal(drawnAlign(frameWithAlign(FRAMES.bible, withOwn.align)), 'left');
  // All Slides: the projector setting holds the choice.
  const all = lookChange(null, 'align', 'right', 'global');
  assert.equal(all.settings.slideAlign, 'right');
  const withAll = resolveSlideLook(all.settings, null);
  for (const frame of Object.values(FRAMES)) assert.equal(drawnAlign(frameWithAlign(frame, withAll.align)), 'right');
  // Reset: no look and no setting.
  const reset = resolveSlideLook({ slideAlign: null }, null);
  assert.equal(reset.align, null);
  for (const [name, frame] of Object.entries(FRAMES)) assert.equal(drawnAlign(frameWithAlign(frame, reset.align)), 'center', `${name} is centred after a reset`);
});

test('the lineup lays out songs, prayers and readings centred unless the song or prayer chooses otherwise', () => {
  const songSegment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'marian_song')), content: { kind: 'song', hymnIds: [5], maxSongs: 1, category: null } };
  const hymn = { id: 5, title: 'Sample Cue Title', stanzas: [{ id: 1, stanzaType: 'Verse 1', lyricsText: 'Sample Song Line\nSample Song Line' }] };
  const song = slidesFor({ ...songSegment, cues: { ...songSegment.cues, titleFirst: false } }, { hymns: [hymn] }).filter((s) => s.kind === 'lyrics');
  assert.ok(song.length > 0 && song.every((s) => slideTextAlign(s.align) === 'center'), 'a song is centred');
  const leftSong = slidesFor({ ...songSegment, cues: { ...songSegment.cues, titleFirst: false } }, { hymns: [{ ...hymn, style: { textAlign: 'left' } }] }).filter((s) => s.kind === 'lyrics');
  assert.ok(leftSong.every((s) => s.align === 'left'), "a song's own Left is kept");

  const prayerSegment = segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority'));
  const prayer = slidesFor({ ...prayerSegment, cues: { ...prayerSegment.cues, titleFirst: false } }, { prayer: { title: 'Sample Prayer', body: 'Sample Prayer Line', split: null } }).filter((s) => s.kind === 'prayer');
  assert.ok(prayer.length > 0 && prayer.every((s) => slideTextAlign(s.align) === 'center'), 'a prayer with no alignment is centred');

  const gospel = segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'gospel_acclamation'));
  const reading = slidesFor({ ...gospel, cues: { ...gospel.cues, titleFirst: false } }, { reading: { citation: 'Sample 1:1', rawText: 'Sample Scripture Verse' } }).filter((s) => s.kind === 'prayer');
  assert.ok(reading.length > 0 && reading.every((s) => slideTextAlign(s.align) === 'center'), 'a reading is centred');
});

test('every renderer takes its alignment from the one resolver, never a left fallback', () => {
  for (const file of ['src/output/ProjectorView.tsx', 'src/praise-worship/PwSlideFace.tsx']) {
    const src = read(file);
    assert.ok(src.includes('slideTextAlign('), `${file} uses slideTextAlign`);
    assert.doesNotMatch(src, /textAlign \?\? undefined/, `${file} has no alignment that falls back to the page's left`);
    assert.doesNotMatch(src, /\balign \?\? 'center'/, `${file} has no private centre default of its own`);
  }
});

test('the centred stage keeps clear of the footer and page count', () => {
  const projector = read('src/output/ProjectorView.tsx');
  // The safe box centres both ways and reserves the bottom for the page count, which sits inside that reserve.
  assert.match(projector, /data-safe-fit className=\{`relative flex h-full w-full flex-col items-center justify-center-safe overflow-hidden pb-\[9cqh\]/);
  assert.match(projector, /const HEADED_SAFE_BOTTOM = 9;/);
  for (const [, bottom] of projector.matchAll(/absolute right-\[4cqw\] bottom-\[(\d+)cqh\]/g)) assert.ok(Number(bottom) < 9, 'the page count sits in the reserved bottom');
  // The Praise & Worship face: the words end above the footer row and the page count.
  const face = read('src/praise-worship/PwSlideFace.tsx');
  const wordsBottom = Number(/absolute inset-x-\[6cqw\] bottom-\[([\d.]+)cqw\]/.exec(face)[1]);
  const footerBottom = Number(/absolute bottom-\[([\d.]+)cqw\] left-\[6cqw\]/.exec(face)[1]);
  assert.ok(wordsBottom > footerBottom + 1.6, 'the words stop above the footer line (its bottom plus its 1.6cqw text)');
  // Edge to edge (MAX) still keeps the footer's room when there is a footer.
  assert.ok(edgeToEdgeBox({ footer: true }).bottom >= EDGE_TO_EDGE.footerClearCqw);
});

test('the inline editor box sits over centred words symmetrically, and on the chosen side for Left and Right', () => {
  const centred = stageWordsBox({ left: 600, right: 1320, fontSize: 60, align: 'center', whole: true, monitorWidth: 1920 });
  assert.equal(centred.left + centred.width / 2, 960, 'the box stays centred on the words');
  // An alignment the editor cannot read is treated as centred, the same default as the slide.
  assert.deepEqual(stageWordsBox({ left: 600, right: 1320, fontSize: 60, align: undefined, whole: true, monitorWidth: 1920 }), centred);
  const left = stageWordsBox({ left: 600, right: 1320, fontSize: 60, align: 'left', whole: true, monitorWidth: 1920 });
  assert.equal(left.left, 600, 'left-aligned words grow to the right');
  const right = stageWordsBox({ left: 600, right: 1320, fontSize: 60, align: 'right', whole: true, monitorWidth: 1920 });
  assert.equal(right.left + right.width, 1320, 'right-aligned words grow to the left');
});
