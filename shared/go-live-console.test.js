// The Go Live console's broadcast layout (src/golive/console), as both consoles draw it: the wiring of its cards to the rules in
// shared/stage-cue.js and to the live state, and its labels in English, Tagalog and Cebuano. The rules themselves are in stage-cue.test.js.
// Synthetic strings only: no real song titles or lyrics. Run with: node --test shared/go-live-console.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { goLiveT, GOLIVE_LANGS } from './golive-i18n.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const CONSOLE_DIR = 'src/golive/console';
const consoleFiles = () => readdirSync(fileURLToPath(new URL(`../${CONSOLE_DIR}`, import.meta.url))).map((f) => `${CONSOLE_DIR}/${f}`);
const VIEWS = ['src/praise-worship/LiveView.tsx', 'src/golive/MassLiveView.tsx'];

test('the header carries the kicker, the segment switcher, the timer with Start / Pause and Reset, the progress track and the status pill', () => {
  const header = read(`${CONSOLE_DIR}/BroadcastHeader.tsx`);
  assert.match(header, /t\('consoleKicker', \{ state: t\(live \? 'consoleNowLive' : 'consoleStandingBy'\), n: pad2\(at \+ 1\), total: pad2\(total\), role \}\)/);
  assert.match(header, /<select\s+id=\{titleId\}\s+aria-label=\{t\('consoleSegmentPick'\)\}/, 'the title is an accessible switcher');
  assert.match(header, /t\(timer\.running \? 'consoleTimerPause' : 'consoleTimerStart'\)/);
  assert.match(header, /t\('consoleTimerReset'\)/);
  assert.match(header, /progress\.over \? 'bg-danger' : 'bg-accent'/, 'amber, red past the plan');
  assert.match(header, /role="progressbar"/);
  assert.match(header, /data-output-status=\{status\}/);
  for (const view of VIEWS) assert.match(read(view), /status=\{outputStatus\(live, onAir\)\}/, `${view} follows the projector`);
});

test('the program monitor shows Blackout, Hide Text and the lower third band from the live state; the next monitor pushes Next', () => {
  const monitors = read(`${CONSOLE_DIR}/StageMonitors.tsx`);
  assert.match(monitors, /useLive\(\(s\) => s\.state\.projector\.live\.kind === 'blackout'\)/);
  assert.match(monitors, /useLive\(\(s\) => s\.state\.projector\.textHidden === true\)/);
  assert.match(monitors, /<LowerThirdStage value=\{band\} lyricBottomShare=\{lyricBottom\} \/>/);
  assert.match(monitors, /t\('consoleBlackoutOverlay'\)/);
  assert.match(monitors, /t\('consoleHiddenOverlay'\)/);
  assert.match(monitors, /t\('consoleShortcuts'\)/, 'the key legend under the program monitor');
  assert.match(monitors, /onClick=\{onPushNext \?\? undefined\}/, 'a click on the next monitor pushes it');
  assert.match(monitors, /@2xl\/monitors:grid-cols-\[minmax\(0,7fr\)_minmax\(0,5fr\)\]/, '7 : 5 side by side, stacked when narrow');
  // Each console draws its monitors with the projector's own components.
  assert.match(read(VIEWS[0]), /program=\{<PwStageFace shown=\{shownAt\(session, deck, at\)\} \/>\}/);
  assert.match(read(VIEWS[1]), /program=\{<FramePreview frame=\{frame\} \/>\}/);
  assert.match(read('src/praise-worship/CurrentNextPreview.tsx'), /export function PwStageFace/);
});

test('the workspace is two columns (2 : 1) on a wide console and one stacked column on a narrow one', () => {
  for (const view of VIEWS) assert.match(read(view), /@4xl\/work:grid-cols-\[minmax\(0,2fr\)_minmax\(0,1fr\)\]/, view);
});

test('Jump to Cue: Cards and Index views, a search over words, tags and numbers, tabs, and Key 1–9 badges', () => {
  const cues = read(`${CONSOLE_DIR}/CueNavigator.tsx`);
  assert.match(cues, /t\('consoleCueHeading', \{ n: cues\.length \}\)/);
  assert.match(cues, /aria-pressed=\{view === 'cards'\} onClick=\{\(\) => pickView\('cards'\)\}/);
  assert.match(cues, /aria-pressed=\{view === 'index'\} onClick=\{\(\) => pickView\('index'\)\}/);
  assert.match(cues, /filterCues\(cues, \{ query, tab \}\)/);
  assert.match(cues, /\{value \?\? t\('consoleAll'\)\}/, 'All, then each tab');
  assert.match(cues, /t\('consoleKey', \{ n: key \}\)/);
  assert.match(cues, /title=\{view === 'index' \? label : undefined\}/, 'the index buttons carry their slide as a tooltip');
  assert.match(cues, /useChipKeys\(\{ groups, activeIndex, onSelect, disabled \}\)/, '1–9, C and V keep working, and give way to fields');
  assert.match(read('src/components/LiveStageCanvas.tsx'), /closest\?\.\('input, textarea, select, \[contenteditable="true"\]'\)\) return;/);
});

