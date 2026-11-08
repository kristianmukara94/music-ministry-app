// The Sanctuary Alert: preset formatting, what the reducer keeps, and that pushing or clearing an alert never disturbs the Holy Mass on air.
// Run with: node --test shared/sanctuary-alert.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALERT_TEXT_MAX,
  alertExpired,
  cleanAlertText,
  formatPlate,
  formatTag,
  newAlertId,
  presetText,
  sanitizeAlert,
} from './sanctuary-alert.js';
import { initialLiveState, liveReducer } from './live.js';
import { comboOf, isReserved } from './shortcuts.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);
const show = (value, now = 1_000) => ({ type: 'sanctuaryAlert/show', value, now });

// ---- Presets ----

test('a plate is upper case letters, digits, single spaces and hyphens, at most 10 characters', () => {
  assert.equal(formatPlate('abc 1234'), 'ABC 1234');
  assert.equal(formatPlate('  nbc-12#3!'), 'NBC-123');
  assert.equal(formatPlate('a   b'), 'A B');
  assert.equal(formatPlate('abcdefghijklmnop'), 'ABCDEFGHIJ');
  assert.equal(formatPlate(null), '');
});

test('a nursery tag is upper case letters and digits only, at most 6', () => {
  assert.equal(formatTag('#12'), '12');
  assert.equal(formatTag('a-12'), 'A12');
  assert.equal(formatTag('1234567'), '123456');
});

