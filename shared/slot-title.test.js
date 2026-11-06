// The slot title banner ("FIRST READING", "CONGREGATION RESPONSE") above a slide's text: the projector setting that shows or hides it, a Holy Mass
// plan's own choice that overrides it while the plan is loaded, and the small type it is drawn in. Run with: node --test shared/slot-title.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PROJECTOR_SETTINGS_DEFAULTS, sanitizeProjectorSettings } from './projector-settings.js';
import { applyLook, initialLiveState, liveReducer, slotTitleShown } from './live.js';

const view = fs.readFileSync(new URL('../src/output/ProjectorView.tsx', import.meta.url), 'utf8');

test('slot titles are shown by default, and the setting keeps only a true or false', () => {
  assert.equal(PROJECTOR_SETTINGS_DEFAULTS.showSlotTitle, true);
  assert.equal(sanitizeProjectorSettings({}).showSlotTitle, true);
  assert.equal(sanitizeProjectorSettings({ showSlotTitle: false }).showSlotTitle, false);
  assert.equal(sanitizeProjectorSettings({ showSlotTitle: 'no' }).showSlotTitle, true);
});

test('with no plan of its own choice, the projector setting decides', () => {
  const s = initialLiveState();
  assert.equal(slotTitleShown(s), true);
  assert.equal(slotTitleShown({ ...s, settings: { ...s.settings, showSlotTitle: false } }), false);
  // A state saved before the setting existed still shows titles.
  assert.equal(slotTitleShown({ ...s, settings: { ...s.settings, showSlotTitle: undefined } }), true);
});

test('the loaded plan\'s own choice overrides the setting, and loading another plan drops it', () => {
  let s = liveReducer(initialLiveState(), { type: 'queue/set', items: [], planId: 7 });
  s = liveReducer(s, { type: 'queue/slotTitle', planId: 7, show: false });
  assert.equal(slotTitleShown(s), false);
  // A save of the same plan keeps it.
  s = liveReducer(s, { type: 'queue/set', items: [], planId: 7 });
  assert.equal(s.queueSlotTitle, false);
  // A choice for a plan that is not loaded (a read that lost a race) is ignored.
  assert.equal(liveReducer(s, { type: 'queue/slotTitle', planId: 8, show: true }), s);
  // Another plan follows the setting until its own choice is read.
  s = liveReducer(s, { type: 'queue/set', items: [], planId: 8 });
  assert.equal(s.queueSlotTitle, null);
  assert.equal(slotTitleShown(s), true);
  // Null sets the plan back to follow the setting.
  s = liveReducer(s, { type: 'queue/slotTitle', planId: 8, show: true });
  s = liveReducer(s, { type: 'queue/slotTitle', planId: 8, show: null });
  assert.equal(slotTitleShown({ ...s, settings: { ...s.settings, showSlotTitle: false } }), false);
});

test('the congregation\'s on-air picture follows the same choice', () => {
  let s = liveReducer(initialLiveState(), { type: 'queue/set', items: [], planId: 3 });
  s = liveReducer(s, { type: 'queue/slotTitle', planId: 3, show: false });
  assert.equal(slotTitleShown(applyLook(s)), false);
});

test('the projector draws the slot title small, and only when it is shown', () => {
  const size = view.match(/const SLOT_TITLE = '([^']+)'/)?.[1];
  assert.ok(size, 'one shared class for the banner');
  assert.match(size, /text-\[length:min\(0\.85cqw,18px\)\]/, 'about 16px on a 1920 slide, never over 18px');
  assert.match(size, /uppercase/);
  assert.match(view, /const showSlotTitle = useOutput\(slotTitleShown\);/);
  assert.match(view, /\{showSlotTitle && <div className=\{`absolute top-\[4cqh\][^`]*\$\{SLOT_TITLE\}/, 'the deck banner is hidden with the setting');
  assert.match(view, /\{showSlotTitle && <div className=\{`\$\{SLOT_TITLE\} text-gold\/70`\}>Congregation response<\/div>\}/, 'the psalm label is hidden with the setting');
  assert.match(view, /segmentName=\{frame\.massSong && !showSlotTitle \? '' : frame\.segmentName\}/, 'a Holy Mass song card hides its slot name');
  // The old hero-sized banner is gone.
  assert.doesNotMatch(view, /text-\[1\.2cqw\] font-bold tracking-\[0\.2em\] text-white\/50 uppercase/);
});
