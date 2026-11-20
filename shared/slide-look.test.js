// Per-slide looks (shared/slide-look.js): the Output Preview Editor's "This Slide" vs "All Slides" formatting, Reset Override, the keys a look
// is found by, the editor's draft isolation, and the live state's slideLooks. Synthetic strings only: no real song titles or lyrics.
// Run with: node --test shared/slide-look.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  editorDraftChanged,
  framePageOf,
  frameWithAlign,
  lookChange,
  massLookKey,
  pwLookKey,
  resolveSlideLook,
  sanitizeSlideLook,
  slideLookAt,
  slideLookKeyOf,
  stepScale,
} from './slide-look.js';
import { initialLiveState, liveReducer } from './live.js';
import { sanitizeProjectorSettings, PROJECTOR_SETTINGS_DEFAULTS } from './projector-settings.js';

const SETTINGS = { ...PROJECTOR_SETTINGS_DEFAULTS, textCase: 'original', slideFontScale: 1.2, edgeToEdge: false, slideAlign: null };

test('a look keeps only known settings with valid values, and an empty look is no look', () => {
  assert.deepEqual(sanitizeSlideLook({ textCase: 'uppercase', align: 'left', fontScale: 1.5, maxFit: true, backdrop: 'ember' }), {
    textCase: 'uppercase',
    align: 'left',
    fontScale: 1.5,
    maxFit: true,
    backdrop: 'ember',
  });
  assert.deepEqual(sanitizeSlideLook({ textCase: 'shouting', align: 'justify', fontScale: 9, backdrop: 'neon', extra: 'Sample Cue Title' }), null);
  assert.deepEqual(sanitizeSlideLook({ fontScale: 0.5 }), { fontScale: 0.5 }, '50% is the smallest step');
  assert.deepEqual(sanitizeSlideLook({ fontScale: 2.5 }), { fontScale: 2.5 }, '250% is the largest');
  assert.equal(sanitizeSlideLook(null), null);
  assert.equal(sanitizeSlideLook('Sample Slide Line'), null);
});

test('resolveSlideLook: the slide’s own settings over the projector settings, and hasOverride while it has any', () => {
  const plain = resolveSlideLook(SETTINGS, null, 'burgundy');
  assert.deepEqual(plain, { textCase: 'original', align: null, fontScale: 1.2, maxFit: false, backdrop: 'burgundy', hasOverride: false });
  const own = resolveSlideLook(SETTINGS, { textCase: 'uppercase', align: 'right', maxFit: true }, 'burgundy');
  assert.equal(own.textCase, 'uppercase');
  assert.equal(own.align, 'right');
  assert.equal(own.maxFit, true);
  assert.equal(own.fontScale, 1.2, 'a setting the slide leaves alone follows the projector');
  assert.equal(own.backdrop, 'burgundy');
  assert.equal(own.hasOverride, true);
  assert.equal(resolveSlideLook({ ...SETTINGS, slideAlign: 'left' }, null).align, 'left', 'Text Alignment for every slide');
});

test('This Slide changes only the slide’s look; All Slides changes the setting and drops the slide’s own value for it', () => {
  const slide = lookChange(null, 'textCase', 'uppercase', 'slide');
  assert.deepEqual(slide, { look: { textCase: 'uppercase' }, settings: null, backdrop: null });

  const global = lookChange({ textCase: 'lowercase', align: 'left' }, 'textCase', 'uppercase', 'global');
  assert.deepEqual(global.look, { align: 'left' }, 'the slide no longer holds its own case, so the new setting shows on it');
  assert.deepEqual(global.settings, { textCase: 'uppercase' });

  assert.deepEqual(lookChange(null, 'align', 'center', 'global').settings, { slideAlign: 'center' });
  assert.deepEqual(lookChange(null, 'maxFit', true, 'global').settings, { edgeToEdge: true });
  assert.deepEqual(lookChange(null, 'backdrop', 'midnight', 'global'), { look: null, settings: null, backdrop: 'midnight' });

  // A scale step turns MAX off, in either scope, as A− and A+ do on the typography card.
  assert.deepEqual(lookChange({ maxFit: true }, 'fontScale', 1.4, 'slide').look, { fontScale: 1.4, maxFit: false });
  assert.deepEqual(lookChange({ maxFit: true, fontScale: 2 }, 'fontScale', 1.4, 'global'), { look: null, settings: { slideFontScale: 1.4, edgeToEdge: false }, backdrop: null });
});