test('each preset composes its notice, and an empty field composes nothing', () => {
  assert.match(presetText('car', 'abc 1234'), /ABC 1234 is blocking the driveway/);
  assert.match(presetText('nursery', '#7'), /Nursery Tag #7/);
  assert.equal(presetText('car', '  '), '');
  assert.equal(presetText('nursery', '##'), '');
  assert.ok(presetText('booth', ''));
  for (const id of ['car', 'nursery']) assert.ok(presetText(id, 'ZZZZZZZZZZ').length <= ALERT_TEXT_MAX);
});

// ---- Sanitising ----

test('the text is one trimmed line of at most 120 characters', () => {
  assert.equal(cleanAlertText('  Hello\n\n  world  '), 'Hello world');
  assert.equal(cleanAlertText('x'.repeat(300)).length, ALERT_TEXT_MAX);
});

test('an alert gets its expiry from its duration; Until Dismissed has none', () => {
  const a = sanitizeAlert({ id: 'a1', text: 'Hi', severity: 'urgent', durationSeconds: 10 }, 5_000);
  assert.deepEqual(a, { id: 'a1', text: 'Hi', severity: 'urgent', durationSeconds: 10, shownAt: 5_000, expiresAt: 15_000 });
  const b = sanitizeAlert({ text: 'Hi', durationSeconds: null }, 5_000);
  assert.equal(b.expiresAt, null);
  assert.equal(alertExpired(b, Number.MAX_SAFE_INTEGER), false);
  assert.equal(alertExpired(a, 14_999), false);
  assert.equal(alertExpired(a, 15_000), true);
});

test('bad input falls back: unknown severity is a warning, an odd duration is the default 20s, empty text is no alert', () => {
  const a = sanitizeAlert({ text: 'Hi', severity: 'panic', durationSeconds: 999 }, 0);
  assert.equal(a.severity, 'warning');
  assert.equal(a.durationSeconds, 20);
  assert.equal(sanitizeAlert({ text: '   ' }, 0), null);
  assert.equal(sanitizeAlert(null, 0), null);
});

test('new ids differ, even within the same millisecond', () => {
  assert.notEqual(newAlertId(1), newAlertId(1));
});

// ---- Reducer ----

test('show puts the alert up and replaces the one already up; empty text changes nothing', () => {
  const s0 = initialLiveState();
  assert.equal(s0.sanctuaryAlert, null);
  const s1 = run(s0, show({ id: 'a', text: 'First' }));
  assert.equal(s1.sanctuaryAlert.text, 'First');
  const s2 = run(s1, show({ id: 'b', text: 'Second' }));
  assert.equal(s2.sanctuaryAlert.id, 'b');
  assert.equal(run(s2, show({ text: '' })), s2);
});

test('clear with an id only clears that alert, so a late timer leaves a newer alert up', () => {
  const s = run(initialLiveState(), show({ id: 'a', text: 'Old' }), show({ id: 'b', text: 'New' }));
  assert.equal(run(s, { type: 'sanctuaryAlert/clear', id: 'a' }), s);
  assert.equal(run(s, { type: 'sanctuaryAlert/clear', id: 'b' }).sanctuaryAlert, null);
  assert.equal(run(s, { type: 'sanctuaryAlert/clear' }).sanctuaryAlert, null);
  const empty = initialLiveState();
  assert.equal(run(empty, { type: 'sanctuaryAlert/clear' }), empty);
});

// ---- Zero slide disruption ----

function massOnAir() {
  const slides = Array.from({ length: 4 }, (_, i) => ({ title: `S${i + 1}`, src: `apcc-media://slide/${i + 1}` }));
  const items = ['Entrance', 'Kyrie', 'Gloria', 'Psalm'].map((label, i) => ({ id: String(i), label, module: 'massOrder', sourceId: String(i), stale: false }));
  const frame = { kind: 'image', title: 'S1', src: slides[0].src, deck: { slides, index: 0 } };
  return run(
    initialLiveState(),
    { type: 'output/set', output: 'projector', on: true },
    { type: 'queue/set', items, planId: 1 },
    { type: 'queue/cursor', index: 2 },
    { type: 'projector/stage', frame },
    { type: 'projector/take', source: 'MASS_QUEUE' },
    { type: 'projector/step', delta: 1 },
    { type: 'lowerThird/show', value: { line1: 'Gloria', line2: '' } },
  );
}

test('pushing and clearing an alert over a live Holy Mass changes nothing but the alert', () => {
  const mass = massOnAir();
  const pushed = run(mass, show({ id: 'car', text: 'Vehicle ABC 1234 is blocking the driveway.' }));
  const cleared = run(pushed, { type: 'sanctuaryAlert/clear', id: 'car' });
  for (const s of [pushed, cleared]) {
    for (const key of Object.keys(mass)) {
      if (key === 'rev' || key === 'sanctuaryAlert') continue;
      // The very same objects: the projector, queue, cursor and lower third are untouched, so nothing on screen re-renders or resets.
      assert.equal(s[key], mass[key], `${key} changed`);
    }
  }
});

test('the slides keep stepping while an alert is up, and the alert stays up through the steps', () => {
  let s = run(massOnAir(), show({ id: 'tag', text: 'Parent of Nursery Tag #12', durationSeconds: null }));
  assert.equal(s.projector.live.deck.index, 1);
  s = run(s, { type: 'projector/step', delta: 1 });
  assert.equal(s.projector.live.deck.index, 2);
  s = run(s, { type: 'projector/step', delta: -1 }, { type: 'projector/step', delta: -1 });
  assert.equal(s.projector.live.deck.index, 0);
  assert.equal(s.queueCursor, 2);
  assert.equal(s.sanctuaryAlert.id, 'tag');
});

test('Blackout and Stop leave the alert up: it is its own layer, cleared only by its own button or timer', () => {
  const s = run(massOnAir(), show({ id: 'x', text: 'Notice' }));
  assert.equal(run(s, { type: 'projector/blackout' }).sanctuaryAlert.id, 'x');
  assert.equal(run(s, { type: 'stop' }).sanctuaryAlert.id, 'x');
});

// ---- Hotkey ----

test('Ctrl+Shift+A and Cmd+Shift+A are reserved, so no shortcut can take them', () => {
  assert.equal(comboOf({ key: 'A', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+A');
  assert.equal(comboOf({ key: 'A', metaKey: true, shiftKey: true }), 'Shift+Meta+A');
  assert.ok(isReserved('Ctrl+Shift+A'));
  assert.ok(isReserved('Shift+Meta+A'));
});

// ---- Wiring (renderer) ----

test('the projector draws the alert as the top layer of the stage, over Blackout, and the modal mounts in the console', () => {
  const projector = read('src/output/ProjectorView.tsx');
  assert.match(projector, /const alertLive = outputShowing \? sanctuaryAlert : null;/);
  // Drawn after the lower third and the note callout, so it paints over them.
  const at = (needle) => projector.indexOf(needle);
  assert.ok(at('<SanctuaryAlertOverlay') > at('<LowerThirdOverlay value='));
  assert.ok(at('<SanctuaryAlertOverlay') > at('<NoteCallout value='));
  const overlay = read('src/output/SanctuaryAlertOverlay.tsx');
  assert.match(overlay, /z-\[70\]/);
  assert.match(overlay, /h-\[10cqh\]/);
  assert.match(overlay, /rgba\(17, 10, 14, 0\.92\)/);
  assert.match(overlay, /cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(overlay, /pointer-events-none/);
  const app = read('src/operator/OperatorApp.tsx');
  assert.match(app, /<SanctuaryAlertModal \/>/);
  assert.match(app, /useSanctuaryAlertHotkey\(\);/);
});

test('Esc closes the modal without clearing the live alert; pushing closes it so the arrows step the Mass again', () => {
  const modal = read('src/operator/SanctuaryAlertModal.tsx');
  const esc = modal.slice(modal.indexOf("e.key === 'Escape'"), modal.indexOf("e.key === 'Enter'"));
  assert.ok(esc.includes('close()'));
  assert.ok(!esc.includes('sanctuaryAlert/clear'));
  const push = modal.slice(modal.indexOf('const push = '), modal.indexOf('const clearLive = '));
  assert.ok(push.includes("type: 'sanctuaryAlert/show'"));
  assert.ok(push.includes('close()'));
  assert.match(modal, /aria-modal="true"/);
});
