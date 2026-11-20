// The Go Live console's broadcast layout: the rules behind its header, cue navigator, slide editor, keys and Hide Text.
// Synthetic strings only: no real song titles or lyrics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKDROP_THEMES,
  backdropThemeOf,
  canDeleteSlide,
  clockOf,
  consoleKeyAction,
  cueKeys,
  cueState,
  cueTabs,
  cueText,
  draftPending,
  editorDirty,
  editorInit,
  editorReducer,
  filterCues,
  isTypingTarget,
  outputStatus,
  pad2,
  shouldApplyLive,
  timerElapsed,
  timerProgress,
  timerReducer,
  TIMER_ZERO,
  withBackdropTheme,
} from './stage-cue.js';
import { initialLiveState, liveReducer } from './live.js';

const CUES = [
  { index: 0, number: 1, tag: 'Title', text: 'Sample Song Title', group: null, hotkey: false },
  { index: 1, number: 2, tag: 'Verse 1 (1/2)', text: 'Sample Slide Line one\nSample Slide Line two', group: 'Sample Song Title' },
  { index: 2, number: 3, tag: 'Verse 1 (2/2)', text: 'Sample Slide Line three', group: 'Sample Song Title' },
  { index: 3, number: 4, tag: 'Sample Tag', text: 'Another Sample Line', group: 'Sample Song Title' },
  { index: 4, number: 5, tag: 'Chorus', text: 'Sample Refrain Line', group: 'Second Sample Song' },
];

// ── Counters and the segment timer ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('counters read two digits, clocks mm:ss and h:mm:ss', () => {
  assert.equal(pad2(3), '03');
  assert.equal(pad2(42), '42');
  assert.equal(clockOf(0), '00:00');
  assert.equal(clockOf(185), '03:05');
  assert.equal(clockOf(3725), '01:02:05');
  assert.equal(clockOf(-4), '00:00');
});

test('the segment timer starts, pauses, keeps its time, and resets to a stopped zero', () => {
  let t = timerReducer(TIMER_ZERO, { type: 'start' }, 1_000);
  assert.equal(timerElapsed(t, 11_000), 10_000);
  t = timerReducer(t, { type: 'pause' }, 11_000);
  assert.equal(timerElapsed(t, 99_000), 10_000, 'paused, the time holds');
  t = timerReducer(t, { type: 'toggle' }, 20_000);
  assert.equal(timerElapsed(t, 25_000), 15_000, 'Start again carries on from where it paused');
  assert.equal(timerReducer(t, { type: 'start' }, 30_000), t, 'Start while running changes nothing');
  t = timerReducer(t, { type: 'reset' }, 30_000);
  assert.equal(timerElapsed(t, 90_000), 0);
  assert.equal(t.since, null, 'Reset stops it');
});

test('a new segment starts the timer from zero, running only while the run is on air', () => {
  let t = timerReducer(TIMER_ZERO, { type: 'segment', key: 'a', run: true }, 5_000);
  assert.equal(timerElapsed(t, 8_000), 3_000);
  t = timerReducer(t, { type: 'pause' }, 8_000);
  assert.equal(timerReducer(t, { type: 'segment', key: 'a', run: true }, 9_000), t, 'the same segment keeps a paused time');
  t = timerReducer(t, { type: 'segment', key: 'b', run: false }, 9_000);
  assert.deepEqual(t, { key: 'b', since: null, banked: 0 });
});

test('the progress track fills to the plan and turns over past it; no plan, no track', () => {
  assert.deepEqual(timerProgress(90_000, 180_000), { percent: 50, over: false });
  assert.deepEqual(timerProgress(200_000, 180_000), { percent: 100, over: true });
  assert.deepEqual(timerProgress(5_000, 0), { percent: 0, over: false });
});

// ── The status pill and Hide Text ─────────────────────────────────────────────────────────────────────────────────────────────────────

const lyricFrame = (key) => ({ kind: 'lyrics', key, label: 'Sample Tag', text: 'Sample Slide Line' });