test('Reset Override: a slide with no look of its own draws the projector settings again', () => {
  const look = lookChange(lookChange(null, 'align', 'left', 'slide').look, 'fontScale', 1.8, 'slide').look;
  assert.equal(resolveSlideLook(SETTINGS, look).hasOverride, true);
  const reset = null;
  const shown = resolveSlideLook(SETTINGS, reset);
  assert.equal(shown.hasOverride, false);
  assert.equal(shown.fontScale, 1.2);
  assert.equal(shown.align, null);
});

test('the text scale steps through 50%–250% and stops at either end', () => {
  assert.equal(stepScale(1, 1), 1.1);
  assert.equal(stepScale(1, -1), 0.9);
  assert.equal(stepScale(2.5, 1), 2.5);
  assert.equal(stepScale(0.5, -1), 0.5);
  assert.equal(stepScale(3.7, 1), 1.1, 'an unknown scale steps from 100%');
});

test('the alignment folds into the field each kind of slide draws it from', () => {
  const lyrics = { kind: 'lyrics', title: 'Sample Cue Title', label: 'V1', text: 'Sample Slide Line', style: { textColor: '#FFFFFF' } };
  assert.deepEqual(frameWithAlign(lyrics, 'left').style, { textColor: '#FFFFFF', textAlign: 'left' });
  const pw = { kind: 'pw', segmentName: 'Sample Segment', type: 'song', index: 0, total: 1, slide: { kind: 'lyrics', label: 'V1', chip: 'V1', text: 'Sample Slide Line', hymnId: 1, hymnTitle: 'Sample Cue Title', sectionId: '1' } };
  assert.equal(frameWithAlign(pw, 'right').slide.align, 'right');
  const picture = { kind: 'image', title: 'Sample Cue Title', src: 'apcc-media://media/1' };
  assert.equal(frameWithAlign(picture, 'left'), picture, 'a picture has no text to align');
  assert.equal(frameWithAlign(lyrics, null), lyrics, 'no alignment leaves the slide as it is');
});

test('keys: a Praise & Worship frame carries its own; a Holy Mass frame is keyed by its plan, row and slide while the projector holds it', () => {
  assert.equal(pwLookKey('seg-a', 3), 'pw:seg-a:3');
  assert.equal(massLookKey(7, 2, 1), 'mass:7:2:1');

  const pwFrame = { kind: 'pw', lookKey: pwLookKey('seg-a', 3), segmentName: 'Sample Segment', type: 'song', index: 3, total: 4, slide: { kind: 'prayer', label: 'Sample Cue Title', text: 'Sample Slide Line' } };
  assert.equal(slideLookKeyOf(initialLiveState(), pwFrame), 'pw:seg-a:3');

  const deck = (index) => ({ kind: 'deck', title: 'Sample Cue Title', slides: [[{ role: 'plain', text: 'Sample Slide Line' }], [{ role: 'plain', text: 'Sample Slide Line Two' }]], index });
  const base = initialLiveState();
  const state = {
    ...base,
    queue: [{ id: 'a' }, { id: 'b' }],
    queuePlanId: 7,
    queueCursor: 1,
    projector: { ...base.projector, live: deck(1), staged: deck(1), source: 'MASS_QUEUE' },
  };
  assert.equal(slideLookKeyOf(state, state.projector.live), 'mass:7:1:1', 'the slide on air');
  assert.equal(slideLookKeyOf(state, deck(1)), 'mass:7:1:1', 'the same slide drawn again (a copy of the frame)');
  assert.equal(slideLookKeyOf(state, deck(0)), null, 'a thumbnail of another slide never borrows the row’s look');
  assert.equal(slideLookKeyOf({ ...state, projector: { ...state.projector, source: 'DIRECT_DECK' } }, state.projector.live), null, 'a deck shown on its own has none');
});

