// Print Lineup: the handout follows the Planner's exact arrangement, prints a song's key only when one was set, puts two identical copies side
// by side by default, and follows the Planner's text case. Synthetic data only. Run with: node --test shared/print-lineup.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_PRINT_LAYOUT,
  PRINT_LAYOUTS,
  casePrintLineup,
  copiesFor,
  massPrintLineup,
  printLayoutOf,
  pwPrintLineup,
  songKeyLabel,
} from './print-lineup.js';
import { plannerT } from './planner-i18n.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── The song key ───────────────────────────────────────────────────────────

test('a key prints only when one was set', () => {
  assert.equal(songKeyLabel('G'), 'G');
  assert.equal(songKeyLabel('  F#m '), 'F#m', 'trimmed, case kept');
  assert.equal(songKeyLabel('Bb'), 'Bb');
  for (const unset of [null, undefined, '', '   ', 'None', 'none', '-', '--', 'N/A', 'n/a', 'NA', '—']) {
    assert.equal(songKeyLabel(unset), null, `${JSON.stringify(unset)} prints no key`);
  }
});

// ── Praise & Worship: the Lineup's order ──────────────────────────────────

const hymns = {
  1: { title: 'Sample Song 1', musicalKey: 'G' },
  2: { title: 'Sample Song 2', musicalKey: '' },
  3: { title: 'Sample Song 3', musicalKey: 'None' },
  4: { title: 'Sample Song 4', musicalKey: 'D' },
};
const noteTitle = (id) => ({ 10: 'Sample Prayer', 11: 'Sample Prayer 2' })[id] ?? null;
const seg = (name, group, content) => ({ name, group, content: { hymnIds: [], more: [], ...content } });
const session = {
  groups: [
    { key: 'open', name: 'Sample Opening' },
    { key: 'empty', name: 'Sample Empty Group' },
    { key: 'close', name: 'Sample Closing' },
  ],
  segments: [
    seg('Sample Segment A', 'open', { kind: 'song', hymnIds: [4, 1] }),
    seg('Sample Segment B', 'close', { kind: 'prayer', noteId: 10, hymnIds: [2], more: [{ kind: 'lectionary', readingType: 'Sample Scripture', minutes: 2 }] }),
    seg('Sample Segment C', 'open', { kind: 'lectionary', readingType: 'Sample Scripture', hymnIds: [3], more: [{ kind: 'prayer', noteId: 11, minutes: 1 }, { kind: 'pictures', slideIds: [1, 2, 3], minutes: 1 }] }),
    seg('Sample Segment D', 'open', { kind: 'song', hymnIds: [99] }),
  ],
};

test('P&W: groups in order, cards in lineup order and numbered as the Lineup numbers them, empty groups left out', () => {
  const out = pwPrintLineup(session, { title: 'Sample Session', hymns, noteTitle, labels: { pictures: 'Slides ({n})' } });
  assert.equal(out.title, 'Sample Session');
  assert.deepEqual(out.sections.map((s) => s.heading), ['Sample Opening', 'Sample Closing']);
  assert.deepEqual(out.sections[0].entries.map((e) => [e.number, e.name]), [
    ['01', 'Sample Segment A'],
    ['03', 'Sample Segment C'],
    ['04', 'Sample Segment D'],
  ]);
  assert.deepEqual(out.sections[1].entries.map((e) => [e.number, e.name]), [['02', 'Sample Segment B']]);
});

test('P&W: a card prints its first item, then its songs in sung order, then its chain', () => {
  const out = pwPrintLineup(session, { hymns, noteTitle, labels: { pictures: 'Slides ({n})' } });
  const [a, c, d] = out.sections[0].entries;
  const [b] = out.sections[1].entries;
  assert.deepEqual(a.items.map((i) => i.title), ['Sample Song 4', 'Sample Song 1'], 'the reordered songs keep their order');
  assert.deepEqual(b.items.map((i) => [i.kind, i.title]), [['prayer', 'Sample Prayer'], ['song', 'Sample Song 2'], ['reading', 'Sample Scripture']]);
  assert.deepEqual(c.items.map((i) => [i.kind, i.title]), [
    ['reading', 'Sample Scripture'],
    ['song', 'Sample Song 3'],
    ['prayer', 'Sample Prayer 2'],
    ['other', 'Slides (3)'],
  ]);
  assert.deepEqual(d.items, [], 'a song not loaded is never printed as a bare number');
});

test('P&W: the key shows next to a song only when it was set', () => {
  const out = pwPrintLineup(session, { hymns, noteTitle });
  const all = out.sections.flatMap((s) => s.entries.flatMap((e) => e.items));
  const keyOf = (title) => all.find((i) => i.title === title).key;
  assert.equal(keyOf('Sample Song 1'), 'G');
  assert.equal(keyOf('Sample Song 4'), 'D');
  assert.equal(keyOf('Sample Song 2'), null, 'an empty key prints nothing');
  assert.equal(keyOf('Sample Song 3'), null, '"None" prints nothing');
  assert.ok(all.filter((i) => i.kind !== 'song').every((i) => i.key === null), 'prayers and readings never carry a key');
});