test('the status pill reads Blackout over Hide Text over On Air', () => {
  let s = initialLiveState();
  s = liveReducer(s, { type: 'projector/show', frame: lyricFrame('a') });
  assert.equal(outputStatus(s, true), 'onAir');
  assert.equal(outputStatus(s, false), 'offAir');
  s = liveReducer(s, { type: 'projector/hideText' });
  assert.equal(outputStatus(s, true), 'hidden');
  s = liveReducer(s, { type: 'projector/blackout' });
  assert.equal(outputStatus(s, true), 'blackout');
});

test('Hide Text keeps the slide, its background and the lower third; a new slide lifts it', () => {
  let s = initialLiveState();
  s = liveReducer(s, { type: 'background/stage', media: { kind: 'media', mediaType: 'image', src: 'apcc-media://sample.png' } });
  s = liveReducer(s, { type: 'background/take' });
  s = liveReducer(s, { type: 'projector/show', frame: lyricFrame('a') });
  const before = s;
  s = liveReducer(s, { type: 'projector/hideText' });
  assert.equal(s.projector.textHidden, true);
  assert.equal(s.projector.live, before.projector.live, 'the slide stays on air under it');
  assert.equal(s.projector.background, before.projector.background, 'the background is untouched');
  assert.equal(s.lowerThird, before.lowerThird);
  assert.equal(liveReducer(s, { type: 'projector/hideText', hidden: true }), s, 'hiding again changes nothing');
  assert.equal(liveReducer(s, { type: 'projector/hideText' }).projector.textHidden, false, 'H again shows the words');
  const stepped = liveReducer(s, { type: 'projector/show', frame: lyricFrame('b') });
  assert.equal(stepped.projector.textHidden, false, 'the next slide shows its words');
  assert.equal(liveReducer(s, { type: 'stop' }).projector.textHidden, undefined, 'Stop clears it');
});

test('the projector draws nothing of the words while Hide Text is on, and keeps a slide colour', async () => {
  const { readFileSync } = await import('node:fs');
  const view = readFileSync(new URL('../src/output/ProjectorView.tsx', import.meta.url), 'utf8');
  assert.match(view, /const textHidden = projector\.textHidden === true;/);
  assert.match(view, /fading \|\| textHidden \? 'opacity-0' : 'opacity-100'/, 'the words fade out like a transition');
  assert.match(view, /textHidden && outputShowing && shownFrame\.kind === 'pw'/, 'a Praise & Worship slide keeps its colour');
});

// ── Jump to Cue ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a cue card previews its words on one line in the projector case', () => {
  assert.equal(cueText('Sample Slide Line\nsecond line', 'uppercase'), 'SAMPLE SLIDE LINE SECOND LINE');
  assert.equal(cueText('Sample Slide Line', 'lowercase'), 'sample slide line');
  assert.equal(cueText('Sample Slide Line', 'original'), 'Sample Slide Line');
});

test('the tabs are the songs, then each section once; parts of one stanza share a tab', () => {
  assert.deepEqual(cueTabs(CUES), ['Sample Song Title', 'Second Sample Song', 'Title', 'Verse 1', 'Sample Tag', 'Chorus']);
});

test('search finds words in any case, a tag, or a slide number', () => {
  assert.deepEqual(filterCues(CUES, { query: 'refrain' }).map((c) => c.index), [4]);
  assert.deepEqual(filterCues(CUES, { query: 'sample tag' }).map((c) => c.index), [3]);
  assert.deepEqual(filterCues(CUES, { query: '#3' }).map((c) => c.index), [2]);
  assert.deepEqual(filterCues(CUES, { query: '4' }).map((c) => c.index), [3]);
  assert.equal(filterCues(CUES, { query: '   ' }).length, CUES.length, 'an empty search keeps every cue');
});

test('a tab keeps its song or its section, and combines with the search', () => {
  assert.deepEqual(filterCues(CUES, { tab: 'Verse 1' }).map((c) => c.index), [1, 2]);
  assert.deepEqual(filterCues(CUES, { tab: 'Second Sample Song' }).map((c) => c.index), [4]);
  assert.deepEqual(filterCues(CUES, { tab: 'Sample Song Title', query: 'three' }).map((c) => c.index), [2]);
  assert.equal(filterCues(CUES, { tab: 'All' }).length, CUES.length);
});

