// Go Live Fullscreen Mode: the console fills the window without touching the live output, and the Praise & Worship, Holy Mass and Planner
// tabs stay in reach. Source pins, since the rule is about what the layout switch must never do.
// Run with: node --test shared/golive-fullscreen.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GOLIVE_LANGS, goLiveT } from './golive-i18n.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the fullscreen module never dispatches to the live store or the projector', () => {
  const src = read('src/golive/fullscreen.ts');
  assert.doesNotMatch(src, /live\/store|dispatch\(|bridge\./);
  assert.match(src, /export function enterGoLiveFullscreen/);
  assert.match(src, /export function exitGoLiveFullscreen/);
  // A window already fullscreen before the mode is left fullscreen on exit.
  assert.match(src, /if \(!ownsWindowFullscreen\) return;/);
  // Leaving window fullscreen another way (Esc, F11) leaves the mode too.
  assert.match(src, /addEventListener\('fullscreenchange'/);
});

test('the console keeps its place: only the chrome around <main> is hidden', () => {
  const app = read('src/operator/OperatorApp.tsx');
  assert.match(app, /const goLiveFullscreen = useUi\(\(s\) => s\.goLiveFullscreen\) && view === 'goLive';/);
  assert.match(app, /\{!goLiveFullscreen && <Sidebar \/>\}/);
  assert.match(app, /\{!goLiveFullscreen && <EdgeTabs \/>\}/);
  assert.match(app, /\{view === 'goLive' && <GoLiveConsole \/>\}/);
  assert.doesNotMatch(app, /goLiveFullscreen[^\n]*<GoLiveConsole/);
  // The top bar (Blackout, Stop, Go Live) stays in Fullscreen Mode.
  assert.doesNotMatch(app, /goLiveFullscreen[^\n]*<TopBar/);
  useUiNotPersisted();
});

function useUiNotPersisted() {
  const ui = read('src/state/ui.ts');
  assert.match(ui, /goLiveFullscreen: false,/);
  const partialize = ui.match(/partialize: [^\n]*/)[0];
  assert.doesNotMatch(partialize, /goLiveFullscreen/);
}

test('the Praise & Worship, Holy Mass and Planner tabs and the toggle are never hidden by the mode', () => {
  const src = read('src/golive/GoLiveConsole.tsx');
  assert.match(src, /data-testid="golive-fullscreen-toggle"/);
  assert.match(src, /onClick=\{toggleGoLiveFullscreen\}/);
  for (const key of ['tabPw', 'tabMass', 'tabPlanner']) assert.match(src, new RegExp(`t\\('${key}'\\)`));
  assert.doesNotMatch(src, /fullscreen\s*&&|!fullscreen\s*&&/);
});

test('the toggle is labelled in every language', () => {
  for (const lang of GOLIVE_LANGS) {
    for (const key of ['consoleFullscreen', 'consoleExitFullscreen', 'consoleFullscreenTip', 'consoleExitFullscreenTip']) {
      const text = goLiveT(lang, key);
      assert.ok(text && text !== key, `${lang}.${key}`);
    }
  }
  assert.equal(goLiveT('en', 'consoleExitFullscreen'), 'Exit Fullscreen');
});