// ── Holy Mass: the plan's order ────────────────────────────────────────────

const plan = [
  // Saved out of order on purpose: the handout follows the Mass, not the save order.
  { block: 'word', module: 'lectionary', sourceId: '2026-01-04|First Reading', label: 'Sample Scripture', slot: 'first-reading' },
  { block: 'introductory', module: 'lyrics', sourceId: '1', label: 'Sample Song 1', slot: 'entrance' },
  { block: 'introductory', module: 'notes', sourceId: '10', label: 'Sample Prayer', slot: null },
  { block: 'introductory', module: 'lyrics', sourceId: '2', label: 'Sample Song 2', slot: 'kyrie' },
  { block: 'introductory', module: 'custom', sourceId: 'Sample Segment', label: 'Sample Segment', slot: null },
];
const keys = { 1: 'G', 2: 'N/A' };

test('Holy Mass: parts in Mass order, filled slots in slot order, then the part\'s additional items in their order', () => {
  const out = massPrintLineup(plan, { title: 'Sample Plan', lang: 'en', songKey: (row) => keys[row.sourceId] });
  assert.equal(out.sections.length, 2, 'parts with nothing in them are left out');
  const [intro, word] = out.sections;
  assert.deepEqual(intro.entries.map((e) => e.items[0].title), ['Sample Song 1', 'Sample Song 2', 'Sample Prayer', 'Sample Segment']);
  assert.deepEqual(intro.entries.map((e) => e.number), ['01', '03', '', ''], 'slots carry their place in the Mass, two digits as on screen; extras none');
  assert.deepEqual(intro.entries.map((e) => e.kind), ['song', 'song', 'prayer', 'other'], 'each row prints with its item icon');
  assert.equal(out.type, 'mass');
  assert.equal(out.minutes, null, 'a Holy Mass plan has no runtime to print');
  assert.equal(intro.entries[0].name, 'Entrance Hymn');
  assert.deepEqual(word.entries.map((e) => [e.number, e.items[0].kind, e.items[0].title]), [['06', 'reading', 'Sample Scripture']]);
});

test('Holy Mass: a song key prints when set and is omitted when unset', () => {
  const out = massPrintLineup(plan, { songKey: (row) => keys[row.sourceId] });
  const items = out.sections[0].entries.map((e) => e.items[0]);
  assert.equal(items[0].key, 'G');
  assert.equal(items[1].key, null, '"N/A" prints nothing');
  assert.equal(items[2].key, null);
  assert.equal(massPrintLineup([], {}).sections.length, 0);
});

// ── Two copies per page, and the text case ─────────────────────────────────

test('two identical copies per page is the default; one full-width copy is the other choice', () => {
  assert.deepEqual([...PRINT_LAYOUTS], ['double', 'single']);
  assert.equal(DEFAULT_PRINT_LAYOUT, 'double');
  assert.equal(copiesFor('double'), 2);
  assert.equal(copiesFor('single'), 1);
  assert.equal(printLayoutOf('three-up'), 'double', 'an unknown layout falls back to two copies');
  assert.equal(copiesFor(undefined), 2);
});

test('P&W: each card carries its icon kind and its runtime; each group and the session carry their totals, as the Lineup shows', () => {
  const timed = {
    groups: [{ key: 'open', name: 'Sample Opening' }, { key: 'close', name: 'Sample Closing' }],
    segments: [
      { ...seg('Sample Segment A', 'open', { kind: 'song', hymnIds: [1, 4] }), minutes: 8 },
      { ...seg('Sample Segment B', 'open', { kind: 'prayer', noteId: 10, more: [{ kind: 'lectionary', readingType: 'Sample Scripture', minutes: 2 }] }), minutes: 3 },
      { ...seg('Sample Segment C', 'close', { kind: 'lectionary', readingType: 'Sample Scripture' }), minutes: 0 },
      { ...seg('Sample Segment D', 'close', { kind: 'song' }), minutes: 4 },
      { ...seg('Sample Segment E', 'close', { kind: 'title' }), minutes: 1 },
      { ...seg('Sample Segment F', 'close', { kind: 'prayer', noteId: null }), minutes: 1 },
    ],
  };
  const out = pwPrintLineup(timed, { hymns, noteTitle });
  assert.equal(out.type, 'pw');
  assert.deepEqual(out.sections[0].entries.map((e) => [e.kind, e.minutes]), [['song', 8], ['prayer', 5]], 'a chained item adds its minutes');
  assert.deepEqual(out.sections[1].entries.map((e) => [e.kind, e.minutes]), [['reading', null], ['song', 4], ['other', 1], ['prayer', 1]], 'no minutes prints none');
  assert.deepEqual(out.sections.map((s) => s.minutes), [13, 6]);
  assert.equal(out.minutes, 19);
  const [, empty, title, prayer] = out.sections[1].entries;
  assert.deepEqual([empty.items, empty.writeIn], [[], true], 'a song card with no song yet prints a write-in line');
  assert.deepEqual([prayer.items, prayer.writeIn], [[], true], 'so does a prayer card with no prayer chosen');
  assert.deepEqual([title.items, title.writeIn, title.kind], [[], false, 'other'], 'a title card is complete as it is: no write-in line');
  assert.equal(out.sections[0].entries[0].writeIn, false);
});

