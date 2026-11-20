// The Go Live console's Output Preview Editor, the floating Program mini screen and the edit links (src/golive/console), on both consoles:
// the text helpers, the draft isolation, two-step delete, cue filtering with the Edit buttons, the console keys and their scoping, and no-drag
// on every new button and box. The look rules are in slide-look.test.js. Synthetic strings only: no real song titles or lyrics.
// Run with: node --test shared/go-live-editor.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  balanceLines,
  consoleKeyAction,
  CONSOLE_SHORTCUTS,
  cueTabs,
  draftPending,
  editorInit,
  editorReducer,
  filterCues,
  lineStats,
  MINI_DOCK_THRESHOLD,
  miniScreenShown,
  shouldApplyLive,
  toTitleCase,
} from './stage-cue.js';
import { goLiveT } from './golive-i18n.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const DIR = 'src/golive/console';
const VIEWS = ['src/praise-worship/LiveView.tsx', 'src/golive/MassLiveView.tsx'];

// ── Text helpers ─────────────────────────────────────────────────────────

test('2 Lines and 3 Lines break the words as evenly as they go, never more lines than words', () => {
  const text = 'Sample slide line for the console editor';
  const two = balanceLines(text, 2).split('\n');
  assert.equal(two.length, 2);
  assert.equal(two.join(' '), text, 'no word is lost or moved out of order');
  assert.ok(Math.max(...two.map((l) => l.length)) <= 22, `the longest line is as short as it can be: ${JSON.stringify(two)}`);
  const three = balanceLines(text, 3).split('\n');
  assert.equal(three.length, 3);
  assert.equal(three.join(' '), text);
  assert.ok(Math.max(...three.map((l) => l.length)) <= 15, JSON.stringify(three));
  // Lines already broken are taken as one run of words.
  assert.equal(balanceLines('Sample\nSlide\nLine Two', 2), 'Sample Slide\nLine Two');
  assert.equal(balanceLines('Sample', 3), 'Sample', 'one word stays one line');
  assert.equal(balanceLines('Sample Line', 3), 'Sample\nLine', 'two words make at most two lines');
  assert.equal(balanceLines('   ', 2), '');
});

test('UPPER and Title reshape the words; Title keeps a word with an apostrophe whole', () => {
  assert.equal('Sample Slide Line'.toLocaleUpperCase(), 'SAMPLE SLIDE LINE');
  assert.equal(toTitleCase('SAMPLE slide LINE'), 'Sample Slide Line');
  assert.equal(toTitleCase('sample cue\'s line\nsecond (sample) line'), 'Sample Cue\'s Line\nSecond (Sample) Line');
});

test('the preview stats count the lines with words and the longest of them', () => {
  assert.deepEqual(lineStats('Sample Slide Line\n\n  Two  \n'), { lines: 2, maxChars: 17 });
  assert.deepEqual(lineStats(''), { lines: 0, maxChars: 0 });
  assert.equal(goLiveT('en', 'consoleEdStats', { lines: 2, chars: 17, scale: '120%' }), '2 lines · Max 17 chars/line · 120%');
});

// ── Draft isolation and two-step delete ──────────────────────────────────

test('Staged Draft keeps a change off the screen until Apply; Live Sync applies it; the two never mix', () => {
  const slide = { key: 'pw:seg-a:0', text: 'Sample Slide Line', tag: 'V1' };
  let staged = editorReducer(editorInit(slide, 'staged'), { type: 'edit', text: 'Sample Slide Line Two' });
  assert.equal(shouldApplyLive(staged), false, 'a staged change never goes on screen by itself');
  assert.equal(draftPending(staged), true, 'Apply to Live and Discard appear');
  staged = editorReducer(staged, { type: 'discard' });
  assert.equal(staged.draft.text, 'Sample Slide Line', 'Discard puts the words on air back');

  const live = editorReducer(editorInit(slide, 'live'), { type: 'edit', text: 'Sample Slide Line Two' });
  assert.equal(shouldApplyLive(live), true);
  assert.equal(draftPending(live), false, 'no Apply button in Live Sync');

  // Another slide going on air drops a draft, so it can never land on the wrong slide.
  const moved = editorReducer(staged, { type: 'slide', slide: { key: 'pw:seg-a:1', text: 'Sample Cue Title', tag: 'C1' } });
  assert.equal(moved.draft.text, 'Sample Cue Title');
});

