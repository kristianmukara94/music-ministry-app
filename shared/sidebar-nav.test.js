// The left sidebar: one current navigation item per view, the Alt+1…Alt+4 page keys and their guards, the lineup count on Go Live, and the
// footer output pills. Synthetic data only. Run with: node --test shared/sidebar-nav.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { activeNavKey, isTextEntryTarget, lineupCount, NAV_HOTKEYS, navHotkeyCombo, navHotkeyView, outputPills } from './sidebar-nav.js';
import { initialLiveState, liveReducer } from './live.js';
import { comboOf, DEFAULT_SHORTCUTS, isReserved } from './shortcuts.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const side = () => read('src/operator/Sidebar.tsx');

/** Every view the operator window can show (src/state/ui.ts). */
const VIEWS = [...read('src/state/ui.ts').match(/export type ViewKey =([^;]*);/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
/** The sidebar's navigation items, from its groups. */
const ITEMS = [...side().match(/const NAV_GROUPS[^\n]*= \[\n([\s\S]*?)\n\];/)[1].matchAll(/items: \[([^\]]*)\]/g)]
  .flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));

// ── One current item ──────────────────────────────────────────────────────

test('the Service Console leads the navigation, above Liturgy, with no section label', () => {
  assert.equal(ITEMS[0], 'dashboard');
  assert.match(side(), /\{ key: null, items: \['dashboard'\] \},\n\s+\{ key: 'nav\.group\.liturgy'/);
  assert.match(read('src/i18n/strings.ts'), /'nav\.dashboard': 'Service Console',/);
});

test('every view marks at most one navigation item, and only Settings (the gear) marks none', () => {
  assert.ok(VIEWS.length >= 13, 'the view list was read');
  for (const view of VIEWS) {
    const current = ITEMS.filter((key) => activeNavKey(view) === key);
    assert.equal(current.length, view === 'settings' ? 0 : 1, view);
  }
  assert.equal(activeNavKey('whiteboard'), 'announcements');
  assert.equal(activeNavKey('praiseWorship'), 'planner');
  assert.equal(activeNavKey('dashboard'), 'dashboard');
});

test('only a navigation item and the Settings gear can be the current page, and only the current one is a solid pill', () => {
  const src = side();
  const marks = src.match(/aria-current=\{[^}]*\}/g);
  assert.deepEqual(marks, ["aria-current={view === 'settings' ? 'page' : undefined}", "aria-current={active ? 'page' : undefined}"]);
  assert.match(src, /const active = activeKey === key;/);
  assert.equal(src.match(/bg-accent font-semibold text-on-accent/g)?.length, 1);
  // Idle rows get a faint wash on hover, and keyboard focus is an outline: neither looks like the solid pill.
  const idle = src.match(/: 'border-transparent font-medium text-fg\/85 ([^']*)'/)[1];
  assert.doesNotMatch(idle, /bg-accent|text-on-accent/);
  assert.match(src, /focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none/);
  assert.doesNotMatch(src, /(?<![\w-])focus:(bg|border|ring)/, 'a mouse-focused row never stays highlighted');
});

test('the wordmark and the sidebar have no ambient glow', () => {
  const src = side();
  assert.doesNotMatch(src, /text-shadow/);
  assert.doesNotMatch(src, /radial-gradient/);
  assert.match(src, /border-r border-fg\/\[0\.08\] bg-canvas/);
});

// ── Page keys ─────────────────────────────────────────────────────────────

const field = { closest: (selector) => (selector.includes('textarea') ? {} : null) };
const plain = { closest: () => null };
const press = (digit, extra = {}) => ({ key: String(digit), code: `Digit${digit}`, altKey: true, target: plain, ...extra });

test('Alt+1 to Alt+4 open the Service Console, Go Live, Song Lyrics and the Planner', () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => navHotkeyView(press(n))), ['dashboard', 'goLive', 'lyrics', 'planner']);
  assert.equal(navHotkeyView(press(5)), null);
  assert.equal(navHotkeyCombo('goLive'), 'Alt+2');
  assert.equal(navHotkeyCombo('media'), null);
  assert.equal(navHotkeyCombo('toString'), null);
});

test('the page keys are ignored while typing in a field', () => {
  assert.equal(isTextEntryTarget(field), true);
  assert.equal(isTextEntryTarget(plain), false);
  assert.equal(isTextEntryTarget(null), false);
  for (const n of [1, 2, 3, 4]) assert.equal(navHotkeyView(press(n, { target: field })), null);
});

test('AltGr, other modifiers, repeats, handled keys and the number pad are left alone', () => {
  assert.equal(navHotkeyView(press(1, { ctrlKey: true })), null, 'AltGr arrives as Ctrl+Alt');
  assert.equal(navHotkeyView(press(1, { shiftKey: true })), null);
  assert.equal(navHotkeyView(press(1, { metaKey: true })), null);
  assert.equal(navHotkeyView(press(1, { altKey: false })), null);
  assert.equal(navHotkeyView(press(1, { repeat: true })), null);
  assert.equal(navHotkeyView(press(1, { defaultPrevented: true })), null);
  assert.equal(navHotkeyView(press(1, { code: 'Numpad1' })), null, 'Alt codes');
  assert.equal(navHotkeyView(null), null);
});

