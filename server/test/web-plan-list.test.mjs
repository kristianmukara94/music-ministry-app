// Tests for the plans list and the editor's controls on the web (web/js/plan-model.js): where a row links, the tab counts, the list
// filters, and which controls are enabled. The page wiring is checked in a browser against the local server. Run with:
//   node --test server/test/web-plan-list.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const model = await import(pathToFileURL(path.join(here, '..', '..', 'web', 'js', 'plan-model.js')).href);

const MASS = { id: '10000000-0000-4000-8000-000000000001', name: 'All Saints, Sunday Mass', liturgical_date: '2026-11-01', updated_at: '2026-10-27T09:00:00.000Z', kind: 'mass' };
const PRAISE = { id: '10000000-0000-4000-8000-000000000002', name: 'Charismatic Prayer Night', liturgical_date: '2026-11-06', updated_at: '2026-10-27T10:00:00.000Z', kind: 'pw' };
const UNTYPED = { id: '10000000-0000-4000-8000-000000000003', name: 'Untyped Plan', liturgical_date: '2026-11-15', updated_at: '2026-10-27T11:00:00.000Z', kind: null };
const PLANS = [MASS, PRAISE, UNTYPED];

test('a row links to the editor with the plan id in the address', () => {
  assert.equal(model.editorPathFor(MASS), `plan/mass.html?id=${MASS.id}`);
  assert.equal(model.editorPathFor(PRAISE), `plan/praise.html?id=${PRAISE.id}`);
});

test('a plan with no type recorded opens the Mass editor, which is the one that can show any plan', () => {
  assert.equal(model.editorPathFor(UNTYPED), `plan/mass.html?id=${UNTYPED.id}`);
});

test('the id in the address is encoded, so nothing else can be put in it', () => {
  assert.equal(model.editorPathFor({ id: 'a&b=c', kind: 'mass' }), 'plan/mass.html?id=a%26b%3Dc');
});

test('the tab counts are the real plans: all, Mass (including untyped), and Praise & Worship', () => {
  assert.deepEqual(model.tabCounts(PLANS), { all: 3, mass: 2, pw: 1 });
  assert.deepEqual(model.tabCounts([]), { all: 0, mass: 0, pw: 0 });
});

test('the list filters by tab, then by the search text on the name', () => {
  assert.deepEqual(model.visiblePlans(PLANS, { tab: 'all' }).map((p) => p.name), PLANS.map((p) => p.name));
  assert.deepEqual(model.visiblePlans(PLANS, { tab: 'pw' }).map((p) => p.id), [PRAISE.id]);
  assert.deepEqual(model.visiblePlans(PLANS, { tab: 'mass' }).map((p) => p.id), [MASS.id, UNTYPED.id]);
  assert.deepEqual(model.visiblePlans(PLANS, { tab: 'all', query: '  prayer ' }).map((p) => p.id), [PRAISE.id]);
  assert.deepEqual(model.visiblePlans(PLANS, { tab: 'pw', query: 'mass' }), [], 'the tab and the search both apply');
});

test('the editor controls: Save needs an open plan and a planner or admin; Discard needs an open plan', () => {
  assert.deepEqual(model.editorControls({ plan: MASS, canEdit: true, saving: false }), { save: true, discard: true, viewOnly: false });
});

test('with no plan open, Save and Discard are both disabled', () => {
  assert.deepEqual(model.editorControls({ plan: null, canEdit: true, saving: false }), { save: false, discard: false, viewOnly: false });
});

test('a viewer sees the plan with Save disabled and the view-only note on', () => {
  assert.deepEqual(model.editorControls({ plan: MASS, canEdit: false, saving: false }), { save: false, discard: true, viewOnly: true });
});

test('Save is disabled for the whole of a save', () => {
  assert.equal(model.editorControls({ plan: MASS, canEdit: true, saving: true }).save, false);
  assert.equal(model.editorControls({ plan: MASS, canEdit: true, saving: true }).discard, false);
});

test('an empty list stays empty in the model: nothing is invented to fill it', () => {
  assert.deepEqual(model.visiblePlans([], { tab: 'all' }), []);
  assert.deepEqual(model.tabCounts([]).all, 0);
});
