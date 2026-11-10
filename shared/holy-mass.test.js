// "Holy Mass" in the labels, the lower third turning on at Go Live, live editing in the Holy Mass console, and the Holy Mass song title card.
// Run with: node --test shared/holy-mass.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { blackoutOverMass, initialLiveState, liveReducer, presentedFrame, welcomeOverMass } from './live.js';
import { songTitleFrame } from './stage-plan-row.js';
import { controlAction } from './remote-view.js';
import { goLiveT as goT } from './golive-i18n.js';
import { lyT } from './lyrics-i18n.js';
import { plannerT as plT } from './planner-i18n.js';
import { slidesNote } from './notes.js';
import { screenPagesOf } from './prayer-screen.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);
// A Holy Mass plan whose second item has `slide` on air.
const massOnAir = (slide) =>
  run(
    initialLiveState(),
    { type: 'queue/set', planId: 7, items: [{ module: 'notes', sourceId: '1', label: 'A' }, { module: 'notes', sourceId: '2', label: 'B' }] },
    { type: 'queue/cursor', index: 1 },
    { type: 'projector/stage', frame: slide },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  );
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
  // The sidebar's one Planner holds the Holy Mass and Praise & Worship plans.
  assert.match(read('src/i18n/strings.ts'), /'nav\.planner': 'Planner',/);
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

test('Go Live starts with the lower third off: a Holy Mass Go Live (band staged, item taken) leaves it off', () => {
  assert.equal(initialLiveState().lowerThird.live, null, 'a fresh state has no band on air');
  const s = run(
    initialLiveState(),
    { type: 'output/set', output: 'projector', on: true },
    { type: 'lowerThird/stage', value: { template: 'segment', tag: 'Holy Mass', line1: 'Sunday' } },
    { type: 'queue/set', planId: 7, items: [{ module: 'notes', sourceId: '1', label: 'A' }] },
    { type: 'queue/cursor', index: 0 },
    { type: 'projector/stage', frame: { kind: 'text', text: 'In the name of the Father' } },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  );
  assert.equal(s.lowerThird.live, null, 'the lower third is still off on air');
  assert.equal(s.outputs.lowerThird, false, 'the lower-third output is not switched on either');
  assert.equal(liveReducer(s, { type: 'lowerThird/toggle' }).lowerThird.live?.tag, 'Holy Mass', 'the operator\'s toggle shows it');
});

test('a band the operator already has on stays on through Go Live', () => {
  const other = { template: 'segment', tag: 'Holy Mass', line1: 'Sunday' };
  const s = run(initialLiveState(), { type: 'lowerThird/show', value: BAND, manual: true }, { type: 'lowerThird/stage', value: other });
  assert.deepEqual(s.lowerThird.live, BAND);
});

test('Go Live in Praise & Worship, the Holy Mass and Quick Live never turn the lower third on', () => {
  const pw = read('src/praise-worship/live.ts');
  assert.doesNotMatch(pw, /lowerThirdOn|lowerThird\/on/);
  assert.match(
    pw,
    /const band = now\.lowerThird\.live;\s+if \(band && \(segment\.cues\.lowerThird \|\| band\.template === 'segment'\)\) dispatch\(\{ type: 'lowerThird\/show', value \}\);\s+else dispatch\(\{ type: 'lowerThird\/stage', value \}\);/,
    'a segment\'s cue only updates a band already on screen; with the band off, the value is only staged',
  );
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
  assert.match(hot, /await setLiveStanzas\(hymn, stanzas\)/, 'an edit is kept for this run of the app');
  assert.doesNotMatch(hot, /bridge\.lyrics/, 'Song Lyrics is never written from air');
  for (const file of ['src/praise-worship/QuickCuePanel.tsx', 'src/praise-worship/LineupHotEdit.tsx', 'src/praise-worship/SplitStanzaDialog.tsx', 'src/praise-worship/LiveView.tsx']) {
    assert.doesNotMatch(read(file), /hot\.locked|holyMassOnAir|holyMassLocked/, `${file} no longer hides its controls`);
  }
  assert.ok(!read('shared/pw-i18n.js').includes('holyMassLocked'), 'the old lock message is gone');
});