test('the page keys clash with no default shortcut and cannot be newly assigned', () => {
  for (const view of Object.keys(NAV_HOTKEYS)) {
    const combo = navHotkeyCombo(view);
    assert.equal(comboOf(press(NAV_HOTKEYS[view])), combo);
    assert.equal(isReserved(combo), true, combo);
    assert.equal(DEFAULT_SHORTCUTS.some((s) => s.key === combo), false, combo);
  }
});

test('the operator window runs saved shortcuts first, then the page keys, never behind a dialog', () => {
  const app = read('src/operator/OperatorApp.tsx');
  const typing = app.indexOf('if (typing || ui.paletteOpen) return;');
  const saved = app.indexOf('runShortcut(shortcut);');
  const page = app.indexOf('const page = navHotkeyView(e);');
  assert.ok(typing >= 0 && typing < saved && saved < page);
  assert.match(app.slice(page), /^const page = navHotkeyView\(e\);\n\s+if \(page\) \{\n\s+if \(document\.querySelector\('\[aria-modal="true"\]'\)\) return;/);
});

test('the four primary items show their key unless an older shortcut owns it', () => {
  assert.match(side(), /const hint = combo && !shortcuts\.some\(\(s\) => s\.key === combo\) \? combo : null;/);
  assert.match(side(), /aria-keyshortcuts=\{hint \?\? undefined\}/);
});

// ── Lineup count ──────────────────────────────────────────────────────────

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, label: 'Sample Mass Item' }));
const segments = (n) => Array.from({ length: n }, (_, i) => ({ key: `seg-${i}`, name: 'Sample Segment', minutes: 1 }));

test('Go Live counts the loaded lineup: the queue, or the Praise & Worship segments while it is on air', () => {
  assert.equal(lineupCount({ queue: [], pw: null }), 0);
  assert.equal(lineupCount({ queue: rows(3), pw: null }), 3);
  assert.equal(lineupCount({ queue: rows(3), pw: { onAir: false }, pwLineup: segments(5) }), 3);
  assert.equal(lineupCount({ queue: rows(3), pw: { onAir: true }, pwLineup: segments(5) }), 5);
  assert.equal(lineupCount({ queue: [], pw: { onAir: false }, pwLineup: segments(2) }), 2);
  assert.equal(lineupCount({ queue: [], pw: null, pwLineup: segments(2) }), 0, 'an ended session leaves no count');
  assert.match(side(), /const queued = useLive\(\(s\) => lineupCount\(s\.state\)\);/);
});

// ── Output pills ──────────────────────────────────────────────────────────

const pill = (state, key, locked) => outputPills(state, locked).find((p) => p.key === key);
const click = (state, key) => liveReducer(state, pill(state, key).intent.action);
const BAND = { line1: 'Sample Name', line2: 'Sample Role' };

test('the Projector and Preview pills toggle their output and back', () => {
  for (const key of ['projector', 'preview']) {
    const off = initialLiveState();
    assert.equal(pill(off, key).on, false);
    const on = click(off, key);
    assert.equal(pill(on, key).on, true, key);
    assert.equal(pill(click(on, key), key).on, false, key);
  }
});

test('the Lower 3rd pill opens the editor when there is none, and otherwise shows and hides it', () => {
  const empty = initialLiveState();
  assert.deepEqual(pill(empty, 'lowerThird').intent, { type: 'openLowerThird' });
  assert.equal(pill(empty, 'lowerThird').ready, false);
  const staged = { ...empty, lowerThird: { ...empty.lowerThird, staged: BAND } };
  const live = click(staged, 'lowerThird');
  assert.equal(pill(live, 'lowerThird').on, true);
  assert.equal(pill(click(live, 'lowerThird'), 'lowerThird').on, false);
});

test('a paused output reads as paused, only while it is on', () => {
  const base = initialLiveState();
  const paused = { ...base, outputs: { ...base.outputs, projector: true }, projector: { ...base.projector, paused: true } };
  assert.equal(pill(paused, 'projector').paused, true);
  assert.equal(pill({ ...paused, outputs: base.outputs }, 'projector').paused, false);
  const band = { ...base, lowerThird: { ...base.lowerThird, live: BAND, staged: BAND, paused: true } };
  assert.equal(pill(band, 'lowerThird').paused, true);
  assert.equal(pill(base, 'preview').paused, false);
});

test('an expired license closes the way on, never the way off, and never the preview', () => {
  const off = initialLiveState();
  assert.equal(pill(off, 'projector', true).disabled, true);
  assert.equal(pill(off, 'lowerThird', true).disabled, true);
  assert.equal(pill(off, 'preview', true).disabled, false);
  const on = { ...off, outputs: { ...off.outputs, projector: true }, lowerThird: { ...off.lowerThird, live: BAND, staged: BAND } };
  assert.equal(pill(on, 'projector', true).disabled, false);
  assert.equal(pill(on, 'lowerThird', true).disabled, false);
});

test('the footer pills are labelled toggle buttons with tooltips and green or amber dots', () => {
  const src = side();
  assert.match(src, /<button type="button" onClick=\{onClick\} disabled=\{pill\.disabled\} aria-pressed=\{pill\.on\} aria-label=\{name\}\n\s+title=\{`\$\{name\}\. \$\{tip\}`\}/);
  assert.match(src, /dot: 'bg-warn /);
  assert.match(src, /dot: 'animate-pulse bg-ok /);
  assert.match(src, /outputPills\(\{ outputs, projector: \{ paused: projectorPaused \}, lowerThird \}, locked\)/);
  assert.match(src, /const locked = useProjectionLocked\(\);/);
});
