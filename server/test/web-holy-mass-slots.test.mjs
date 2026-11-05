// The web planner's Holy Mass editor: the 28 numbered slots in the four collapsible parts of the Mass, items kept in their slots through a view and a save,
// and "Holy Mass" in every label. Run with: node --test server/test/web-holy-mass-slots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const web = (file) => import(pathToFileURL(path.join(root, 'web', 'js', file)).href);
const readWeb = (rel) => fs.readFileSync(path.join(root, 'web', rel), 'utf8');

const model = await web('plan-model.js');
const slots = await web('mass-slots.js');
const sample = await web('sample-data.js');
const laptop = await import(pathToFileURL(path.join(root, 'shared', 'mass-slots.js')).href);
const { checkItems } = await import(pathToFileURL(path.join(root, 'server', 'lib', 'plan-sync.js')).href);

const SONG_A = '6f1c2b3a-0000-4000-8000-00000000000a';
const SONG_B = '6f1c2b3a-0000-4000-8000-00000000000b';
const songIds = new Set([SONG_A, SONG_B]);
const SECTIONS = model.massSections(sample.MASS_PLAN);
const ROWS = SECTIONS.flatMap((section) => section.rows);

// ---- The slots ----

test('the web\'s 28 slots are the church laptop\'s 28, in the same order, with the same numbers, names, sections and song categories', () => {
  assert.equal(slots.MASS_SLOTS.length, 28);
  assert.deepEqual(
    slots.MASS_SLOTS.map((s) => [s.number, s.position, s.name, s.group, s.category ?? null, s.kind]),
    laptop.MASS_SLOTS.map((s) => [s.number, s.position, s.name, s.block, s.songCategory ?? null, s.kind]),
  );
  assert.deepEqual(slots.MASS_SECTIONS.map((s) => [s.groups, s.title]), laptop.MASS_SECTIONS.map((s) => [s.blocks, s.name]));
  assert.equal(slots.SLOT_COUNT, 28);
});

test('the editor has the four parts of the Mass, each with its numbered slots first: 5, 8, 12 and 3', () => {
  assert.deepEqual(SECTIONS.map((s) => s.title), ['Introductory Rites', 'Liturgy of the Word', 'Liturgy of the Eucharist', 'Concluding Rites']);
  assert.deepEqual(SECTIONS.map((s) => s.rows.filter((r) => r.slot).length), [5, 8, 12, 3]);
  assert.deepEqual(ROWS.filter((r) => r.slot).map((r) => r.n), Array.from({ length: 28 }, (_, i) => i + 1), 'a slot is shown by its place in the Mass');
  for (const section of SECTIONS) {
    const firstOther = section.rows.findIndex((r) => !r.slot);
    if (firstOther >= 0) assert.ok(section.rows.slice(firstOther).every((r) => !r.slot), `${section.title}: slots come before other steps`);
    assert.ok(section.rows.every((r) => section.groups.includes(r.group)), 'a row is in its own section');
  }
});

test('every step of the earlier editor is either a slot or still an other step, so nothing that could be filled before is lost', () => {
  const steps = model.massSteps(sample.MASS_PLAN);
  const others = new Set(ROWS.filter((r) => !r.slot).map((r) => r.id));
  const mapped = new Set(Object.keys(slots.LEGACY_STEP_SLOT));
  for (const step of steps) assert.ok(mapped.has(String(step.n)) !== others.has(String(step.n)), `step ${step.n} ${step.name} is exactly one of the two`);
  assert.equal(others.size + mapped.size, steps.length);
  // The step a slot replaces names the same part.
  for (const [stepNo, slotNo] of Object.entries(slots.LEGACY_STEP_SLOT)) {
    const step = steps.find((s) => String(s.n) === stepNo);
    assert.equal(step.category, slots.slotOfNumber(slotNo).category ?? '', `step ${stepNo} and slot ${slotNo} share a song category`);
  }
});

// ---- Reading a plan into the editor ----