test('keys 1–9 go to the first nine cues that take a key; a title card takes none', () => {
  const keys = cueKeys(CUES);
  assert.equal(keys.has(0), false);
  assert.equal(keys.get(1), 1);
  assert.equal(keys.get(4), 4);
  const many = Array.from({ length: 14 }, (_, i) => ({ index: i, number: i + 1, tag: 'Sample Tag', text: 'Sample Slide Line' }));
  assert.equal(cueKeys(many).size, 9);
  assert.equal(cueKeys(many).get(8), 9);
  assert.equal(cueKeys(many).has(9), false);
});

test('the live cue is gold and the one Next goes to has the amber edge', () => {
  assert.equal(cueState({ index: 2 }, 2), 'live');
  assert.equal(cueState({ index: 3 }, 2), 'next');
  assert.equal(cueState({ index: 0 }, -1), null, 'nothing on air: no next');
});

// ── The slide editor: Staged Draft vs Live Sync, and the two-step delete ──────────────────────────────────────────────────────────────

const SLIDE = { key: 'seg-1:2', text: 'Sample Slide Line', tag: 'Sample Tag' };

test('Staged Draft (the default) holds every change until Apply to Live', () => {
  let e = editorInit(SLIDE);
  assert.equal(e.mode, 'staged');
  e = editorReducer(e, { type: 'edit', text: 'Sample Slide Line, edited' });
  assert.equal(editorDirty(e), true);
  assert.equal(shouldApplyLive(e), false, 'nothing goes to the projector while typing');
  assert.equal(draftPending(e), true, 'Apply to Live and Discard are shown');
  e = editorReducer(e, { type: 'applied' });
  assert.equal(e.base.text, 'Sample Slide Line, edited');
  assert.equal(draftPending(e), false);
});

test('Discard puts the slide on air back in the box', () => {
  let e = editorReducer(editorInit(SLIDE), { type: 'edit', text: 'a typo', tag: 'Chorus' });
  e = editorReducer(e, { type: 'discard' });
  assert.deepEqual(e.draft, { text: 'Sample Slide Line', tag: 'Sample Tag' });
});

test('Live Sync applies a change at once; switching to it with a change waiting applies that change', () => {
  let e = editorReducer(editorInit(SLIDE), { type: 'mode' });
  assert.equal(e.mode, 'live');
  assert.equal(shouldApplyLive(e), false, 'nothing typed, nothing to apply');
  e = editorReducer(e, { type: 'edit', text: 'Sample Slide Line, live' });
  assert.equal(shouldApplyLive(e), true);
  assert.equal(draftPending(e), false, 'Live Sync shows no Apply button');
  let staged = editorReducer(editorInit(SLIDE), { type: 'edit', tag: 'Chorus' });
  staged = editorReducer(staged, { type: 'mode', mode: 'live' });
  assert.equal(shouldApplyLive(staged), true);
});

test('a draft never follows the operator onto another slide', () => {
  let e = editorReducer(editorInit(SLIDE), { type: 'edit', text: 'unsaved' });
  e = editorReducer(e, { type: 'askDelete' });
  e = editorReducer(e, { type: 'slide', slide: { key: 'seg-1:3', text: 'Next Sample Line', tag: 'Sample Tag' } });
  assert.deepEqual(e.draft, { text: 'Next Sample Line', tag: 'Sample Tag' });
  assert.equal(e.confirmDelete, false, 'the delete question is dropped too');
  assert.equal(e.mode, 'staged', 'the mode is kept');
});

test('words saved elsewhere refresh the box unless a change is being typed', () => {
  let e = editorInit(SLIDE);
  e = editorReducer(e, { type: 'slide', slide: { ...SLIDE, text: 'Saved Sample Line' } });
  assert.equal(e.draft.text, 'Saved Sample Line');
  e = editorReducer(e, { type: 'edit', text: 'typing…' });
  e = editorReducer(e, { type: 'slide', slide: { ...SLIDE, text: 'Saved Again' } });
  assert.equal(e.draft.text, 'typing…', 'the typed change is kept');
  assert.equal(e.base.text, 'Saved Again');
});