test('the slide editor buffers a Staged Draft, saves Live Sync as the typing pauses, and deletes only after Confirm Delete', () => {
  const editor = read(`${CONSOLE_DIR}/SlideEditorCard.tsx`);
  assert.match(editor, /const pending = draftPending\(state\);/);
  assert.match(editor, /\{pending && \(/, 'Apply to Live and Discard appear only with a change waiting');
  assert.match(editor, /t\(state\.adding \? 'consoleAddApply' : 'consoleApply'\)/);
  assert.match(editor, /if \(!shouldApplyLive\(state\) \|\| busy \|\| !target\) return;/, 'Live Sync saves only in Live Sync');
  assert.match(editor, /t\(live \? 'consoleLiveSync' : 'consoleStaged'\)/);
  assert.match(editor, /\{state\.confirmDelete \? \(/, 'Confirm Delete / Cancel only after the first click');
  assert.match(editor, /onClick=\{\(\) => send\(\{ type: 'askDelete', canDelete \}\)\}/);
  assert.match(editor, /disabled=\{!canDelete\}/, 'off for an item’s only slide');
  assert.match(editor, /useDeleteSlideKey\(canDelete \? \(\) => send\(\{ type: 'askDelete', canDelete \}\) : null\)/, 'Delete and Backspace only ask');
  assert.match(editor, /<button type="button" autoFocus disabled=\{busy\} onClick=\{\(\) => send\(\{ type: 'cancelDelete' \}\)\}/, 'Cancel has the focus');
  // A song with one stanza, or a Mass item with one slide, gives no Delete.
  const targets = read(`${CONSOLE_DIR}/editTargets.ts`);
  assert.match(targets, /if \(!hymn\.stanzas\[stanza\] \|\| !canDeleteSlide\(hymn\.stanzas\.length\)\) return null;/);
  assert.match(targets, /remove: rest && canDeleteSlide\(pages\.length\) \?/);
});

test('the typography card sets the case, 50%–250% and Max on the projector settings, and the backdrop on the Live slide background', () => {
  const card = read(`${CONSOLE_DIR}/TypographyCard.tsx`);
  assert.match(card, /onChange=\{\(mode\) => mode !== textCase && save\(\{ textCase: mode \}\)\}/);
  assert.match(card, /SLIDE_FONT_SCALES\[index \+ delta\]/, 'the steps are the projector’s 50%–250% scale');
  assert.match(card, /save\(\{ edgeToEdge: !max \}\)/);
  assert.match(card, /role="radiogroup" aria-label=\{t\('consoleBackdrop'\)\}/);
  assert.match(card, /BACKDROP_THEMES\.map/);
});

test('B, L and H give way to fields, dialogs, the palette, and a saved shortcut on the same key', () => {
  const hooks = read(`${CONSOLE_DIR}/hooks.ts`);
  assert.match(hooks, /const action = consoleKeyAction\(e\);/);
  assert.match(hooks, /if \(ui\.paletteOpen \|\| ui\.capturingHotkey \|\| document\.querySelector\('\[aria-modal="true"\]'\)\) return;/);
  assert.match(hooks, /if \(combo && ui\.shortcuts\.some\(\(s\) => s\.key === combo\)\) return;/);
  // ← → and Space stay with the operator window, so a key never steps twice.
  for (const file of consoleFiles()) assert.doesNotMatch(read(file), /'ArrowRight'|'ArrowLeft'/, file);
});

test('the Holy Mass place and Back to Main Live are untouched by the console', () => {
  const mass = read(VIEWS[1]);
  assert.match(mass, /goLiveMassAt\(firstPlayable, planName\)/);
  assert.match(mass, /void run\(\(\) => \(cursor >= 0 \? playMassAt\(Number\(v\)\) : goLiveMassAt\(Number\(v\), planName\)\)\)/, 'the switcher plays through the queue');
  for (const file of consoleFiles()) assert.doesNotMatch(read(file), /queueCursor|queueParked|queue\/cursor/, `${file} never moves the Mass place itself`);
});

test('every console label is in English, Tagalog and Cebuano', () => {
  const sources = [...consoleFiles(), ...VIEWS].map(read).join('\n');
  const used = new Set([...sources.matchAll(/\bt[g]?\('((?:console|backdrop_)[A-Za-z_]*)'/g)].map((m) => m[1]));
  for (const id of ['burgundy', 'obsidian', 'ember', 'midnight']) used.add(`backdrop_${id}`);
  assert.ok(used.size > 40, `the console uses its own labels (${used.size})`);
  const text = read('shared/golive-i18n.js');
  for (const key of used) {
    const defined = [...text.matchAll(new RegExp(`^\\s+${key}: `, 'gm'))].length;
    assert.equal(defined, GOLIVE_LANGS.length, `${key} is defined once per language`);
    for (const lang of GOLIVE_LANGS) assert.notEqual(goLiveT(lang, key), key, `${key} in ${lang}`);
  }
  assert.equal(goLiveT('tl', 'consoleStaged'), 'Naka-draft: Ligtas');
  assert.equal(goLiveT('ceb', 'consoleConfirmDelete'), 'Kumpirmaha ang Pagpapas');
  assert.equal(goLiveT('en', 'consoleKicker', { state: 'Now Live', n: '03', total: '12', role: 'Sample Tag' }), 'Now Live · Segment 03 of 12 · Sample Tag');
});