test('an item is read into the slot its number names, whatever its key is', () => {
  const items = [
    { key: 'lyrics.9.intro.1', group: 'introductory', order: 1, kind: 'song', songId: SONG_A, slot: 1 },
    { key: 'h4f2a', group: 'eucharist', order: 2, kind: 'song', songId: SONG_B, slot: 7 },
    { key: 'note1', group: 'word', order: 3, kind: 'rite', text: 'Lord, hear our prayer', slot: 6 },
  ];
  const state = model.massFromItems(items, ROWS);
  assert.deepEqual(state.segments, { s1: { songId: SONG_A }, s7: { songId: SONG_B }, s6: { text: 'Lord, hear our prayer' } });
  assert.deepEqual(state.extra, []);
  assert.deepEqual(state.meta.s7, { key: 'h4f2a', kind: 'song', slot: 7 });
});

test('a plan saved by the earlier editor, with step keys and no slots, is read into the slots those steps stand for', () => {
  const items = [
    { key: '1', group: 'introductory', order: 1, kind: 'song', songId: SONG_A },
    { key: '4', group: 'introductory', order: 2, kind: 'song', text: 'Kyrie (Lord, have mercy)' },
    { key: '15', group: 'eucharist', order: 3, kind: 'song', songId: SONG_B },
    { key: '5', group: 'introductory', order: 4, kind: 'song', text: 'Gloria setting' },
  ];
  const state = model.massFromItems(items, ROWS);
  assert.deepEqual(Object.keys(state.segments).sort(), ['s1', 's18', 's3', 's7'], 'the Gloria step is read into the Gloria slot');
  assert.equal(state.segments.s3.text, 'Kyrie (Lord, have mercy)');
  assert.deepEqual(state.extra, []);
});

test('a second item for a slot, or an item that fits no row, is kept among the items the editor does not show', () => {
  const items = [
    { key: 'a', group: 'introductory', order: 1, kind: 'song', songId: SONG_A, slot: 1 },
    { key: 'b', group: 'introductory', order: 2, kind: 'song', songId: SONG_B, slot: 1 },
    { key: 'lyrics.9.word.1', group: 'word', order: 3, kind: 'song', songId: SONG_B },
  ];
  const state = model.massFromItems(items, ROWS);
  assert.deepEqual(state.extra.map((i) => i.key), ['b', 'lyrics.9.word.1']);
});

// ---- Saving ----

test('a slot\'s item is saved with its number, 1 to 28, and the section the slot is in, in Mass order', () => {
  const state = { segments: { s1: { songId: SONG_A }, s12: { songId: SONG_B }, s13: { text: 'Through him, and with him' }, s28: { text: 'Go in Peace' } }, notes: {}, extra: [], meta: {} };
  const items = model.massToItems(state, ROWS);
  // The Doxology (13) closes the Eucharistic Prayer, so it comes before the Lord's Prayer (12).
  assert.deepEqual(items.map((i) => [i.key, i.slot, i.group, i.kind, i.order]), [
    ['s1', 1, 'introductory', 'song', 1],
    ['s13', 13, 'eucharist', 'rite', 2],
    ['s12', 12, 'eucharist', 'song', 3],
    ['s28', 28, 'concluding', 'rite', 4],
  ]);
  // The server takes them as they are.
  assert.deepEqual(checkItems(items, songIds).map((i) => i.slot), [1, 13, 12, 28]);
});

test('a reading slot is saved as a reading, so the laptop reads it back as one', () => {
  const state = { segments: { s20: { text: 'First Reading' } }, notes: {}, extra: [], meta: {} };
  assert.deepEqual(model.massToItems(state, ROWS).map((i) => [i.key, i.slot, i.group, i.kind]), [['s20', 20, 'word', 'reading']]);
});

test('an item keeps the key, kind and slot it came with through a view and a save, so it never moves to another slot or drops out of one', () => {
  const items = [
    { key: 'lyrics.9.intro.1', group: 'introductory', order: 1, kind: 'song', songId: SONG_A, slot: 1 },
    { key: '4', group: 'introductory', order: 2, kind: 'rite', text: 'Kyrie', slot: 3 },
    { key: 'h4f2a', group: 'eucharist', order: 3, kind: 'song', songId: SONG_B, slot: 7, note: 'Slow' },
    { key: 'lyrics.9.word.1', group: 'word', order: 4, kind: 'song', songId: SONG_B },
  ];
  const back = model.massToItems(model.massFromItems(items, ROWS), ROWS);
  assert.deepEqual(
    back.map(({ key, slot, kind, songId, text, note, group }) => ({ key, slot, kind, songId, text, note, group })),
    items.map(({ key, slot, kind, songId, text, note, group }) => ({ key, slot, kind, songId, text, note, group })),
  );
  assert.deepEqual(checkItems(back, songIds).map((i) => i.slot ?? null), [1, 3, 7, null]);
});

