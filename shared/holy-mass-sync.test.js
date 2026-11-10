// The Holy Mass Planner's polish: new plans start from the 17-slot templates, plans carry their slots to and from the website, and the
// sections have their Roman Missal names in Tagalog and Cebuano. Run with: node --test shared/holy-mass-sync.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MASS_SLOTS, slotIdOfNumber, slotNumberOf } from './mass-slots.js';
import { plannerT } from './planner-i18n.js';
import { massFromItems, massToItems } from '../web/js/plan-model.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// ---- New plans ----

test('the New plan form offers the two 17-slot templates and nothing of the 31-step Ordinary', () => {
  const form = read('src/planner/NewPlanForm.tsx');
  assert.match(form, /NEW_PLAN_TEMPLATES\.map/);
  // Standard Sunday is the default; only a weekday picked on the planner's calendar starts the form on Weekday.
  assert.match(form, /initialTemplate = 'standard'/, 'Standard Sunday is the default');
  assert.match(form, /useState<NewPlanTemplate>\(initialTemplate\)/);
  const templates = read('src/planner/templates.ts');
  assert.match(templates, /export const NEW_PLAN_TEMPLATES: NewPlanTemplate\[\] = \['standard', 'weekday'\];/);
  for (const gone of ['seasonItems', 'SEASONS', 'stepSourceId', 'MASS_FLOW']) assert.doesNotMatch(templates, new RegExp(gone), `${gone} is gone`);
  const planner = read('src/planner/MassPlanner.tsx');
  assert.doesNotMatch(planner, /seasonItems|setSeason|SEASON_KEY/);
  // A plan is made only from the planner's calendar: the editor has no New plan form of its own.
  assert.doesNotMatch(planner, /<NewPlanForm\b|newPlanDraft/);
  assert.match(read('src/planner/PlannerView.tsx'), /await createMassPlan\(\{ name: name\.slice\(0, 120\), liturgicalDate: iso, template: templateFor\(iso\) \}, lang\)/);
  assert.match(planner, /const fills = builtInItems\(template, lang\);\s+if \(fills\.length > 0\) await api\.save\(created\.id, fills\);/, 'Standard Sunday stores nothing; Weekday stores its slots');
  for (const key of ['season_blank', 'season_advent', 'season_lent', 'season_ordinary', 'seasonLabel', 'seasonGloriaOmitted']) {
    assert.equal(plannerT('en', key), key, `${key} is no longer a label`);
  }
});

test('a template\'s items all fill slots, so a new plan has nothing among the additional items', () => {
  const templates = read('src/planner/templates.ts');
  assert.match(templates, /items = placeInSlot\(items, fill\.slot,/);
  assert.match(read('src/planner/MassTemplates.tsx'), /import \{ builtInItems \} from '\.\/templates';/, 'the Templates panel uses the same items');
});

// ---- Slots on the website ----

test('a slot travels as its number, 1 to 28, and comes back as the same slot', () => {
  for (const slot of MASS_SLOTS) {
    assert.equal(slotNumberOf(slot.id), slot.number);
    assert.equal(slotIdOfNumber(slot.number), slot.id);
  }
  for (const bad of [0, 29, 1.5, '3', null, undefined]) assert.equal(slotIdOfNumber(bad), null, String(bad));
  assert.equal(slotNumberOf('nope'), null);
  assert.equal(slotNumberOf(null), null);
});

test('the laptop sends an item\'s slot only when it has one, and never folds it into the item\'s key', () => {
  const map = read('electron/plan-sync-map.js');
  assert.match(map, /const slot = slotNumberOf\(row\.slot\);\s+return slot === null \? item : \{ \.\.\.item, slot \};/);
  // The key is built before the slot is added, from what the item is.
  assert.match(map, /const derived = itemKey\(\[row\.module, row\.sourceId, row\.block, seen\]\);/);
});

test('a pull takes the website\'s slot when it names one, keeps the laptop\'s otherwise, and lets one item hold a slot', () => {
  const store = read('electron/plan-sync-store.js');
  assert.match(store, /const slot = slotIdOfNumber\(item\.slot\) \?\? kept\?\.row\.slot \?\? null;/);
  assert.match(store, /const slot = e\.row\.slot && !taken\.has\(e\.row\.slot\) \? e\.row\.slot : null;/);
  assert.match(store, /source_id, label, display_order, slot\) VALUES/);
  assert.match(read('electron/plan-sync.js'), /i\.note \?\? null, i\.slot \?\? null\]/, 'a change of slot alone is a change');
});

test('the website accepts a slot from 1 to 28', () => {
  const server = read('server/lib/plan-sync.js');
  assert.match(server, /const ITEM_FIELDS = \[[^\]]*'slot'[,\]]/);
  assert.match(server, /item\.slot < 1 \|\| item\.slot > MASS_SLOT_COUNT/);
  assert.match(server, /export const MASS_SLOT_COUNT = 28;/);
});

test('the website\'s editor carries a step\'s slot through an edit, and leaves the laptop\'s own items as they are', () => {
  const steps = [{ n: 1, name: 'Entrance', kind: 'song', category: '', group: 'introductory' }];
  const items = [
    { key: '1', group: 'introductory', order: 1, kind: 'song', songId: 'a', slot: 1 },
    { key: 'lyrics.9.word.1', group: 'word', order: 2, kind: 'song', songId: 'b', slot: 4 },
  ];
  const state = massFromItems(items, steps);
  const back = massToItems(state, steps);
  assert.deepEqual(back.map((i) => [i.key, i.slot]), [['1', 1], ['lyrics.9.word.1', 4]]);
});

test('a website from before slots refuses the field, and the laptop sends the plan again without it', () => {
  const device = read('electron/cloud-device.js');
  assert.match(device, /const OLD_SITE = \/field the planner does not accept\/i;/);
  assert.match(device, /const createPlan = \(plan\) => retryWithoutSlots\(createPlanOnce, plan\);/);
  assert.match(device, /const pushPlan = \(plan\) => retryWithoutSlots\(pushPlanOnce, plan\);/);
});

// ---- Section names ----

test('the five sections have their Roman Missal names in Tagalog and Cebuano', () => {
  const names = (lang) => ['introductory', 'word', 'eucharist', 'communion', 'concluding'].map((b) => plannerT(lang, `block_${b}`));
  assert.deepEqual(names('tl'), ['Panimulang Rito', 'Liturhiya ng Salita ng Diyos', 'Liturhiya ng Banal na Eukaristiya', 'Rito ng Komunyon', 'Pangwakas na Rito']);
  assert.deepEqual(names('ceb'), ['Mga Rito sa Pagsugod', 'Liturhiya sa Pulong', 'Liturhiya sa Sagradong Eukaristiya', 'Rito sa Komunyon', 'Panapos nga Rito']);
  assert.deepEqual(names('en'), ['Introductory Rites', 'Liturgy of the Word', 'Liturgy of the Eucharist', 'Communion', 'Concluding Rites']);
});
