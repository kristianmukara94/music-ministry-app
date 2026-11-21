// Tests for the New plan form's rules and who may see it (web/js/plan-model.js). The page itself is checked in a browser.
// Run with: node --test server/test/web-new-plan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const model = await import(pathToFileURL(path.join(here, '..', '..', 'web', 'js', 'plan-model.js')).href);

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

test('a type other than Holy Mass or Praise & Worship is refused', () => {
  assert.equal(model.checkNewPlan({ name: 'Plan', date: '2026-11-01', kind: 'choir' }), 'Choose Holy Mass or Praise & Worship.');
});

test('a created plan opens the editor for its type, with its id in the address', () => {
  const id = '10000000-0000-4000-8000-0000000000aa';
  assert.equal(model.editorPathFor({ id, kind: 'pw' }), `plan/praise.html?id=${id}`);
  assert.equal(model.editorPathFor({ id, kind: 'mass' }), `plan/mass.html?id=${id}`);
});

test('the date shortcuts count from the reader\'s own day', () => {
  const monday = new Date(2026, 10, 9, 22, 30);
  assert.equal(model.dateShortcut('today', monday), '2026-11-09');
  assert.equal(model.dateShortcut('saturday', monday), '2026-11-14');
  assert.equal(model.dateShortcut('sunday', monday), '2026-11-15');
});

test('on a Saturday "This Saturday" is today; on a Sunday "Next Sunday" is a week away', () => {
  const saturday = new Date(2026, 10, 14);
  assert.equal(model.dateShortcut('saturday', saturday), '2026-11-14');
  assert.equal(model.dateShortcut('sunday', saturday), '2026-11-15');
  const sunday = new Date(2026, 10, 15);
  assert.equal(model.dateShortcut('sunday', sunday), '2026-11-22');
  assert.equal(model.dateShortcut('saturday', sunday), '2026-11-21');
});

test('the date shortcuts cross the end of a month and a year', () => {
  assert.equal(model.dateShortcut('sunday', new Date(2026, 11, 30)), '2027-01-03');
});

test('the suggested name follows the template and the date', () => {
  assert.equal(model.suggestPlanName({ kind: 'mass', date: '2026-11-15' }), 'Sunday Holy Mass (15 Nov)');
  assert.equal(model.suggestPlanName({ kind: 'mass', date: '2026-11-14' }), 'Saturday Holy Mass (14 Nov)');
  assert.equal(model.suggestPlanName({ kind: 'pw', date: '2026-10-26' }), 'Praise & Worship Night (26 Oct)');
  assert.equal(model.suggestPlanName({ kind: 'pw', date: '2026-09-05' }), 'Praise & Worship Night (5 Sep)');
});

test('with no date the suggested name has none either, and always passes the name check', () => {
  assert.equal(model.suggestPlanName({ kind: 'mass', date: '' }), 'Holy Mass');
  assert.equal(model.suggestPlanName({ kind: 'pw', date: '' }), 'Praise & Worship Night');
  assert.equal(model.checkNewPlan({ name: model.suggestPlanName({ kind: 'mass', date: '2026-11-15' }), date: '2026-11-15', kind: 'mass' }), null);
});

test('the create request keeps the route\'s fields; language and time are for a Holy Mass plan only', () => {
  const id = '10000000-0000-4000-8000-0000000000aa';
  const input = { name: '  Sunday Holy Mass (15 Nov) ', date: '2026-11-15', language: 'CEB', massTime: '10:00' };
  assert.deepEqual(model.newPlanRequest({ ...input, kind: 'mass' }, id), { id, name: 'Sunday Holy Mass (15 Nov)', date: '2026-11-15', kind: 'mass', items: [], language: 'CEB', massTime: '10:00' });
  assert.deepEqual(model.newPlanRequest({ ...input, kind: 'pw' }, id), { id, name: 'Sunday Holy Mass (15 Nov)', date: '2026-11-15', kind: 'pw', items: [] });
  assert.equal('massTime' in model.newPlanRequest({ ...input, kind: 'mass', massTime: '' }, id), false, 'a time left for later is not sent');
});

test('the page shows the one CREATE A PLAN card: no template boxes and no live preview', async () => {
  // plan/new.html and the Planner's New Plan modal both draw the card from new-plan-form.js.
  const { newPlanFormHtml } = await import(pathToFileURL(path.join(here, '..', '..', 'web', 'js', 'new-plan-form.js')).href);
  const page = newPlanFormHtml();
  assert.match(page, /class="np-eyebrow">Create a plan</);
  assert.doesNotMatch(page, /template-card|preview-card-box|Live preview/);
  assert.doesNotMatch(page, /<select id="plan-kind"/);
  assert.equal(page.match(/type="submit"/g).length, 1, 'the action card is the one submit button');
});

test('the page runs under the site\'s content security policy: no inline script or handler, and nothing typed goes in as markup', () => {
  const web = (file) => fs.readFileSync(path.join(here, '..', '..', 'web', file), 'utf8');
  const page = web('plan/new.html');
  assert.doesNotMatch(page, /<script(?![^>]*\bsrc=)/);
  assert.doesNotMatch(page, /\son[a-z]+=/);
  const script = web('js/new-plan.js');
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|outerHTML|eval\(|new Function/);
  // The shared form writes markup once, from constants only (newPlanFormHtml takes no user value); everything typed goes through
  // textContent or an input's value.
  const form = web('js/new-plan-form.js');
  assert.deepEqual(form.match(/innerHTML|insertAdjacentHTML|outerHTML/g), ['innerHTML']);
  assert.match(form, /root\.innerHTML = newPlanFormHtml\(\);/);
  assert.doesNotMatch(form, /eval\(|new Function/);
  for (const page of ['plan/new.html', 'index.html']) assert.match(web(page), /<div id="new-plan-layout" class="new-plan-layout"/, `${page} holds the form`);
});