test('a plan saved by the earlier editor comes back with its slots filled in, so the laptop places each item in its slot', () => {
  const items = [{ key: '4', group: 'introductory', order: 1, kind: 'song', text: 'Kyrie setting' }];
  const back = model.massToItems(model.massFromItems(items, ROWS), ROWS);
  assert.deepEqual(back.map((i) => [i.key, i.slot]), [['4', 3]]);
});

test('a change on the web keeps the other items\' slots: choosing a song for one slot leaves the rest as they were', () => {
  const items = [{ key: 'x1', group: 'eucharist', order: 1, kind: 'song', songId: SONG_A, slot: 7 }];
  const state = model.massFromItems(items, ROWS);
  state.segments = model.withChoice(state.segments, 's16', { songId: SONG_B });
  const next = model.massToItems(state, ROWS);
  assert.deepEqual(next.map((i) => [i.key, i.slot]), [['x1', 7], ['s16', 16]]);
});

// ---- The page ----

test('the editor draws the five sections as collapsible, slots first, and remembers which are closed', () => {
  const page = readWeb('js/mass.js');
  assert.match(page, /aria-expanded="\$\{open\}"/);
  assert.match(page, /data-toggle="\$\{section\.group\}"/);
  assert.match(page, /const slotRows = section\.rows\.filter\(\(r\) => r\.slot\);/);
  assert.match(page, /OTHER STEPS/);
  assert.match(page, /localStorage\.setItem\(COLLAPSED_KEY/);
  assert.match(page, /state = fresh\(massFromItems\(plan\.items, ROWS\)\);/);
  assert.match(page, /massToItems\(state, ROWS\)/);
});

// ---- Labels ----

test('every label on the web portal says Holy Mass: the list tab, the plan rows, the form, the editor and the login page', () => {
  assert.match(readWeb('js/plans.js'), /\{ key: 'mass', label: 'Holy Mass' \}/);
  assert.match(readWeb('js/plans.js'), /'Holy Mass plan'/);
  assert.match(readWeb('plan/new.html'), /<option value="mass">Holy Mass<\/option>/, 'the stored value is still mass');
  assert.match(readWeb('plan/mass.html'), /<title>Holy Mass plan · APCCMMA Web Planner<\/title>/);
  assert.match(readWeb('js/mass.js'), /HOLY MASS PLAN · \$\{dateLabel\(plan\.date\)\}/);
  assert.match(readWeb('login.html'), /Plan the Holy Mass from anywhere/);
  assert.equal(model.checkNewPlan({ name: 'Plan', date: '2026-11-01', kind: 'choir' }), 'Choose Holy Mass or Praise & Worship.');
});

test('no standalone "Mass" is left in the web portal\'s own text', () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, 'web', dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(html|js)$/.test(entry.name)) {
        fs.readFileSync(path.join(root, 'web', rel), 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          const code = line.replace(/\s\/\/\s.*$/, '');
          if (/(?<!Holy )\bMass\b/.test(code)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
        });
      }
    }
  };
  walk('');
  assert.deepEqual(found, []);
});

test('the names behind the screen are unchanged: the plan kind, the tab key and the page address', () => {
  assert.equal(model.editorPathFor({ id: 'p1', kind: 'mass' }), 'plan/mass.html?id=p1');
  assert.equal(model.editorPathFor({ id: 'p1' }), 'plan/mass.html?id=p1');
  assert.equal(model.tabCounts([{ kind: 'mass' }, { kind: 'pw' }, {}]).mass, 2);
  assert.equal(model.checkNewPlan({ name: 'Plan', date: '2026-11-01', kind: 'mass' }), null);
  assert.deepEqual(model.visiblePlans([{ kind: 'mass', name: 'A' }, { kind: 'pw', name: 'B' }], { tab: 'mass' }).map((p) => p.name), ['A']);
});
