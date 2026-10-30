// Tests for the shortcut helpers. Run with: node --test shared/shortcuts.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboOf, displayCombo, findConflict, isReserved, sanitizeShortcuts, shortcutsFromKeymap, DEFAULT_SHORTCUTS } from './shortcuts.js';

test('a function key is its own name', () => {
  assert.equal(comboOf({ key: 'F9' }), 'F9');
  assert.equal(comboOf({ key: 'F12' }), 'F12');
});

test('navigation keys and the space bar keep a readable name', () => {
  assert.equal(comboOf({ key: 'PageDown' }), 'PageDown');
  assert.equal(comboOf({ key: ' ' }), 'Space');
});

test('letters are written in upper case, with Shift only when it was held', () => {
  assert.equal(comboOf({ key: 'b' }), 'B');
  assert.equal(comboOf({ key: 'B', shiftKey: true }), 'Shift+B');
});

test('a printable symbol does not repeat Shift', () => {
  assert.equal(comboOf({ key: '!', shiftKey: true }), '!');
});

test('modifiers are written in a fixed order', () => {
  assert.equal(comboOf({ key: 'b', ctrlKey: true }), 'Ctrl+B');
  assert.equal(comboOf({ key: 'ArrowRight', shiftKey: true, altKey: true, ctrlKey: true }), 'Ctrl+Alt+Shift+ArrowRight');
});

test('a modifier on its own is not a shortcut yet', () => {
  for (const key of ['Control', 'Shift', 'Alt', 'Meta']) assert.equal(comboOf({ key, ctrlKey: true }), null);
});

test('the combos the app uses for itself are reserved', () => {
  assert.ok(isReserved('Ctrl+K'));
  assert.ok(isReserved('Ctrl+Shift+F'));
  assert.ok(!isReserved('F9'));
});

test('keycaps print short names', () => {
  assert.equal(displayCombo('PageDown'), 'PgDn');
  assert.equal(displayCombo('Ctrl+ArrowRight'), 'Ctrl+→');
  assert.equal(displayCombo(''), '—');
});

test('the old one-key-per-action settings become shortcuts, and unbound actions are dropped', () => {
  const list = shortcutsFromKeymap({ announcements: 'F9', welcome: '', blackout: 'b', clear: 'F12' });
  assert.deepEqual(list.map((s) => [s.actionId, s.key]), [['announcements', 'F9'], ['blackout', 'B'], ['clear', 'F12']]);
});

test('missing old settings give the defaults', () => {
  assert.deepEqual(shortcutsFromKeymap(undefined), DEFAULT_SHORTCUTS);
});

test('sanitizing drops junk, unknown actions and duplicates, and keeps unassigned shortcuts', () => {
  const valid = ['announcements', 'welcome', 'clear'];
  const list = sanitizeShortcuts(
    [
      { id: 'a', key: 'F9', label: 'A', actionId: 'announcements' },
      { id: 'a', key: 'F8', label: 'again', actionId: 'welcome' },
      { id: 'b', key: 'F9', label: 'same key', actionId: 'welcome' },
      { id: 'c', key: 'F1', label: 'gone', actionId: 'removed-action' },
      { id: 'd', key: '', label: 'waiting', actionId: 'clear' },
      null,
      { id: 'e', key: 5, actionId: 'welcome' },
    ],
    valid,
  );
  assert.deepEqual(list.map((s) => s.id), ['a', 'd']);
  assert.deepEqual(sanitizeShortcuts('nonsense', valid), []);
});

test('a key already in use is reported, except by the shortcut being edited', () => {
  const list = [{ id: 'a', key: 'F9', label: '', actionId: 'x' }, { id: 'b', key: 'F10', label: '', actionId: 'y' }];
  assert.equal(findConflict(list, 'F9', 'b')?.id, 'a');
  assert.equal(findConflict(list, 'F9', 'a'), undefined);
  assert.equal(findConflict(list, ''), undefined);
});
