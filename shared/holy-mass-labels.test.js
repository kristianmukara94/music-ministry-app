// Every standalone "Mass" shown to the operator reads "Holy Mass", and the names behind the screen (scope value, block ids, module names,
// stored note categories) are unchanged. "Liturgical Plan" is left as it was. Run with: node --test shared/holy-mass-labels.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { goLiveT } from './golive-i18n.js';
import { lyT } from './lyrics-i18n.js';
import { plannerT } from './planner-i18n.js';
import { pwT } from './pw-i18n.js';
import { NOTE_CATEGORIES, noteCategoryLabel } from './notes.js';
import { PRIMARY_LABELS_EN, PRIMARY_CATEGORIES } from './song-taxonomy.js';
import { MASS_SECTIONS } from './mass-slots.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// ---- No standalone "Mass" is left on screen ----

/** Stored values and seed data keep their spelling, and "Pre-Mass" is a compound. */
const KEPT = [/Mass Intention/, /Mass Sponsors/, /Pre-Mass/i];
const isComment = (line) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);

function sources(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) sources(rel, out);
    else if (/\.(tsx?|js|cjs|mjs)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) out.push(rel);
  }
  return out;
}

test('no label, message or tooltip in the app says "Mass" on its own: it says "Holy Mass"', () => {
  const found = [];
  for (const file of ['src', 'shared', 'electron'].flatMap((dir) => sources(dir))) {
    read(file).split(/\r?\n/).forEach((line, i) => {
      if (isComment(line) || KEPT.some((k) => k.test(line))) return;
      const cut = line.search(/\s\/\/\s/);
      const code = cut >= 0 ? line.slice(0, cut) : line;
      if (/(?<!Holy )\bMass\b/.test(code)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(found, []);
});

// ---- What the operator reads ----

test('the Holy Mass Planner\'s header, tabs, filters and plan words say Holy Mass, and "Liturgical Plan" is left alone', () => {
  assert.equal(plannerT('en', 'eyebrow'), 'Holy Mass Planner');
  assert.equal(plannerT('en', 'title'), 'Liturgical Plan', 'the title is kept as it was');
  assert.equal(plannerT('en', 'tab_mass_order'), 'Holy Mass Order');
  assert.equal(plannerT('en', 'sub_mass_order'), 'Holy Mass Order');
  assert.equal(plannerT('en', 'module_mass_order'), 'Holy Mass');
  assert.equal(plannerT('en', 'pickerFilterMass'), 'Holy Mass songs');
  assert.equal(plannerT('en', 'pickerMassOrder', { name: 'Kyrie' }), 'Use the Holy Mass Order text: Kyrie');
  assert.equal(plannerT('en', 'createFirst'), 'Create a plan for this Holy Mass to start building it.');
  assert.match(plannerT('en', 'subtitle'), /^Build the Holy Mass block by block\./);
  assert.match(plannerT('en', 'queueEmpty'), /Holy Mass Planner/);
});

test('the Go Live hub, the queue and the console say Holy Mass', () => {
  assert.equal(goLiveT('en', 'tabMass'), 'Holy Mass');
  assert.equal(goLiveT('en', 'queueLabel'), 'Holy Mass Queue');
  assert.equal(goLiveT('en', 'pickPlan'), 'Holy Mass plan');
  assert.equal(goLiveT('en', 'noPlansToPick'), 'No Holy Mass plans yet');
  assert.equal(goLiveT('en', 'createMass'), 'Create a Holy Mass plan');
  assert.equal(goLiveT('en', 'commandOpenPlanner'), 'Open the Holy Mass planner');
  assert.equal(goLiveT('en', 'whiteboardQueue'), 'Add to Holy Mass Queue');
  assert.equal(pwT('en', 'source_mass'), 'the Holy Mass Queue');
});

test('the song scope and its filters say Holy Mass in the filter chips, the form and the hints', () => {
  assert.equal(lyT('en', 'scope_MASS'), 'Holy Mass');
  assert.match(lyT('en', 'scopeHintMass'), /^Holy Mass songs\./);
  assert.match(lyT('en', 'scopeHintPw'), /Holy Mass songs are left out/);
  assert.equal(PRIMARY_LABELS_EN.MASS, 'Holy Mass');
});

test('the Tagalog and Cebuano text that names the queue, the planner or the order in English says Holy Mass there too', () => {
  assert.match(goLiveT('tl', 'replacesQueue'), /Holy Mass Queue/);
  assert.match(goLiveT('ceb', 'replacesQueue'), /Holy Mass Queue/);
  assert.match(goLiveT('tl', 'emptyDate'), /Holy Mass Planner/);
  assert.match(plannerT('tl', 'pickerMassOrder'), /Holy Mass Order/);
  assert.match(pwT('tl', 'source_mass'), /Holy Mass Queue/);
});

test('a note category shows as Holy Mass Intention, and is still stored as it always was', () => {
  assert.equal(noteCategoryLabel('Mass Intention'), 'Holy Mass Intention');
  assert.equal(noteCategoryLabel('Novena'), 'Novena');
  assert.ok(NOTE_CATEGORIES.includes('Mass Intention'), 'the stored name is unchanged, so saved notes still validate');
  assert.match(read('src/notes/present.ts'), /note\.category === 'Mass Intention'/, 'the lower third layout still follows the stored name');
  const view = read('src/notes/NotesPrayersView.tsx');
  assert.equal([...view.matchAll(/noteCategoryLabel\(/g)].length, 5, 'the filter, the form, the cards, the open note and the search use the label');
});

// ---- What did not change ----

test('the names behind the screen keep their old spelling, so saved sessions, plans and sync keep working', () => {
  assert.ok(PRIMARY_CATEGORIES.includes('MASS'));
  assert.deepEqual(MASS_SECTIONS.map((s) => s.block), ['introductory', 'word', 'eucharist', 'communion', 'concluding']);
  assert.match(read('src/golive/GoLiveConsole.tsx'), /setTab\('mass'\)/);
  assert.match(read('src/planner/ServiceQueue.tsx'), /mass_order: \{ label: 'HOLY MASS'/);
  assert.match(read('electron/mass-plans.js'), /export const PLAN_MODULES = \[[^\]]*'mass_order'/);
  assert.match(read('electron/plan-sync-map.js'), /module === 'mass_order'/);
  assert.match(read('electron/announcements.js'), /'Mass Sponsors'/, 'a folder name the app seeded is data, and is left as it is');
});
