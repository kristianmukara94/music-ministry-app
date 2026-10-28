// The intro slide: the first slide of a Praise & Worship item shows its title card, or a solid black screen. The operator sets it on the Live
// panel for the item on air, and the saved default in Settings moves it when the default changes. Black means no text, icon or background
// on the projector, the phones and the TV. Run with: node --test shared/intro-slide.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer, presentedFrame } from './live.js';
import { INTRO_SLIDE_MODES, PROJECTOR_SETTINGS_DEFAULTS, sanitizeProjectorSettings } from './projector-settings.js';
import { remoteViewSnapshot, secondaryViewSnapshot } from './remote-view.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);

const TITLE_CARD = {
  kind: 'pw',
  slide: { kind: 'title', label: 'Bible Enthronement', subtitle: 'Opening' },
  segmentName: 'Opening',
  type: 'song',
  index: 0,
  total: 3,
  footer: '',
};
const LYRICS = {
  kind: 'pw',
  slide: { kind: 'lyrics', label: 'V1', text: 'Lord', chip: 'V1', hymnId: 1, hymnTitle: 'Hymn', sectionId: '1', position: 1, stanzaCount: 1, part: 0, parts: 1, fontPx: 96, top: 0.2, centred: false, align: 'center' },
  segmentName: 'Opening',
  type: 'song',
  index: 1,
  total: 3,
  footer: '',
};

/** The projector is on, shows the item's first slide, and the Secondary display is on air in dual mode. */
const onAirWith = (frame) =>
  run(initialLiveState(), { type: 'output/toggle', output: 'projector' }, { type: 'projector/show', frame, source: 'PW_SESSION' }, { type: 'display/live', value: true });

test('the intro slide starts as the title card, and the saved default is the title card', () => {
  assert.equal(initialLiveState().introSlideMode, 'title');
  assert.equal(PROJECTOR_SETTINGS_DEFAULTS.defaultIntroSlideMode, 'title');
  assert.deepEqual(INTRO_SLIDE_MODES, ['title', 'black']);
});

test('the operator sets the look; an unknown look is ignored and a repeat changes nothing', () => {
  const s = initialLiveState();
  const black = liveReducer(s, { type: 'introSlide/set', value: 'black' });
  assert.equal(black.introSlideMode, 'black');
  assert.equal(liveReducer(s, { type: 'introSlide/set', value: 'sideways' }), s, 'an unknown value is ignored');
  assert.equal(liveReducer(black, { type: 'introSlide/set', value: 'black' }), black, 'the same look is not a change');
});

test('only the intro slide is blacked out: lyrics and other frames are shown as they are', () => {
  assert.deepEqual(presentedFrame(TITLE_CARD, 'black'), { kind: 'black' });
  assert.equal(presentedFrame(TITLE_CARD, 'title'), TITLE_CARD, 'title mode shows the title card');
  assert.equal(presentedFrame(LYRICS, 'black'), LYRICS, 'the lyrics after the intro are not changed');
  const text = { kind: 'text', title: 'Notice', text: 'Welcome', bg: null };
  assert.equal(presentedFrame(text, 'black'), text);
});

test('the projector and the phones show a blank screen for the intro slide when it is black', () => {
  let s = onAirWith(TITLE_CARD);
  assert.equal(remoteViewSnapshot(s, 1).screen, 'live', 'the title card is on the phones');
  assert.equal(remoteViewSnapshot(s, 1).title, 'Opening', 'the title is the segment name');

  s = liveReducer(s, { type: 'introSlide/set', value: 'black' });
  const blank = remoteViewSnapshot(s, 1);
  assert.equal(blank.screen, 'blackout', 'black is a blank screen to the phones');
  assert.deepEqual(blank.lines, []);
  assert.equal(s.projector.live.kind, 'pw', 'the projector frame itself is kept, so black can be lifted at once');
});

test('the TV shows no text and no background media for the intro slide when it is black', () => {
  let s = run(onAirWith(TITLE_CARD), { type: 'settings/welcome', value: { slideBackground: { backgroundType: 'VIDEO', backgroundUrl: 'apcc-media://media/21' } } });
  const titled = secondaryViewSnapshot(s, 1).frame;
  assert.equal(titled.kind, 'slide');
  assert.equal(titled.mediaId, '21', 'the title card has its background in title mode');

  s = liveReducer(s, { type: 'introSlide/set', value: 'black' });
  const black = secondaryViewSnapshot(s, 1).frame;
  assert.equal(black.kind, 'blackout');
  assert.deepEqual(black.lines, []);
  assert.equal(black.title, '');
  assert.equal(black.mediaId, null, 'no picture or video behind the black screen');
});

test('the saved default moves the live choice when it changes; the operator\'s own choice stands otherwise', () => {
  let s = initialLiveState();
  s = liveReducer(s, { type: 'settings/projector', value: { defaultIntroSlideMode: 'black' } });
  assert.equal(s.settings.defaultIntroSlideMode, 'black');
  assert.equal(s.introSlideMode, 'black', 'a changed default takes effect at once');

  s = liveReducer(s, { type: 'introSlide/set', value: 'title' });
  s = liveReducer(s, { type: 'settings/projector', value: { slideFont: 'serif' } });
  assert.equal(s.introSlideMode, 'title', 'an unrelated setting does not undo the operator\'s choice');

  s = liveReducer(s, { type: 'settings/projector', value: { defaultIntroSlideMode: 'black' } });
  assert.equal(s.introSlideMode, 'title', 'saving the same default does not move the choice');
});

test('an unknown saved default falls back to the title card', () => {
  assert.equal(sanitizeProjectorSettings({ defaultIntroSlideMode: 'sideways' }).defaultIntroSlideMode, 'title');
  assert.equal(sanitizeProjectorSettings({ defaultIntroSlideMode: 'black' }).defaultIntroSlideMode, 'black');
});

test('the toggle sits on the Live panel, and the Settings page has the default', () => {
  assert.match(read('src/praise-worship/IntroSlideToggle.tsx'), /dispatch\(\{ type: 'introSlide\/set', value: id \}\)/);
  assert.match(read('src/praise-worship/LiveView.tsx'), /<IntroSlideToggle \/>/);
  assert.match(read('src/settings/ProjectorSettings.tsx'), /save\(\{ defaultIntroSlideMode \}\)/);
  assert.match(read('src/output/ProjectorView.tsx'), /presentedFrame\(mirror && projector\.paused \? projector\.staged : projector\.live, introSlideMode\)/);
});
