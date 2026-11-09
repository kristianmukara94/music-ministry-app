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

test('sorting: newest plan date, last updated, or title, each with a settled order and without changing the list it was given', () => {
  const sameDate = { ...PRAISE, id: '10000000-0000-4000-8000-000000000004', name: 'Alpha Night', liturgical_date: PRAISE.liturgical_date };
  const plans = [MASS, PRAISE, sameDate, UNTYPED];
  const before = [...plans];
  assert.deepEqual(model.sortPlans(plans, 'date-desc').map((p) => p.name), ['Untyped Plan', 'Alpha Night', 'Charismatic Prayer Night', 'All Saints, Sunday Mass']);
  assert.deepEqual(model.sortPlans(plans, 'updated-desc').map((p) => p.name), ['Untyped Plan', 'Alpha Night', 'Charismatic Prayer Night', 'All Saints, Sunday Mass']);
  assert.deepEqual(model.sortPlans(plans, 'title-asc').map((p) => p.name), ['All Saints, Sunday Mass', 'Alpha Night', 'Charismatic Prayer Night', 'Untyped Plan']);
  assert.deepEqual(plans, before);
});

test('updated-desc compares times, and an unknown order falls back to the newest date', () => {
  const older = { ...MASS, updated_at: '2026-10-27T09:00:00.000Z' };
  const newer = { ...PRAISE, updated_at: '2026-10-27T10:00:00.000Z' };
  assert.deepEqual(model.sortPlans([older, newer], 'updated-desc').map((p) => p.id), [newer.id, older.id]);
  assert.deepEqual(model.sortPlans([MASS, UNTYPED], 'nonsense').map((p) => p.id), [UNTYPED.id, MASS.id]);
});

test('a plan is upcoming through the whole of its own day, and past from the next', () => {
  assert.equal(model.planTiming('2026-11-09', '2026-11-08'), 'upcoming');
  assert.equal(model.planTiming('2026-11-09', '2026-11-09'), 'upcoming');
  assert.equal(model.planTiming('2026-11-09', '2026-11-10'), 'past');
  assert.equal(model.planTiming('2026-12-31', '2027-01-01'), 'past');
});

test('today is the reader\'s calendar day, padded so it compares with a plan date', () => {
  assert.equal(model.localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('the layout is a list unless grid was stored', () => {
  assert.equal(model.viewModeOf('grid'), 'grid');
  assert.equal(model.viewModeOf('list'), 'list');
  assert.equal(model.viewModeOf(null), 'list');
  assert.equal(model.viewModeOf('tiles'), 'list');
});

test('a copy keeps the date and items, gets the new id, and stays within the longest plan name', () => {
  const plan = { id: 'old', name: 'Sunday Mass', date: '2026-11-01', kind: 'mass', items: [{ key: 's1', order: 1, kind: 'song' }], language: 'TL' };
  assert.deepEqual(model.duplicateRequest(plan, 'new'), { id: 'new', name: 'Sunday Mass (copy)', date: '2026-11-01', kind: 'mass', items: plan.items });
  assert.equal(model.duplicateRequest({ ...plan, kind: null }, 'new').kind, 'mass', 'plan-create refuses a plan with no type');
  const longest = model.copyName('x'.repeat(120));
  assert.equal(longest.length, 120);
  assert.ok(longest.endsWith(' (copy)'));
});

test('a setlist has one line per filled place, in the given order, with the song title and key', () => {
  const songs = [{ id: 'a', title: 'Be Thou My Vision', key: 'Eb' }, { id: 'b', title: 'Old Hymn', key: '', removed: true }];
  const rows = [{ id: 's1', name: 'Entrance Hymn' }, { id: 's2', name: 'Confiteor' }, { id: 's3', name: 'Kyrie' }, { id: 's4', name: 'Gloria' }];
  const filled = { segments: { s1: { songId: 'a' }, s3: { text: 'Mass of Creation' }, s4: { songId: 'b' } }, extra: [{ text: 'Laptop item' }, { kind: 'rite' }] };
  assert.deepEqual(model.setlistEntries(filled, rows, songs), [
    { label: 'Entrance Hymn', title: 'Be Thou My Vision', key: 'Eb' },
    { label: 'Kyrie', title: 'Mass of Creation', key: '' },
    { label: 'Gloria', title: 'Old Hymn (removed)', key: '' },
    { label: 'Also in this plan', title: 'Laptop item', key: '' },
  ]);
  assert.deepEqual(model.setlistEntries({ segments: {} }, rows, songs), [], 'an unfilled plan has no lines');
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
