// The live output upgrades: the Media Library background on every slide, Advanced mode's text styling, the dissolve and push transitions,
// and editing the song on air. Run with: node --test shared/live-output.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROJECTOR_SETTINGS_DEFAULTS, OVERLAP_TRANSITIONS, TRANSITION_STYLES, sanitizeProjectorSettings } from './projector-settings.js';
import { applyLook, initialLiveState, liveReducer } from './live.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);
const MEDIA = { kind: 'media', mediaType: 'video', src: 'apcc-media://loop.mp4', title: 'Loop' };

// ---- Settings ----

test('the new output settings start off, so nothing changes until the operator turns them on', () => {
  const d = PROJECTOR_SETTINGS_DEFAULTS;
  assert.equal(d.backgroundEverywhere, false);
  assert.equal(d.advancedOutput, false);
  assert.equal(d.textColor, null);
  assert.equal(d.textOutline, 0);
  assert.equal(d.transitionStyle, 'fade', 'the transition people already have is kept');
});

test('saved values are checked: booleans stay booleans, a colour must be a hex colour, strengths are 0 to 1 in steps of 5%', () => {
  const s = sanitizeProjectorSettings({ backgroundEverywhere: true, advancedOutput: 'yes', textColor: '#fc0', textShadow: 0.333, textOutline: 7 });
  assert.equal(s.backgroundEverywhere, true);
  assert.equal(s.advancedOutput, false, 'a non-boolean falls back');
  assert.equal(s.textColor, '#FFCC00');
  assert.equal(s.textShadow, 0.35);
  assert.equal(s.textOutline, 1);
  assert.equal(sanitizeProjectorSettings({ textColor: 'red' }).textColor, null);
  assert.equal(sanitizeProjectorSettings({ textShadow: 'x' }).textShadow, PROJECTOR_SETTINGS_DEFAULTS.textShadow);
  assert.equal(sanitizeProjectorSettings({ textShadow: 0 }).textShadow, 0, 'zero is a value, not a missing one');
});

test('dissolve and push are transition styles, and they are the two that keep the leaving slide on screen', () => {
  assert.ok(TRANSITION_STYLES.includes('dissolve') && TRANSITION_STYLES.includes('push'));
  assert.deepEqual(OVERLAP_TRANSITIONS, ['dissolve', 'push']);
  assert.equal(sanitizeProjectorSettings({ transitionStyle: 'push' }).transitionStyle, 'push');
  assert.equal(sanitizeProjectorSettings({ fadeMs: 50 }).fadeMs, 100);
  assert.equal(sanitizeProjectorSettings({ fadeMs: 5000 }).fadeMs, 1000);
});

// ---- Background on every slide ----

test('with the background on every slide, a staged background goes on screen at once; without it, it waits for Take', () => {
  const off = run(initialLiveState(), { type: 'background/stage', media: MEDIA });
  assert.equal(off.projector.background.staged, MEDIA);
  assert.equal(off.projector.background.live, null, 'staging alone does not show it');
  const on = run(initialLiveState(), { type: 'settings/projector', value: { backgroundEverywhere: true } }, { type: 'background/stage', media: MEDIA });
  assert.equal(on.projector.background.live, MEDIA);
});

test('while the projector is paused, a staged background waits even with the background on every slide', () => {
  const s = run(
    initialLiveState(),
    { type: 'output/set', output: 'projector', on: true },
    { type: 'settings/projector', value: { backgroundEverywhere: true } },
    { type: 'projector/pause', paused: true },
    { type: 'background/stage', media: MEDIA },
  );
  assert.equal(s.projector.background.live, null);
  assert.equal(s.projector.background.staged, MEDIA);
});

test('the projector puts the shared background behind the Live set slides, and their own background steps aside', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /const sharedBackground = Boolean\(background && settings\.backgroundEverywhere\);/);
  assert.match(view, /shownFrame\.kind === 'pw' && !sharedBackground/, 'the Live slide background layer hides');
  assert.match(view, /<FrameView frame=\{shownFrame\} sharedBackground=\{sharedBackground\} \/>/);
  assert.match(read('src/media/MediaLibrary.tsx'), /<BackgroundEverywhereToggle \/>/, 'the switch is in the Media Library header');
  assert.match(read('src/operator/BackgroundPanel.tsx'), /<BackgroundEverywhereToggle compact \/>/, 'and in the Live panel background panel');
  assert.match(read('src/operator/BackgroundEverywhereToggle.tsx'), /bridge\.projector\.save\(\{ backgroundEverywhere: !on \}\)/);
});

// ---- Advanced mode ----

test('the text styling is part of the on-air look, so a paused projector keeps the styling it had', () => {
  let s = run(
    initialLiveState(),
    { type: 'output/set', output: 'projector', on: true },
    { type: 'settings/projector', value: { advancedOutput: true, textColor: '#FFCC00' } },
    { type: 'projector/pause', paused: true },
    { type: 'settings/projector', value: { textColor: '#00FF00', textOutline: 0.5 } },
  );
  const aired = applyLook(s);
  assert.equal(aired.settings.textColor, '#FFCC00', 'the audience keeps the colour from the pause');
  assert.equal(aired.settings.textOutline, 0);
  assert.equal(s.settings.textColor, '#00FF00', 'the working settings have the change');
  s = run(s, { type: 'projector/pause', paused: false });
  assert.equal(applyLook(s).settings.textColor, '#00FF00', 'resuming shows the change');
});

