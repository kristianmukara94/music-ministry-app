// "Holy Mass" in the labels, the lower third turning on at Go Live, live editing in the Holy Mass console, and the Holy Mass song title card.
// Run with: node --test shared/holy-mass.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initialLiveState, liveReducer, presentedFrame } from './live.js';
import { songTitleFrame } from './stage-plan-row.js';
import { controlAction } from './remote-view.js';
import { goLiveT as goT } from './golive-i18n.js';
import { lyT } from './lyrics-i18n.js';
import { plannerT as plT } from './planner-i18n.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);
const BAND = { template: 'segment', tag: 'Praise', line1: 'Joyful Song', line2: 'Anon' };

// ---- Labels ----

test('the Mass tab, the song scope, the queue tag and the sidebar section read Holy Mass, in all three languages', () => {
  assert.equal(goT('en', 'tabMass'), 'Holy Mass');
  assert.equal(goT('tl', 'tabMass'), 'Banal na Misa');
  assert.equal(goT('ceb', 'tabMass'), 'Balaang Misa');
  assert.equal(lyT('en', 'scope_MASS'), 'Holy Mass');
  assert.equal(plT('en', 'module_mass_order'), 'Holy Mass');
  assert.match(read('src/planner/ServiceQueue.tsx'), /mass_order: \{ label: 'HOLY MASS'/);
  assert.match(read('src/golive/MassLiveView.tsx'), /mass_order: 'Holy Mass',/);
  assert.match(read('src/i18n/strings.ts'), /'nav\.planner': 'Holy Mass Planner',/);
});

test('only the labels changed: the saved identifiers (tab id, scope value, module name) are the ones existing files and sessions use', () => {
  const console = read('src/golive/GoLiveConsole.tsx');
  assert.match(console, /setTab\('mass'\)/);
  assert.match(read('shared/song-taxonomy.js'), /PRIMARY_CATEGORIES = \['GENERAL', 'MASS', 'PRAISE_AND_WORSHIP'\]/);
  assert.match(read('src/planner/ServiceQueue.tsx'), /mass_order:/);
});

// ---- The lower third at Go Live ----

test('Go Live only stages the band: the lower third stays off until the operator presses its toggle', () => {
  let s = run(initialLiveState(), { type: 'lowerThird/stage', value: BAND });
  assert.equal(s.lowerThird.live, null, 'nothing is on the livestream');
  assert.deepEqual(s.lowerThird.staged, BAND);
  s = liveReducer(s, { type: 'lowerThird/toggle' });
  assert.deepEqual(s.lowerThird.live, BAND, 'the toggle shows the staged band');
});

test('a band the operator already has on stays on through Go Live', () => {
  const other = { template: 'segment', tag: 'Holy Mass', line1: 'Sunday' };
  const s = run(initialLiveState(), { type: 'lowerThird/show', value: BAND }, { type: 'lowerThird/stage', value: other });
  assert.deepEqual(s.lowerThird.live, BAND);
});

test('Go Live in Praise & Worship, the Holy Mass and Quick Live never turn the lower third on', () => {
  const pw = read('src/praise-worship/live.ts');
  assert.doesNotMatch(pw, /lowerThirdOn|lowerThird\/on/);
  assert.match(pw, /\(newSong \|\| newSegment\) && now\.lowerThird\.live\?\.template === 'segment'/, 'a band on screen follows the segment it moves to');
  const mass = read('src/golive/massLive.ts');
  assert.match(mass, /dispatch\(\{ type: 'lowerThird\/stage', value: holyMassBand\(planName\) \}\);\s+await playQueueAt\(index, IN_PLACE\);/);
  assert.match(read('src/golive/GoLiveConsole.tsx'), /await goLiveMassAt\(resume, massPlan\.name\);/);
  assert.match(read('src/golive/MassLiveView.tsx'), /goLiveMassAt\(firstPlayable, planName\)/);
  const quick = read('src/praise-worship/useQuickLiveController.ts');
  assert.match(quick, /dispatch\(\{ type: 'lowerThird\/stage', value: bandRef\.current \}\);/);
  for (const file of ['src/golive/massLive.ts', 'src/praise-worship/useQuickLiveController.ts', 'shared/live.js']) {
    assert.doesNotMatch(read(file), /lowerThird\/on/, `${file} has no way to force the lower third on`);
  }
});

test('leaving Quick Live replaces its band with the lineup segment\'s, or takes it down when there is no lineup', () => {
  const quick = read('src/praise-worship/useQuickLiveController.ts');
  assert.match(quick, /dispatch\(\{ type: 'lowerThird\/show', value: lowerThirdFor\(session, segment, hymnId\) \}\);/);
  assert.match(quick, /if \(takeDownBand\(state\) === 'on'\) dispatch\(\{ type: 'lowerThird\/clear' \}\);/);
  assert.match(quick, /JSON\.stringify\(state\.lowerThird\.live\) === JSON\.stringify\(mine\)/, 'a band the operator changed is left alone');
});

// ---- Holy Mass live editing and the title card ----

test('live editing is open while the Holy Mass is on air: nothing in the editor or its panels checks for it', () => {
  const hot = read('src/praise-worship/useLiveHotEditor.ts');
  assert.doesNotMatch(hot, /locked|HOLY_MASS_LOCKED|useHolyMassOnAir/);
  assert.match(hot, /await bridge\.lyrics\.editLyrics\(hymn\.id, tagged\(stanzas\)\);/, 'an edit is saved to the song');
  for (const file of ['src/praise-worship/QuickCuePanel.tsx', 'src/praise-worship/LineupHotEdit.tsx', 'src/praise-worship/SplitStanzaDialog.tsx', 'src/praise-worship/LiveView.tsx']) {
    assert.doesNotMatch(read(file), /hot\.locked|holyMassOnAir|holyMassLocked/, `${file} no longer hides its controls`);
  }
  assert.ok(!read('shared/pw-i18n.js').includes('holyMassLocked'), 'the old lock message is gone');
});

test('the Holy Mass console has Edit slide on air, Add slide and double-click editing, saved to the song', () => {
  const view = read('src/golive/MassLiveView.tsx');
  assert.match(view, /<MassHotEdit\s/);
  assert.match(view, /onChipDoubleClick=\{isSong \? \(i\) => setEditRequest\(i\) : undefined\}/);
  const editor = read('src/golive/MassHotEdit.tsx');
  assert.match(editor, /useLiveHotEditor\(hymn,/);
  assert.match(editor, /t\('editOnAir'\)/);
  assert.match(editor, /t\('addSlide'\)/);
  assert.match(editor, /t\('lineupEditHint'\)/);
  // Step 0 is the title card, so step n is stanza n - 1.
  assert.match(editor, /hot\.startEdit\(editRequest - 1\)/);
});

test('the Holy Mass and Praise & Worship consoles share one stage canvas and the same top bar', () => {
  for (const file of ['src/golive/MassLiveView.tsx', 'src/praise-worship/LiveView.tsx']) {
    const source = read(file);
    assert.match(source, /<LiveStageCanvas/, `${file} draws the shared stage`);
    assert.match(source, /<IntroSlideToggle \/>/, `${file} has the Intro slide switch`);
    assert.match(source, /t[p]?\('endSession'\)/, `${file} has End session`);
    assert.match(source, /t[p]?\('sessionTime'\)/, `${file} shows the session time`);
  }
});

test('a Holy Mass song opens on a title card in the Praise & Worship design, with its slot above', () => {
  const card = songTitleFrame({ id: 7, title: 'Here I Am, Lord', composer: 'Dan Schutte', stanzas: [{ stanzaType: 'Verse 1', lyricsText: 'I' }] }, 'Entrance Hymn');
  assert.deepEqual(card, {
    kind: 'pw',
    slide: { kind: 'title', label: 'Here I Am, Lord', subtitle: 'Dan Schutte' },
    segmentName: 'Entrance Hymn',
    type: 'song',
    index: 0,
    total: 1,
    massSong: { hymnId: 7 },
  });
  assert.equal(songTitleFrame({ id: 7, title: 'X', stanzas: [] }).segmentName, 'Holy Mass', 'a song with no slot is headed Holy Mass');
  assert.match(read('src/planner/routing.ts'), /songTitleFrame\(hymn, slotById\(item\.slot\)\?\.name\)/, 'the Go Live console plays a song from its title card');
});

test('Solid Black blacks out a Holy Mass title card, as it does a Praise & Worship one', () => {
  const card = songTitleFrame({ id: 7, title: 'Here I Am, Lord', stanzas: [] }, 'Entrance Hymn');
  assert.deepEqual(presentedFrame(card, 'black'), { kind: 'black' });
  assert.equal(presentedFrame(card, 'title'), card);
});

test('a phone does not step a Holy Mass title card through a loaded Praise & Worship lineup', () => {
  const card = songTitleFrame({ id: 7, title: 'Here I Am, Lord', stanzas: [] }, 'Entrance Hymn');
  const s = run(
    initialLiveState(),
    { type: 'pw/load', sessionId: 1 },
    { type: 'output/toggle', output: 'projector' },
    { type: 'projector/stage', frame: card },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  );
  const result = controlAction(s, { action: 'next' });
  assert.notDeepEqual(result.action, { type: 'remote/pwstep', delta: 1 });
});

test('a Holy Mass song shows its section chips with the projector window closed, and on a song staged and not yet up', () => {
  const live = read('src/golive/massLive.ts');
  // The Mass has the screen without the projector window: on the TV and phones, or in the app alone.
  assert.match(live, /export function massShowing\(state: LiveState\): boolean \{\s+return state\.queueCursor >= 0 && state\.projector\.source === 'MASS_QUEUE' && state\.projector\.live\.kind !== 'idle';/);
  assert.match(live, /if \(massShowing\(state\)\) \{\s+const frame = state\.projector\.live;/, 'Next steps through the song in every mode');
  const view = read('src/golive/MassLiveView.tsx');
  assert.match(view, /const onAir = massShowing\(live\);/);
  assert.match(view, /const steps = item \? stepsOf\(frame, hymn\) : null;/, 'the chips come from the slide the console shows, on screen or staged');
  assert.match(view, /onSelect=\{\(i\) => void run\(\(\) => goWithin\(i, frame\)\)\}/, 'a chip on a staged song puts that section on screen');
  // Grouped as in Praise & Worship: the title card's chip alone, then the song's sections under its title.
  assert.match(view, /\{ key: 'title', label: null, chips: chips\.filter\(\(chip\) => chip\.index === 0\) \}/);
  assert.match(view, /\{ key: `song-\$\{hymn!\.id\}`, label: hymn!\.title, chips: chips\.filter\(\(chip\) => chip\.index > 0\) \}/);
  assert.match(view, /jumpHeading=\{tp\('jumpToSection'\)\}/);
});

test('the keyboard steps the Holy Mass the same way as its Next and Back buttons, and as Praise & Worship', () => {
  const app = read('src/operator/OperatorApp.tsx');
  assert.match(app, /const lineup = live\.pw\?\.onAir \? 'pw' : massShowing\(live\) \? 'mass' : null;/);
  assert.match(app, /void \(lineup === 'pw' \? stepLive\(delta\) : stepMass\(delta\)\);/, 'one handler, so a key never steps twice');
  // Down, Up and Space step a live console; Space on a focused button presses the button instead.
  assert.match(app, /\(ui\.view === 'goLive' \|\| ui\.view === 'praiseWorship'\) && !\(e\.key === ' ' && \(e\.target as HTMLElement\)\.closest\('button'\)\)/);
  assert.match(app, /if \(!delta \|\| document\.querySelector\('\[aria-modal="true"\]'\)\) return;/, 'an open dialog keeps its keys');
  assert.match(app, /const typing = \(e\.target as HTMLElement\)\.closest\('input, textarea, select, \[contenteditable="true"\]'\);/, 'typing in the live editor never steps');
  assert.doesNotMatch(read('src/golive/MassLiveView.tsx'), /addEventListener\('keydown'[^)]*step/, 'the console adds no second listener');
});

test('Back from the first slide of a Holy Mass item goes to the item before at its last slide, staged before the take', () => {
  const live = read('src/golive/massLive.ts');
  assert.match(live, /if \(delta === -1\) \{\s+let before = state\.queueCursor - 1;\s+while \(before >= 0 && state\.queue\[before\]\.stale\) before -= 1;\s+if \(before >= 0\) await playMassFromEnd\(before\);/);
  assert.match(live, /if \(last\) dispatch\(\{ type: 'projector\/stage', frame: last \}\);\s+dispatch\(\{ type: 'projector\/take', source: 'MASS_QUEUE' \}\);/);
});

test('the Go Live consoles show every section chip, with no Show all verses switch', () => {
  for (const file of ['src/golive/MassLiveView.tsx', 'src/praise-worship/LiveView.tsx', 'src/components/LiveStageCanvas.tsx']) {
    assert.doesNotMatch(read(file), /ShowAllVerses|showAllVerses|visibleSlideIndexes|jumpTools/, file);
  }
});

test('a prayer split into slides steps slide by slide in the Holy Mass, with a numbered chip for each', () => {
  const live = read('src/golive/massLive.ts');
  // The steps come from the place every prayer slide carries, and the slide to show from the prayer read fresh from Notes & Prayers.
  assert.match(live, /if \(frame\.kind === 'text' && prayerIdOf\(frame\) !== undefined && frame\.page && frame\.page\.total > 1\) \{\s+return \{ index: frame\.page\.index, count: frame\.page\.total, labels: numbered\(frame\.page\.total\) \};/);
  assert.match(live, /if \(note && prayerIdOf\(frame\) === note\.id\) return slideFramesOf\(note\)\[target\] \?\? null;/);
  assert.match(live, /frameAt\(frame, target, await hymnOf\(frame\), slotNameAt\(state\), await noteOf\(frame\)\)/, 'a chip jumps within the prayer');
  assert.match(live, /frameAt\(frame, target, hymn, slotNameAt\(state\), await noteOf\(frame\)\)/, 'Next and Back step within the prayer');
  // Back from the item after a prayer puts the prayer up at its last slide.
  assert.match(live, /takePrayer\(note, 'MASS_QUEUE', Math\.max\(0, slideFramesOf\(note\)\.length - 1\)\);/);
  const view = read('src/golive/MassLiveView.tsx');
  assert.match(view, /const note = useNoteOf\(frame\);/);
  assert.match(view, /frameAt\(frame, steps\.index \+ 1, hymn, slotNameAt\(live\), note\)/, 'the next-slide preview shows the prayer\'s next slide');
});
