// Go Live focus in Praise & Worship: Go Live hands the workspace to the live controls, ✕ and Escape hand it back, and neither touches the
// projector. Run with: node --test shared/go-live-focus.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pwT } from './pw-i18n.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const store = read('src/praise-worship/store.ts');
const focus = read('src/praise-worship/useGoLiveFocus.ts');
const hook = read('src/praise-worship/useQuickLiveController.ts');
const panel = read('src/praise-worship/QuickCuePanel.tsx');
const plan = read('src/praise-worship/PlanView.tsx');
const library = read('src/praise-worship/Library.tsx');
const liveView = read('src/praise-worship/LiveView.tsx');
const shell = read('src/praise-worship/PraiseWorship.tsx');

test('the flag starts off and is never persisted', () => {
  assert.match(store, /isGoLiveFocused: false,/);
  assert.match(store, /partialize: \(\{ tab, sessionId \}\) => \(\{ tab, sessionId \}\)/, 'only the tab and session are remembered');
});

test('Go Live turns focus on: a song from search, the header button and the Live tab button', () => {
  assert.match(hook, /setCue\(hymn\);\n\s+\/\/[^\n]*\n\s+setGoLiveFocused\(true\);/, 'on after the song is on air, not before');
  assert.match(shell, /setPwState\(\{ tab: 'live', isGoLiveFocused: true \}\);\n\s+goLive\(\);/);
  assert.match(shell, /setPwState\(\{ tab: id, isGoLiveFocused: false \}\)/, 'switching tabs starts the new view in its normal layout');
  assert.match(liveView, /setGoLiveFocused\(true\);\n\s+goLive\(\);/);
});

test('✕ leaves focus only: it never dispatches to the projector', () => {
  const x = /onClick=\{\(\) => setGoLiveFocused\(false\)\}\n\s+aria-label=\{t\('leaveFocus'\)\}/;
  assert.match(panel, x);
  assert.match(liveView, x);
  assert.doesNotMatch(focus, /dispatch\(/, 'the focus helpers have no way to change the projector');
});

test('Exit & restore lineup and closing the cues also leave focus', () => {
  assert.match(hook, /setGoLiveFocused\(false\);\n\s+setCue\(null\);\n\s+\}, \[restoreLineup, tell\]\);/);
  assert.match(hook, /closeCue: \(\) => \{\n\s+setCue\(null\);\n\s+setGoLiveFocused\(false\);/);
});

test('Escape leaves focus, but not while typing, editing a stanza, under a dialog, or with Shift (Quick Live exit)', () => {
  assert.match(focus, /e\.key !== 'Escape' \|\| e\.shiftKey/);
  assert.match(focus, /isTextEntry\(e\.target\)/);
  assert.match(focus, /\[role="dialog"\], dialog\[open\]/);
  assert.match(focus, /if \(!active \|\| blocked\) return undefined;/);
  assert.match(panel, /useFocusEscape\(focused && cue !== null, busyEditing\)/);
  assert.match(liveView, /useFocusEscape\(focused\)/);
  // In focus the cue controller does not also claim Escape to clear the screen.
  assert.match(hook, /e\.key === 'Escape' && !e\.shiftKey && !usePw\.getState\(\)\.isGoLiveFocused/);
});

test('the Library and Lineup are hidden, not unmounted, so ✕ restores them as they were', () => {
  assert.match(plan, /const quick = useQuickLiveController\(\);/, 'the cue song lives above the Library');
  assert.match(plan, /focused \? 'hidden' : 'grid'/);
  assert.match(plan, /<Library quick=\{quick\} focused=\{focused\} \/>/);
  assert.doesNotMatch(library, /useQuickLiveController\(\)/, 'one controller only');
  assert.match(library, /\{!focused && <QuickCuePanel quick=\{quick\} t=\{t\} \/>\}/, 'the cue panel is never mounted twice');
});

test('the new labels exist in every language', () => {
  for (const lang of ['en', 'tl']) {
    for (const key of ['focusView', 'focusViewTip', 'leaveFocus', 'leaveFocusTip', 'onScreenNow']) {
      assert.notEqual(pwT(lang, key), key, `${lang}.${key}`);
    }
  }
});