test('a look captured before the text styling existed leaves the working styling in place', () => {
  const s = run(initialLiveState(), { type: 'settings/projector', value: { advancedOutput: true, textColor: '#FFCC00' } });
  const old = { ...s, projector: { ...s.projector, paused: true, look: { slideFont: null, slideFontScale: 1, introSlideMode: s.introSlideMode, welcome: s.welcome } } };
  assert.equal(applyLook(old).settings.textColor, '#FFCC00');
});

test('Advanced mode draws through one class and custom properties, and only when it is on', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /if \(!settings\.advancedOutput\) return \{ className: '', style: \{\} \};/);
  const css = read('src/styles.css');
  assert.match(css, /\.apcc-advanced-text \* \{[\s\S]*?text-shadow: var\(--apcc-text-shadow\) !important;[\s\S]*?-webkit-text-stroke: var\(--apcc-text-stroke\);/);
  assert.match(css, /\.apcc-advanced-text\.apcc-text-color \* \{[\s\S]*?color: var\(--apcc-text-color\) !important;/);
  const panel = read('src/settings/OutputSettingsPanel.tsx');
  for (const label of ['Advanced mode', 'Drop shadow strength', 'Outline opacity', 'Text colour', 'Transition style', 'Slide font', 'Text size']) {
    assert.ok(panel.includes(`"${label}"`), `the panel has ${label}`);
  }
  assert.match(read('src/settings/ProjectorSettings.tsx'), /<OutputSettingsPanel settings=\{settings\} save=\{save\} isDefault=\{isDefault\} resetTo=\{resetTo\} \/>/);
});

// ---- Transitions ----

test('dissolve and push keep the leaving slide on screen under the new one for the length of the transition', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /setLeaving\(\{ frame: before\.frame, serial: before\.serial \}\);\s+const timer = window\.setTimeout\(\(\) => setLeaving\(null\), fadeMs\);/);
  assert.match(view, /animation: exitAnimation\(settings\.transitionStyle, transitionMs\)/);
  const css = read('src/styles.css');
  for (const name of ['apcc-enter-push', 'apcc-exit-fade', 'apcc-exit-push']) assert.match(css, new RegExp(`@keyframes ${name} \\{`));
  // Only opacity and transform animate, which the compositor runs off the main thread.
  assert.doesNotMatch(css.slice(css.indexOf('@keyframes apcc-enter-push'), css.indexOf('.apcc-advanced-text')), /left:|top:|width:|height:/);
});

test('an edit to the words on screen swaps them in place: the same song and stanza never replays a transition', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /if \(frame\.kind === 'lyrics' && frame\.key && frame\.song\) return `lyrics\|\$\{frame\.key\}\|\$\{frame\.song\.position\}`;/);
  assert.match(view, /slideIdentity\(before\.frame\) === slideIdentity\(frame\)\) \{\s+current\.current = \{ frame, serial: before\.serial \};\s+return;/);
  // The shade over a background holds still between slides, outside the slide layers.
  assert.ok(view.indexOf('{background && <div className="absolute inset-0 bg-black/40" />}') < view.indexOf('key={serial}'));
});

// ---- Editing the song on air ----

test('the cue panel edits and adds stanzas through the song, keeping its filing, and the projector follows the edit in place', () => {
  const hot = read('src/praise-worship/useLiveHotEditor.ts');
  assert.match(hot, /bridge\.lyrics\.editHymn\(hymn\.id, \{/);
  assert.match(hot, /songCategory: hymn\.songCategory,\n\s+primaryCategory: hymn\.primaryCategory,/);
  assert.doesNotMatch(hot, /category: hymn\.category/, 'the Mass slot is not sent, so the service keeps it');
  assert.match(hot, /const at = after === null \? hymn\.stanzas\.length : Math\.min\(after \+ 1, hymn\.stanzas\.length\);/, 'a new stanza goes after the one on screen');
  assert.match(hot, /SECTION_LINE = \/\^\\s\*\\\[\[\^\\\]\]\+\\\]\\s\*\$\/m/, 'a bracket line cannot slip a new section into a stanza');
  const panel = read('src/praise-worship/QuickCuePanel.tsx');
  assert.match(panel, /onDoubleClick=\{hot\.locked \? undefined : \(\) => hot\.startEdit\(i\)\}/);
  assert.match(panel, /useLiveHotEditor\(cue, quick\.adoptCue\)/);
  assert.match(panel, /if \(busyEditing \|\| document\.querySelector/, 'Shift + Escape waits while a stanza is being edited');
  // The song watch refreshes the live lyric frame after any edit of its song.
  assert.match(read('src/live/liveSongs.ts'), /dispatch\(\{ type: 'projector\/refresh', key: lyricsFrame\.key \?\? `song:\$\{id\}`, frame: result\.frame \}\)/);
});