test('the handout follows the Planner text case, and a song key keeps its own case', () => {
  const out = pwPrintLineup(session, { title: 'Sample Session', hymns, noteTitle });
  const upper = casePrintLineup(out, 'uppercase');
  assert.equal(upper.title, 'SAMPLE SESSION');
  assert.equal(upper.sections[0].heading, 'SAMPLE OPENING');
  assert.equal(upper.sections[0].entries[0].name, 'SAMPLE SEGMENT A');
  assert.equal(upper.sections[0].entries[0].items[0].title, 'SAMPLE SONG 4');
  assert.equal(upper.sections[0].entries[0].number, '01');
  const lower = casePrintLineup(casePrintLineup(out, 'uppercase'), 'lowercase');
  assert.equal(lower.sections[1].entries[0].items[0].title, 'sample prayer');
  assert.deepEqual(casePrintLineup(out, 'original'), out, 'original changes nothing');
  const withKey = casePrintLineup({ title: '', subtitle: '', sections: [{ heading: '', entries: [{ number: '1', name: '', items: [{ kind: 'song', title: 'Sample Song 1', key: 'Bb' }] }] }] }, 'uppercase');
  assert.equal(withKey.sections[0].entries[0].items[0].key, 'Bb');
});

test('both planners have a Print Lineup button that prints their own arrangement', () => {
  const mass = read('src/planner/MassPlanner.tsx');
  assert.match(mass, /<PrintLineupButton onClick=\{\(\) => setPrinting\(true\)\}/);
  assert.match(mass, /lineup=\{massPrintLineup\(shown, \{/, 'the Holy Mass handout is built from the rows as shown');
  assert.match(mass, /songKey: \(row\) => \(row\.module === 'lyrics' \? hymnNow\[Number\(row\.sourceId\)\]\?\.musicalKey : null\)/);
  const pw = read('src/praise-worship/PlanView.tsx');
  assert.match(pw, /<PrintLineupButton onClick=\{\(\) => setPrinting\(true\)\} \/>/);
  assert.match(pw, /lineup=\{pwPrintLineup\(session, \{/);
  assert.match(read('src/planner/PrintLineup.tsx'), /<Printer size=\{14\} aria-hidden \/> \{t\('printLineup'\)\}/);
});
test('the print labels are in English, Tagalog and Cebuano', () => {
  const keys = ['printLineup', 'printCopiesDouble', 'printCopiesSingle', 'printPortrait', 'printLayout', 'printNow', 'printNowHint', 'printSavePdf',
    'printSavePdfHint', 'printCutHere', 'printCopyOf', 'printBadgeMass', 'printBadgePw', 'printMinutes', 'printItems', 'printTotal', 'printSaved', 'printFailed',
    'printWorking', 'printPage', 'printKey', 'printEmpty', 'printClose'];
  for (const key of keys) {
    const en = plannerT('en', key);
    assert.notEqual(en, key, `${key} has English`);
    for (const lang of ['tl', 'ceb']) assert.notEqual(plannerT(lang, key), key, `${key} has ${lang}`);
  }
  // The words a musician reads are translated, not left in English.
  for (const key of ['printNow', 'printSavePdf', 'printCutHere', 'printCopyOf', 'printBadgeMass', 'printCopiesDouble', 'printPortrait', 'printPage']) {
    for (const lang of ['tl', 'ceb']) assert.notEqual(plannerT(lang, key), plannerT('en', key), `${key} is translated to ${lang}`);
  }
  assert.equal(plannerT('en', 'printNow'), 'Print…');
  assert.equal(plannerT('en', 'printSavePdf'), 'Save PDF');
  assert.equal(plannerT('en', 'printCutHere'), 'Cut here');
  assert.equal(plannerT('en', 'printCopiesDouble'), '2 Copies per Page');
  assert.equal(plannerT('en', 'printCopiesSingle'), '1 Copy per Page');
  assert.equal(plannerT('en', 'printCopyOf', { n: 1, total: 2 }), 'Copy 1 of 2');
});