test('Delete asks first: Confirm Delete / Cancel, with Cancel focused, and never for an item’s only slide', () => {
  let s = editorInit({ key: 'k', text: 'Sample Slide Line', tag: null });
  assert.equal(editorReducer(s, { type: 'askDelete', canDelete: false }), s);
  s = editorReducer(s, { type: 'askDelete', canDelete: true });
  assert.equal(s.confirmDelete, true);
  assert.equal(editorReducer(s, { type: 'cancelDelete' }).confirmDelete, false);

  const modal = read(`${DIR}/SlideEditorModal.tsx`);
  assert.match(modal, /\{confirmDelete \? \(/, 'Confirm Delete only after the first click');
  assert.match(modal, /onClick=\{\(\) => setConfirmDelete\(true\)\}/);
  assert.match(modal, /autoFocus disabled=\{busy\} onClick=\{\(\) => setConfirmDelete\(false\)\}/, 'Cancel has the focus');
  assert.match(modal, /disabled=\{busy \|\| !target\?\.remove\}/, 'off when the slide cannot be deleted');
});

// ── The editor modal ─────────────────────────────────────────────────────

test('the editor: header stepper, preview modes, safe guides, inline editing, helpers, scope, Reset Override and the save buttons', () => {
  const modal = read(`${DIR}/SlideEditorModal.tsx`);
  assert.match(modal, /t\('consoleEdTitle', \{ n: pad2\(cue\.index \+ 1\) \}\)/);
  assert.match(modal, /cue\.onAir \? t\('consoleEdOnAir'\) : t\('consoleEdStaged'\)/);
  assert.match(modal, /onClick=\{\(\) => onIndex\(cue\.index - 1\)\}/);
  assert.match(modal, /onClick=\{\(\) => onIndex\(cue\.index \+ 1\)\}/);
  assert.match(modal, /if \(e\.key === 'Escape' && !busy\)/, 'Escape closes');
  assert.match(modal, /t\('consoleEdFullStage'\)/);
  assert.match(modal, /t\('consoleEdLowerThird'\)/);
  assert.match(modal, /inset-\[2\.5%\][\s\S]*inset-\[5%\]/, '95% action safe and 90% title safe');
  assert.match(modal, /<InlineEditor\s+value=\{draft\.text\}/, 'the words typed on the preview are the same draft as the Slide Lines box');
  assert.match(modal, /edit\(\{ text: balanceLines\(draft\.text, 2\) \}\)/);
  assert.match(modal, /edit\(\{ text: balanceLines\(draft\.text, 3\) \}\)/);
  assert.match(modal, /edit\(\{ text: draft\.text\.toLocaleUpperCase\(\) \}\)/);
  assert.match(modal, /edit\(\{ text: toTitleCase\(draft\.text\) \}\)/);
  assert.match(modal, /const change = lookChange\(draft\.look, key, value, scope\);/, 'This Slide or All Slides');
  assert.match(modal, /\{resolved\.hasOverride && \(/, 'Reset Override only while the slide has its own look');
  assert.match(modal, /onClick=\{\(\) => edit\(\{ look: null \}\)\}/);
  // Save writes the words through the console's copy-on-write target, then the look and the notes; Save & Go Live then takes the slide.
  assert.match(modal, /await target\.apply\(draft\.text, draft\.tag\)/);
  assert.match(modal, /dispatch\(\{ type: 'slideLook\/set', key: cue\.lookKey, look: sanitizeSlideLook\(draft\.look\) \}\)/);
  assert.match(modal, /if \(goLive && !cue\.onAir\) await cue\.goLive\(\);/);
  assert.match(modal, /cue\.onAir \? t\('consoleEdSaveUpdate'\) : t\('consoleEdSaveLive'\)/);
  assert.match(modal, /t\('consoleEdDuplicate'\)/);
  assert.match(modal, /t\('consoleEdAddAfter'\)/);
  // Nothing here writes Song Lyrics, the Lectionary or the Hub directly.
  assert.doesNotMatch(modal, /bridge\.(lyrics|notes|lectionary)\./);
});

// ── Cue grid ─────────────────────────────────────────────────────────────

test('Jump to Cue: search and tabs filter the same cues in Cards and Index, and every cue has its own Edit button', () => {
  const cues = [
    { index: 0, number: 1, tag: 'V1', text: 'Sample Slide Line', group: 'Sample Cue Title' },
    { index: 1, number: 2, tag: 'C1', text: 'Sample Chorus Line', group: 'Sample Cue Title' },
    { index: 2, number: 3, tag: 'V2', text: 'Another Sample Line', group: 'Sample Cue Title' },
  ];
  assert.deepEqual(cueTabs(cues).length > 0, true);
  assert.deepEqual(filterCues(cues, { query: 'chorus' }).map((c) => c.index), [1]);
  assert.deepEqual(filterCues(cues, { query: '3' }).map((c) => c.index), [2], 'a slide number');
  assert.deepEqual(filterCues(cues, { query: 'sample' }).length, 3);

  const nav = read(`${DIR}/CueNavigator.tsx`);
  assert.match(nav, /onEdit\?: \(index: number\) => void;/);
  // The Edit button is the cue button's sibling (a button cannot hold a button), in both views.
  const li = nav.slice(nav.indexOf('<li key={cue.index}'), nav.indexOf('</li>', nav.indexOf('<li key={cue.index}')));
  const mainEnd = li.indexOf('</button>');
  assert.ok(li.indexOf('onClick={() => onEdit(cue.index)}') > mainEnd, 'Edit sits after the cue button, not inside it');
  assert.match(li, /view === 'index'\s+\? 'absolute -top-1\.5 -right-1\.5[^']*group-hover:opacity-100/, 'on hover on an index tile');
  assert.match(li, /aria-label=\{t\('consoleEditCueLabel', \{ n: pad2\(cue\.number\) \}\)\}/);
  for (const view of VIEWS) assert.match(read(view), /onEdit=\{openEditor\}/, `${view} opens the editor from a cue`);
});

// ── Monitors, inspector, typography ──────────────────────────────────────

test('the monitors carry Edit Live Slide, Edit and Push Next, the cue note and the shortcut legend with E', () => {
  const monitors = read(`${DIR}/StageMonitors.tsx`);
  assert.match(monitors, /t\('consoleEditLive'\)/);
  assert.match(monitors, /t\('consoleEditNext'\)/);
  assert.match(monitors, /t\('consolePushNext'\)/);
  assert.match(monitors, /t\('consoleCueNote', \{ text: cueNote \}\)/);
  assert.ok(CONSOLE_SHORTCUTS.includes('E'));
  assert.match(goLiveT('en', 'consoleShortcuts'), /E edit preview/);
  for (const view of VIEWS) {
    const src = read(view);
    assert.match(src, /onEditLive=\{/, view);
    assert.match(src, /onEditNext=\{/, view);
    assert.match(src, /onOpenEditor=\{/, view);
    assert.match(src, /<SlideEditorModal\s+index=\{editing\.slide\}\s+cueAt=\{/, view);
    assert.match(src, /<FloatingProgram\s+anchor=\{monitorsRef\}/, view);
  }
  assert.match(read(`${DIR}/SlideEditorCard.tsx`), /t\('consoleOpenEditor'\)/);
});

test('Text Alignment sets the projector setting every output draws', () => {
  const card = read(`${DIR}/TypographyCard.tsx`);
  assert.match(card, /role="radiogroup" aria-label=\{t\('consoleAlign'\)\}/);
  assert.match(card, /save\(\{ slideAlign: a \}\)/);
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /const align = own\?\.align \?\? settingsAlign;/);
  assert.match(view, /const edgeToEdge = own\?\.maxFit \?\? settingsEdge;/);
  assert.match(view, /const slideScale = own\?\.fontScale \?\? settingsScale;/);
});

test('a Holy Mass slide off screen is edited in place: the slide on screen keeps its place', () => {
  const targets = read(`${DIR}/editTargets.ts`);
  assert.match(targets, /const at = page \?\? current;/);
  assert.match(targets, /await save\(pages\.map\(\(p, i\) => \(i === at \? text : p\)\), current, at === current\);/, 'the screen stays on the slide it shows');
  assert.match(read(VIEWS[1]), /massPagesTarget\(\{ t: tp, item, index: v\.row, frame, note, page: i \}\)/);
});

// ── Keys ─────────────────────────────────────────────────────────────────

test('E opens the editor; every console key gives way to a field and to an open dialog', () => {
  const el = (tagName, extra = {}) => ({ tagName, closest: () => null, ...extra });
  assert.equal(consoleKeyAction({ key: 'e', target: el('DIV') }), 'edit');
  assert.equal(consoleKeyAction({ key: 'E', target: el('BUTTON') }), 'edit');
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    for (const key of ['e', 'b', 'l', 'h']) assert.equal(consoleKeyAction({ key, target: el(tag) }), null, `${key} in ${tag}`);
  }
  assert.equal(consoleKeyAction({ key: 'e', ctrlKey: true, target: el('DIV') }), null);
  const hooks = read(`${DIR}/hooks.ts`);
  assert.match(hooks, /document\.querySelector\('\[aria-modal="true"\]'\)\) return;/, 'B, L, H and E stand down while a dialog is open');
  assert.match(read('src/operator/OperatorApp.tsx'), /if \(!delta \|\| document\.querySelector\('\[aria-modal="true"\]'\)\) return;/, '← → Space too');
  assert.match(read('src/components/LiveStageCanvas.tsx'), /document\.querySelector\('\[aria-modal="true"\]'\)\) return;/, '1–9 too');
  assert.match(read(`${DIR}/SlideEditorModal.tsx`), /role="dialog"\s+aria-modal="true"/, 'the editor is such a dialog');
});

// ── Floating mini screen ─────────────────────────────────────────────────

test('the mini screen docks once the monitors scroll past the top, and steps aside for a dialog or the Quick-Live popup', () => {
  assert.equal(MINI_DOCK_THRESHOLD, 80);
  assert.equal(miniScreenShown({ monitorsBottom: 79 }), true);
  assert.equal(miniScreenShown({ monitorsBottom: 80 }), false);
  assert.equal(miniScreenShown({ monitorsBottom: 400 }), false, 'the monitors are in view');
  assert.equal(miniScreenShown({ monitorsBottom: -300, blocked: true }), false);
  assert.equal(miniScreenShown({ monitorsBottom: Number.NaN }), false);

  const mini = read(`${DIR}/FloatingProgram.tsx`);
  assert.match(mini, /w-\[356px\]/);
  assert.match(mini, /fixed right-4 bottom-4/);
  assert.match(mini, /const blocked = suspended \|\| quickLive \|\| document\.querySelector\('\[aria-modal="true"\]'\) !== null;/);
  assert.match(mini, /window\.addEventListener\('scroll', read, \{ capture: true, passive: true \}\)/, 'a scroll inside the main pane is heard');
  assert.match(mini, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/, '↑ Main Mode');
  for (const key of ['consoleMiniHide', 'consoleMiniUnhide', 'consoleMiniMain', 'consoleMiniBack', 'consoleMiniNext', 'consoleMiniEdit', 'consoleMiniBlackout']) {
    assert.ok(mini.includes(`t('${key}')`), key);
  }
  assert.match(mini, /t\('consoleMiniBar', \{ pos: counter \?\? '—' \}\)/, 'hidden: Program · 03 / 12 with Unhide');
});

// ── No-drag ──────────────────────────────────────────────────────────────

test('every new button and box is no-drag, so a click never becomes a window drag over the top bar', () => {
  for (const file of [`${DIR}/SlideEditorModal.tsx`, `${DIR}/FloatingProgram.tsx`]) {
    const src = read(file);
    const buttons = src.split('<button').slice(1).map((b) => b.slice(0, b.indexOf('>')));
    assert.ok(buttons.length >= 7, `${file} has its buttons`);
    for (const b of buttons) assert.match(b, /style=\{NO_DRAG\}/, `${file}: <button${b.slice(0, 70)}`);
    assert.match(src, /import \{ NO_DRAG \} from '\.\.\/\.\.\/components\/appRegion';/);
  }
  const modal = read(`${DIR}/SlideEditorModal.tsx`);
  assert.match(modal, /className="fixed inset-0 z-\[60\][^"]*"\s+style=\{NO_DRAG\}/, 'the backdrop');
  assert.match(modal, /aria-modal="true"[\s\S]{0,200}style=\{NO_DRAG\}/, 'the shell');
  assert.match(modal, /style=\{\{ \.\.\.NO_DRAG, textAlign: align/, 'the inline editor');
  const mini = read(`${DIR}/FloatingProgram.tsx`);
  assert.equal(mini.split('<aside').length - 1, 2, 'the mini screen and its hidden bar');
  for (const aside of mini.split('<aside').slice(1)) assert.match(aside.slice(0, aside.indexOf('>')), /style=\{NO_DRAG\}/);
});