test('the Holy Mass console has Edit slide on air, Add slide and double-click editing, saved to the song', () => {
  const view = read('src/golive/MassLiveView.tsx');
  assert.match(view, /<MassHotEdit\s/);
  // Every item's chips open the editor, not only a song's.
  assert.match(view, /onChipDoubleClick=\{\(i\) => setEditRequest\(i\)\}/);
  const editor = read('src/golive/MassHotEdit.tsx');
  assert.match(editor, /useLiveHotEditor\(hymn,/);
  assert.match(editor, /t\('editOnAir'\)/);
  assert.match(editor, /t\('addSlide'\)/);
  assert.match(editor, /t\('lineupEditHint'\)/);
  // Step 0 is the title card, so step n is stanza n - 1.
  assert.match(editor, /hot\.startEdit\(editRequest - 1\)/);
});

test('every Holy Mass item that is not a song has Edit slide on air and Add slide, saved to this plan only', () => {
  const view = read('src/golive/MassLiveView.tsx');
  assert.match(view, /<MassSlideHotEdit\s/, 'a Mass part, reading, psalm, prayer or typed response gets the slide editor');
  const editor = read('src/golive/MassSlideHotEdit.tsx');
  assert.match(editor, /t\('editOnAir'\)/);
  assert.match(editor, /t\('addSlide'\)/);
  // The buttons are only off when the slide has no words (a picture or video), never because the item is not a song.
  assert.doesNotMatch(editor, /lineupEditOnlySongs|isSong/);
  const copy = read('src/golive/massSlideCopy.ts');
  assert.match(copy, /display: 'full'/, 'the copy is a full-screen slide');
  assert.match(copy, /replaceRowInFlow\(index, \{ module: 'notes'/, 'the copy takes the item’s row in this plan');
  assert.doesNotMatch(copy, /bridge\.(lectionary|massOrder)\.\w*(save|set|update)/, 'the shared source text is never written');
  assert.match(copy, /bridge\.notes\.saveCopy\(/, 'notes are written only through the copy-only channel');
  assert.doesNotMatch(copy, /bridge\.notes\.(save|remove)\(/, 'never the Hub’s own save or delete');
  assert.match(copy, /isCopyFor\(note, owner\)/, 'only this plan’s own copy is changed in place');
});

test('Go Live never writes the Liturgical Content Hub, the Lectionary or Song Lyrics', () => {
  const files = [
    'src/golive/MassSlideHotEdit.tsx', 'src/golive/MassHotEdit.tsx', 'src/golive/massSlideCopy.ts', 'src/praise-worship/LineupHotEdit.tsx',
    'src/praise-worship/CardSlideHotEdit.tsx', 'src/praise-worship/lineupSlideCopy.ts', 'src/praise-worship/useLiveHotEditor.ts',
    'src/praise-worship/SplitStanzaDialog.tsx', 'src/praise-worship/QuickCuePanel.tsx',
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /bridge\.notes\.(save|remove)\(/, `${file} never saves or deletes a Hub entry`);
    assert.doesNotMatch(source, /bridge\.lyrics\.(editLyrics|editHymn|splitStanza|deleteHymn|saveHymn)/, `${file} never writes Song Lyrics`);
    assert.doesNotMatch(source, /bridge\.lectionary\.(save|set|update|delete)/, `${file} never writes the Lectionary`);
  }
  // The Hub and the pickers leave Go Live's copies out, and still read the notes table itself.
  assert.match(read('src/notes/NotesPrayersView.tsx'), /list\.filter\(\(n\) => !isGoLiveCopy\(n\)\)/);
  assert.match(read('src/golive/MassLiveView.tsx'), /if \(!isGoLiveCopy\(note\)\)/);
  assert.match(read('src/planner/MassPlanner.tsx'), /!isGoLiveCopy\(n\) && match\(/);
  assert.match(read('src/praise-worship/Library.tsx'), /!isGoLiveCopy\(p\)/);
});

test('the slides of an edited item become one note with a break between each, so a one-slide item can grow to two', () => {
  assert.deepEqual(slidesNote(['Lord, have mercy.']), { body: 'Lord, have mercy.', split: null }, 'one slide has no split');
  const two = slidesNote(['Lord, have mercy.\nLord, have mercy.', 'Christ, have mercy.']);
  assert.equal(two.body, 'Lord, have mercy.\nLord, have mercy.\nChrist, have mercy.');
  assert.deepEqual([two.split?.mode, two.split?.at], ['manual', [1]]);
  assert.equal(screenPagesOf({ title: 'Kyrie', body: two.body, style: null, split: two.split }).length, 2, 'it plays as 1 / 2 and 2 / 2');
  assert.deepEqual(slidesNote(['A', '  ', 'B']).split?.at, [0], 'a slide left empty is dropped');
  assert.equal(screenPagesOf({ title: 'T', ...slidesNote(['A\n---\nB', 'C']) }).length, 3, 'a --- line typed in a slide starts another');
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
  assert.match(view, /const steps = item && !offScreenNote \? stepsOf\(frame, hymn\) : null;/, 'the chips come from the slide the console shows, on screen or staged');
  // A lower-third or private note row leaves the slide before it up: that slide's chips are not the row's, and Next walks on through the Mass.
  assert.match(view, /const offScreenNote = noteRowOffScreen\(live, frame\);/);
  assert.match(live, /const steps = noteRowOffScreen\(state, frame\) \? null : stepsOf\(frame, hymn\);/);
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
  // A row that plays only some of the prayer's slides steps through those: the frame's key names them.
  assert.match(live, /if \(note && prayerIdOf\(frame\) === note\.id\) return slideFramesOf\(note, prayerSlidesOf\(frame\)\)\[target\] \?\? null;/);
  assert.match(live, /frameAt\(frame, target, await hymnOf\(frame\), slotNameAt\(state\), await noteOf\(frame\)\)/, 'a chip jumps within the prayer');
  assert.match(live, /frameAt\(frame, target, hymn, slotNameAt\(state\), await noteOf\(frame\)\)/, 'Next and Back step within the prayer');
  // Back from the item after a prayer puts the prayer up at its last slide (the last of the slides its row plays).
  assert.match(live, /takePrayer\(note, 'MASS_QUEUE', Math\.max\(0, slideFramesOf\(note, source\?\.slides\)\.length - 1\), source\?\.slides\);/);
  const view = read('src/golive/MassLiveView.tsx');
  assert.match(view, /const note = useNoteOf\(frame\);/);
  assert.match(view, /frameAt\(frame, steps\.index \+ 1, hymn, slotNameAt\(live\), note\)/, 'the next-slide preview shows the prayer\'s next slide');
});

test('the welcome screen over the Holy Mass is an overlay: the queue keeps its place, and a take puts the covered slide back', () => {
  const slide = { kind: 'text', text: 'Lord, have mercy' };
  const welcome = { kind: 'welcome', lang: 'en' };
  const onAir = run(
    initialLiveState(),
    { type: 'queue/set', planId: 7, items: [{ module: 'notes', sourceId: '1', label: 'A' }, { module: 'notes', sourceId: '2', label: 'B' }] },
    { type: 'queue/cursor', index: 1 },
    { type: 'projector/stage', frame: slide },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  );
  const covered = run(onAir, { type: 'projector/show', frame: welcome, source: 'DIRECT_DECK' });
  assert.equal(covered.queueCursor, 1, 'the Mass keeps its place');
  assert.equal(covered.projector.source, 'MASS_QUEUE');
  assert.equal(covered.projector.live, welcome);
  assert.equal(covered.projector.staged, slide, 'the covered slide waits staged');
  assert.equal(welcomeOverMass(covered), true);
  // Showing it again keeps the covered slide.
  assert.equal(run(covered, { type: 'projector/show', frame: welcome, source: 'DIRECT_DECK' }).projector.staged, slide);
  const resumed = run(covered, { type: 'projector/take', source: 'MASS_QUEUE' });
  assert.equal(resumed.projector.live, slide);
  assert.equal(resumed.queueCursor, 1);
  assert.equal(welcomeOverMass(resumed), false);
  // Anything else shown directly still ends the Mass's selection.
  assert.equal(run(onAir, { type: 'projector/show', frame: { kind: 'announcements', lang: 'en' }, source: 'DIRECT_DECK' }).queueCursor, -1);
});

test('Next, Back, a section jump and Welcome again take the welcome screen down from over the Holy Mass', () => {
  const live = read('src/golive/massLive.ts');
  assert.match(live, /if \(welcomeOverMass\(state\) \|\| blackoutOverMass\(state\)\) \{\s+resumeMass\(\);\s+return;/);
  assert.match(live, /from \?\? \(welcomeOverMass\(state\) \|\| blackoutOverMass\(state\) \? state\.projector\.staged : state\.projector\.live\)/);
  assert.match(read('src/operator/actions.ts'), /if \(welcomeOverMass\(state\)\) dispatch\(\{ type: 'projector\/take', source: 'MASS_QUEUE' \}\);/);
  const view = read('src/golive/MassLiveView.tsx');
  assert.match(view, /const covered = welcomeOverMass\(live\) \|\| blackoutOverMass\(live\);/);
  assert.match(view, /const frame = onAir && !covered \? live\.projector\.live : live\.projector\.staged;/);
});

test('Blackout over the Holy Mass is a cover: the queue keeps its place, and the covered slide waits staged', () => {
  const slide = { kind: 'text', text: 'Lord, have mercy' };
  const onAir = massOnAir(slide);
  const dark = run(onAir, { type: 'projector/blackout' });
  assert.equal(dark.projector.live.kind, 'blackout');
  assert.equal(dark.queueCursor, 1, 'the Mass keeps its place');
  assert.equal(dark.queuePlanId, 7);
  assert.equal(dark.projector.source, 'MASS_QUEUE');
  assert.equal(dark.projector.staged, slide, 'the covered slide waits staged');
  assert.equal(blackoutOverMass(dark), true);
  assert.equal(blackoutOverMass(onAir), false);
  // Blackout again puts the covered slide back.
  const back = run(dark, { type: 'projector/blackout' });
  assert.equal(back.projector.live, slide);
  assert.equal(back.queueCursor, 1);
  assert.equal(blackoutOverMass(back), false);
  // Blackout over something that is not the Mass still ends the Mass's selection.
  const deck = run(onAir, { type: 'projector/show', frame: { kind: 'announcements', lang: 'en' }, source: 'DIRECT_DECK' });
  assert.equal(run(deck, { type: 'projector/blackout' }).queueCursor, -1);
});

test('Next, Back and a section jump lift Blackout from over the Holy Mass onto their slide', () => {
  const slide = { kind: 'text', text: 'Lord, have mercy' };
  const dark = run(massOnAir(slide), { type: 'projector/blackout' });
  // Next and Back (resumeMass): the take sets the slide to come back, and Blackout goes down onto it.
  const resumed = run(dark, { type: 'projector/take', source: 'MASS_QUEUE' }, { type: 'projector/blackout' });
  assert.equal(resumed.projector.live, slide);
  assert.equal(resumed.queueCursor, 1);
  // A section jump (showWithin): the target slide is staged and taken under Blackout, then Blackout goes down onto it.
  const target = { kind: 'text', text: 'Christ, have mercy' };
  const jumped = run(dark, { type: 'projector/stage', frame: target }, { type: 'projector/take', source: 'MASS_QUEUE' });
  assert.equal(jumped.projector.live.kind, 'blackout', 'the target never shows before Blackout goes down');
  const shown = run(jumped, { type: 'projector/blackout' });
  assert.equal(shown.projector.live, target);
  assert.equal(shown.queueCursor, 1);
  assert.equal(shown.projector.source, 'MASS_QUEUE');
  // Blackout over the welcome screen over the Mass: Next goes straight to the Mass slide, without the welcome screen on the way.
  const welcomeDark = run(dark, { type: 'projector/blackout' }, { type: 'projector/show', frame: { kind: 'welcome', lang: 'en' }, source: 'DIRECT_DECK' }, { type: 'projector/blackout' });
  assert.equal(blackoutOverMass(welcomeDark), true);
  assert.equal(welcomeDark.projector.staged, slide);
  assert.equal(run(welcomeDark, { type: 'projector/take', source: 'MASS_QUEUE' }, { type: 'projector/blackout' }).projector.live, slide);
  const live = read('src/golive/massLive.ts');
  assert.match(live, /dispatch\(\{ type: 'projector\/take', source: 'MASS_QUEUE' \}\);\s+if \(blackedOut\) dispatch\(\{ type: 'projector\/blackout' \}\);/);
});

test('a Holy Mass started under Blackout is on air, covered, so its badge and the console bar read Live, not Off air', () => {
  const slide = { kind: 'text', text: 'In the name of the Father' };
  // Blackout came up over a plain deck, then the operator pressed Go Live on the Mass.
  const dark = run(
    initialLiveState(),
    { type: 'output/set', output: 'projector', on: true },
    { type: 'projector/show', frame: { kind: 'announcements', lang: 'en' }, source: 'DIRECT_DECK' },
    { type: 'projector/blackout' },
    { type: 'queue/set', planId: 7, items: [{ module: 'notes', sourceId: '1', label: 'A' }] },
    { type: 'queue/cursor', index: 0 },
    { type: 'projector/stage', frame: slide },
    { type: 'projector/take', source: 'MASS_QUEUE' },
  );
  assert.equal(dark.projector.source, 'MASS_QUEUE', 'the take names who has the screen, even under Blackout');
  assert.equal(dark.queueCursor, 0);
  assert.equal(blackoutOverMass(dark), true);
  // Lifting Blackout shows the Mass slide.
  assert.equal(run(dark, { type: 'projector/blackout' }).projector.live, slide);
  // The console bar and both views read one answer.
  assert.match(read('src/golive/onAir.ts'), /if \(run === 'mass'\) return massShowing\(state\)/);
  assert.match(read('src/praise-worship/LiveView.tsx'), /const onAir = runOnAir\(live, 'pw', session\.id\);/);
  assert.match(read('src/golive/GoLiveConsole.tsx'), /runOnAir\(live, 'pw', pickedPw\)/);
  for (const lang of ['en', 'tl', 'ceb']) assert.notEqual(goT(lang, 'liveEnd'), 'liveEnd');
});