test('+ Add Slide After writes a new slide that waits for Apply, even in Live Sync', () => {
  let e = editorReducer(editorInit(SLIDE, 'live'), { type: 'add' });
  assert.equal(e.adding, true);
  assert.deepEqual(e.draft, { text: '', tag: 'Sample Tag' });
  e = editorReducer(e, { type: 'edit', text: 'New Sample Line' });
  assert.equal(shouldApplyLive(e), false, 'a new slide is never pushed while it is typed');
  assert.equal(draftPending(e), true);
  e = editorReducer(e, { type: 'applied' });
  assert.equal(e.adding, false);
  assert.deepEqual(e.draft, e.base, 'the box goes back to the slide on air');
});

test('Delete Slide asks first, Cancel steps back, and a one-slide item cannot be deleted', () => {
  let e = editorInit(SLIDE);
  assert.equal(canDeleteSlide(1), false);
  assert.equal(canDeleteSlide(2), true);
  assert.equal(editorReducer(e, { type: 'askDelete', canDelete: canDeleteSlide(1) }), e, 'disabled on a single slide');
  e = editorReducer(e, { type: 'askDelete', canDelete: canDeleteSlide(4) });
  assert.equal(e.confirmDelete, true, 'the first click only asks');
  e = editorReducer(e, { type: 'cancelDelete' });
  assert.equal(e.confirmDelete, false);
  e = editorReducer(editorReducer(e, { type: 'askDelete' }), { type: 'edit', text: 'x' });
  assert.equal(e.confirmDelete, false, 'typing drops the question');
});

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const el = (tagName, extra = {}) => ({ tagName, closest: () => null, ...extra });

test('B, L and H run Blackout, Lower Third and Hide Text', () => {
  assert.equal(consoleKeyAction({ key: 'b', target: el('BODY') }), 'blackout');
  assert.equal(consoleKeyAction({ key: 'L', target: el('BUTTON') }), 'lowerThird');
  assert.equal(consoleKeyAction({ key: 'h', target: el('DIV') }), 'hideText');
  assert.equal(consoleKeyAction({ key: 'x', target: el('DIV') }), null);
});

test('no console key fires while typing in a field, with a modifier, or on a repeat', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(consoleKeyAction({ key: 'b', target: el(tag) }), null, tag);
  assert.equal(consoleKeyAction({ key: 'h', target: el('DIV', { isContentEditable: true }) }), null);
  assert.equal(consoleKeyAction({ key: 'h', target: el('SPAN', { closest: () => ({}) }) }), null, 'inside a field');
  assert.equal(consoleKeyAction({ key: 'b', ctrlKey: true, target: el('DIV') }), null);
  assert.equal(consoleKeyAction({ key: 'B', shiftKey: true, target: el('DIV') }), null);
  assert.equal(consoleKeyAction({ key: 'b', repeat: true, target: el('DIV') }), null);
  assert.equal(isTypingTarget(null), false);
});

test('typing a phrase with B, L and H in the cue search changes nothing on the projector', () => {
  let s = initialLiveState();
  s = liveReducer(s, { type: 'projector/show', frame: lyricFrame('a') });
  const before = s;
  for (const key of 'blah') {
    const action = consoleKeyAction({ key, target: el('INPUT') });
    if (action) s = liveReducer(s, { type: action === 'blackout' ? 'projector/blackout' : action === 'hideText' ? 'projector/hideText' : 'lowerThird/toggle' });
  }
  assert.equal(s, before);
});

// ── Backdrop quick themes ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a quick theme sets a plain colour on the Live slide background and keeps the picture and video files', () => {
  const bg = { backgroundType: 'IMAGE', backgroundUrl: 'apcc-media://a.png', imageFile: 'apcc-media://a.png', videoFile: null, backgroundColor: null, textShade: true };
  const themed = withBackdropTheme(bg, 'midnight');
  assert.equal(themed.backgroundType, 'COLOR');
  assert.equal(themed.backgroundColor, BACKDROP_THEMES.find((t) => t.id === 'midnight').color);
  assert.equal(themed.imageFile, 'apcc-media://a.png');
  assert.equal(backdropThemeOf(themed), 'midnight');
  assert.equal(backdropThemeOf(bg), null);
  assert.equal(backdropThemeOf({ backgroundType: 'COLOR', backgroundColor: '#123456' }), null);
  for (const theme of BACKDROP_THEMES) assert.match(theme.color, /^#[0-9A-F]{6}$/, 'the slide background takes a hex colour');
});