test('framePageOf counts a Holy Mass item’s slides as the console’s cues do: a song’s title card is 0 and stanza n is n + 1', () => {
  assert.equal(framePageOf({ kind: 'lyrics', title: 'Sample Cue Title', label: 'V2', text: 'Sample Slide Line', song: { hymnId: 1, position: 1, count: 3 } }), 2);
  assert.equal(framePageOf({ kind: 'pw', segmentName: 'Sample Segment', type: 'song', index: 0, total: 1, slide: { kind: 'title', label: 'Sample Cue Title', subtitle: '' } }), 0);
  assert.equal(framePageOf({ kind: 'text', title: 'Sample Cue Title', text: 'Sample Slide Line', bg: null, page: { index: 2, total: 4 } }), 2);
  assert.equal(framePageOf({ kind: 'psalm', title: 'Sample Cue Title', response: 'Sample Slide Line', pages: ['a', 'b'], index: 1 }), 1);
  assert.equal(framePageOf(null), 0);
});

test('the live state keeps each slide’s look for every output, and drops it on null or Clear', () => {
  let s = initialLiveState();
  assert.deepEqual(s.slideLooks, {});
  s = liveReducer(s, { type: 'slideLook/set', key: 'pw:seg-a:0', look: { textCase: 'uppercase', junk: 'Sample Cue Title' } });
  assert.deepEqual(slideLookAt(s, 'pw:seg-a:0'), { textCase: 'uppercase' }, 'sanitized on the way in');
  const same = liveReducer(s, { type: 'slideLook/set', key: 'pw:seg-a:0', look: { textCase: 'uppercase' } });
  assert.equal(same, s, 'the same look again changes nothing, so nothing is sent to the outputs');
  s = liveReducer(s, { type: 'slideLook/set', key: 'mass:7:1:1', look: { align: 'left' } });
  assert.equal(Object.keys(s.slideLooks).length, 2);
  s = liveReducer(s, { type: 'slideLook/set', key: 'pw:seg-a:0', look: null });
  assert.equal(slideLookAt(s, 'pw:seg-a:0'), null, 'Reset Override saved: the look is gone');
  assert.equal(liveReducer(s, { type: 'slideLook/set', key: '', look: { align: 'left' } }), s, 'a slide needs a key');
  s = liveReducer(s, { type: 'slideLook/clear' });
  assert.deepEqual(s.slideLooks, {});
});

test('Text Alignment is a projector setting: left, center, right, or each slide’s own', () => {
  assert.equal(PROJECTOR_SETTINGS_DEFAULTS.slideAlign, null);
  assert.equal(sanitizeProjectorSettings({ slideAlign: 'right' }).slideAlign, 'right');
  assert.equal(sanitizeProjectorSettings({ slideAlign: 'diagonal' }).slideAlign, null);
});

test('the editor’s draft is isolated: nothing counts as changed until the words, tag, label, notes or look differ from the slide as saved', () => {
  const saved = { text: 'Sample Slide Line', tag: 'V1', label: '', notes: '', look: null };
  assert.equal(editorDraftChanged({ ...saved }, saved), false);
  assert.equal(editorDraftChanged({ ...saved, text: 'Sample Slide Line Two' }, saved), true);
  assert.equal(editorDraftChanged({ ...saved, label: 'Sample Cue Title' }, saved), true);
  assert.equal(editorDraftChanged({ ...saved, notes: 'Hold for the reader' }, saved), true);
  assert.equal(editorDraftChanged({ ...saved, look: { align: 'left' } }, saved), true);
  assert.equal(editorDraftChanged({ ...saved, look: { junk: 1 } }, saved), false, 'a look with nothing valid in it is no look');
});
