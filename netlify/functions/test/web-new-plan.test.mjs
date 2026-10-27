// Tests for the New plan form's rules and who may see it (web/js/plan-model.js). The page itself is checked in a browser.
// Run with: node --test netlify/functions/test/web-new-plan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const model = await import(pathToFileURL(path.join(here, '..', '..', '..', 'web', 'js', 'plan-model.js')).href);

test('the New plan button is for planners and admins only', () => {
  assert.equal(model.canCreatePlans('planner'), true);
  assert.equal(model.canCreatePlans('admin'), true);
  assert.equal(model.canCreatePlans('viewer'), false);
  assert.equal(model.canCreatePlans(undefined), false);
});

test('a valid form passes', () => {
  assert.equal(model.checkNewPlan({ name: 'All Saints, Sunday Mass', date: '2026-11-01', kind: 'mass' }), null);
  assert.equal(model.checkNewPlan({ name: 'Praise night', date: '2026-11-06', kind: 'pw' }), null);
});

test('a blank or overlong name is refused with a plain message', () => {
  assert.equal(model.checkNewPlan({ name: '   ', date: '2026-11-01', kind: 'mass' }), 'Enter a name for the plan.');
  assert.equal(model.checkNewPlan({ name: 'x'.repeat(121), date: '2026-11-01', kind: 'mass' }), 'A plan name can be up to 120 characters.');
});

test('a missing or impossible date is refused', () => {
  assert.equal(model.checkNewPlan({ name: 'Plan', date: '', kind: 'mass' }), 'Choose a date for the plan.');
  assert.equal(model.checkNewPlan({ name: 'Plan', date: '2026-13-40', kind: 'mass' }), 'Choose a date for the plan.');
  assert.equal(model.checkNewPlan({ name: 'Plan', date: '01/11/2026', kind: 'mass' }), 'Choose a date for the plan.');
});

test('a type other than Mass or Praise & Worship is refused', () => {
  assert.equal(model.checkNewPlan({ name: 'Plan', date: '2026-11-01', kind: 'choir' }), 'Choose Mass or Praise & Worship.');
});

test('a created plan opens the editor for its type, with its id in the address', () => {
  const id = '10000000-0000-4000-8000-0000000000aa';
  assert.equal(model.editorPathFor({ id, kind: 'pw' }), `plan/praise.html?id=${id}`);
  assert.equal(model.editorPathFor({ id, kind: 'mass' }), `plan/mass.html?id=${id}`);
});
