// Putting PowerPoint decks and text slides into a service flow that may be on air: where they go in a Holy Mass plan, how the queue's
// CURRENT row follows the row on air, and how a Praise & Worship card plays a chained deck.
// Run with: node --test shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  announcementSource,
  cursorAfterInsert,
  deckRow,
  deckThumb,
  decksOf,
  flowRowsOf,
  followCursor,
  insertIntoMassFlow,
  massInsertAt,
  massLineup,
  massOrderReset,
  newFlowRows,
  deckSlice,
  removeFromMassFlow,
  replaceSlotInMassFlow,
  textSlidePages,
} from './flow-insert.js';
import { MASS_SLOTS, SLOT_IDS } from './mass-slots.js';
import { SPLIT_LIMITS } from './projector-autofit.js';
import { initialLiveState, liveReducer } from './live.js';
import { chainAssignment, chainOf, holdsItem, MAX_PICTURES, slidesFor } from './pw.js';

const row = (block, sourceId, slot = null, module = 'lyrics') => ({ block, module, sourceId: String(sourceId), label: String(sourceId), slot });

// A plan as the database returns it: grouped by block in Mass order, slots first in slot order, then the additional items.
const plan = () => [
  row('introductory', 'entrance', 'entrance'), // 0
  row('introductory', 'kyrie', 'kyrie'), // 1
  row('word', 'psalm', 'psalm'), // 2
  row('word', 'note', null, 'custom'), // 3
  row('eucharist', 'offertory', 'offertory'), // 4
  row('eucharist', 'sanctus', 'sanctus'), // 5
  row('communion', 'communion', 'communion'), // 6
  row('concluding', 'recessional', 'recessional'), // 7
];
const deck = { module: 'announcements', sourceId: '40', label: 'Talk (3 slides)' };

test('PowerPoint pictures become one deck per Whiteboard folder, in order, named by the folder', () => {
  const slides = [
    { slideId: 1, folderId: 7, title: 'Welcome' },
    { slideId: null, folderId: 7, title: 'A designed slide' },
    { slideId: 2, folderId: 7, title: 'Point one' },
    { slideId: 3, folderId: null, title: 'Lone picture' },
    { slideId: 4, folderId: 9, title: 'Retreat' },
    { slideId: 5, folderId: 9, title: 'Day two' },
  ];
  const decks = decksOf(slides, (id) => ({ 7: 'Sunday talk', 9: 'Retreat' })[id]);
  assert.deepEqual(decks, [
    { key: 'folder:7', folderId: 7, title: 'Sunday talk', slideIds: [1, 2] },
    { key: 'unfiled', folderId: null, title: 'Lone picture', slideIds: [3] },
    { key: 'folder:9', folderId: 9, title: 'Retreat', slideIds: [4, 5] },
  ]);
  // A deck is one queue row: its first picture, which steps through the rest on the projector.
  assert.deepEqual(deckRow(decks[0]), { module: 'announcements', sourceId: '1', label: 'Sunday talk (2 slides)' });
  assert.deepEqual(deckRow(decks[1]), { module: 'announcements', sourceId: '3', label: 'Lone picture' });
});

test('a deck put into a filled slot plays straight after that slot, and the slot keeps its own item', () => {
  const placed = insertIntoMassFlow(plan(), [deck], { kind: 'slot', slot: 'offertory' });
  assert.equal(placed.at, 5);
  assert.deepEqual(placed.items[5], { block: 'eucharist', module: 'announcements', sourceId: '40', label: 'Talk (3 slides)', slot: null });
  assert.equal(placed.items[4].slot, 'offertory');
  assert.equal(placed.items.filter((it) => it.slot === 'offertory').length, 1);
  assert.equal(placed.items.length, plan().length + 1);
});

test('a second deck in the same slot plays after the first, and before the next slot', () => {
  const first = insertIntoMassFlow(plan(), [deck], { kind: 'slot', slot: 'offertory' }).items;
  const second = insertIntoMassFlow(first, [{ ...deck, sourceId: '50' }], { kind: 'slot', slot: 'offertory' });
  assert.deepEqual(second.items.slice(4, 8).map((it) => it.sourceId), ['offertory', '40', '50', 'sanctus']);
});

test('an empty slot takes the deck where its item would be: after the filled slots before it', () => {
  // 8. May the Lord Accept the Sacrifice is empty; it sits between the Offertory (7) and the Sanctus (9).
  assert.deepEqual(massInsertAt(plan(), { kind: 'slot', slot: 'accept-sacrifice' }), { at: 5, block: 'eucharist' });
  // 2. I Confess is empty and comes after the Entrance Hymn (1).
  assert.deepEqual(massInsertAt(plan(), { kind: 'slot', slot: 'confess' }), { at: 1, block: 'introductory' });
  // 5. Gospel Acclamation is empty: after the psalm and the note already put in after it.
  assert.deepEqual(massInsertAt(plan(), { kind: 'slot', slot: 'gospel-acclamation' }), { at: 4, block: 'word' });
});

test('a slot in an empty section goes where the section would be, or at the end', () => {
  const noWord = plan().filter((it) => it.block !== 'word');
  assert.deepEqual(massInsertAt(noWord, { kind: 'slot', slot: 'psalm' }), { at: 2, block: 'word' });
  assert.deepEqual(massInsertAt([], { kind: 'slot', slot: 'recessional' }), { at: 0, block: 'concluding' });
  const noEnd = plan().filter((it) => it.block !== 'concluding');
  assert.deepEqual(massInsertAt(noEnd, { kind: 'slot', slot: 'recessional' }), { at: noEnd.length, block: 'concluding' });
});

test('"Next" puts the slides straight after the row on air, in its section', () => {
  assert.deepEqual(massInsertAt(plan(), { kind: 'after', index: 2 }), { at: 3, block: 'word' });
  assert.equal(massInsertAt(plan(), { kind: 'after', index: 99 }), null);
  assert.equal(massInsertAt(plan(), { kind: 'slot', slot: 'not-a-slot' }), null);
  assert.equal(insertIntoMassFlow(plan(), [], { kind: 'slot', slot: 'kyrie' }), null);
});

test('the row on air keeps its place: rows put in ahead of it move CURRENT down by as many', () => {
  // Communion (6) is on air. A deck after the Offertory goes in ahead of it.
  const ahead = insertIntoMassFlow(plan(), [deck, { ...deck, sourceId: '41' }], { kind: 'slot', slot: 'offertory' }, 6);
  assert.equal(ahead.cursor, 8);
  assert.equal(ahead.items[ahead.cursor].sourceId, 'communion');
  // A deck after the Recessional goes in behind it: CURRENT stays.
  const behind = insertIntoMassFlow(plan(), [deck], { kind: 'slot', slot: 'recessional' }, 6);
  assert.equal(behind.cursor, 6);
  assert.equal(behind.items[behind.cursor].sourceId, 'communion');
  // "Next" goes in straight after the row on air, which stays CURRENT.
  const next = insertIntoMassFlow(plan(), [deck], { kind: 'after', index: 6 }, 6);
  assert.equal(next.cursor, 6);
  assert.equal(next.items[7].sourceId, '40');
  // Nothing on air stays nothing on air.
  assert.equal(insertIntoMassFlow(plan(), [deck], { kind: 'slot', slot: 'kyrie' }, -1).cursor, -1);
  assert.equal(cursorAfterInsert(3, 3, 2), 5);
  assert.equal(cursorAfterInsert(3, 4, 2), 3);
});

test('CURRENT follows its row through a change made elsewhere, even with the same song twice', () => {
  const before = plan();
  // The database files an appended Word row after the psalm's note, ahead of everything from the Eucharist on.
  const after = [...before.slice(0, 4), row('word', 'appended', null, 'announcements'), ...before.slice(4)];
  assert.equal(followCursor(before, after, 6), 7);
  assert.equal(followCursor(before, after, 1), 1);
  assert.equal(followCursor(before, before.filter((_, i) => i !== 6), 6), -1);
  assert.equal(followCursor(before, after, -1), -1);
  const twice = [row('introductory', 'same'), row('word', 'x'), row('communion', 'same')];
  const grown = [row('introductory', 'same'), row('word', 'new'), row('word', 'x'), row('communion', 'same')];
  assert.equal(followCursor(twice, grown, 2), 3);
});

test('the queue and CURRENT change together, and a cursor for another plan or out of range is ignored', () => {
  const items = plan().map((it, i) => ({ id: String(i), label: it.label, block: it.block, module: it.module, sourceId: it.sourceId, stale: false }));
  let state = liveReducer(initialLiveState(), { type: 'queue/set', items, planId: 3 });
  state = liveReducer(state, { type: 'queue/cursor', index: 6 });
  const live = state.projector.live;
  const grown = [...items.slice(0, 5), { ...items[0], id: 'x' }, ...items.slice(5)];
  const moved = liveReducer(state, { type: 'queue/set', items: grown, planId: 3, cursor: 7 });
  assert.equal(moved.queueCursor, 7);
  assert.equal(moved.projector.live, live);
  // Without a cursor the same plan keeps its position, as before.
  assert.equal(liveReducer(state, { type: 'queue/set', items: grown, planId: 3 }).queueCursor, 6);
  // A cursor past the end, or for a plan not loaded, is not trusted.
  assert.equal(liveReducer(state, { type: 'queue/set', items: grown, planId: 3, cursor: 99 }).queueCursor, 6);
  assert.equal(liveReducer(state, { type: 'queue/set', items: grown, planId: 4, cursor: 2 }).queueCursor, -1);
});

test('typed text becomes slides: a blank line starts one, and a long one is split under the projector limits', () => {
  assert.deepEqual(textSlidePages('First line\nSecond line\n\n\nThird slide\r\n'), ['First line\nSecond line', 'Third slide']);
  assert.deepEqual(textSlidePages('   \n\n  '), []);
  const long = Array.from({ length: 12 }, (_, i) => `Line number ${i + 1} of a long response`).join('\n');
  const pages = textSlidePages(long);
  assert.ok(pages.length >= 2);
  for (const page of pages) {
    assert.ok(page.split('\n').length <= SPLIT_LIMITS.maxLines);
    assert.ok(page.replace(/\n/g, '').length <= SPLIT_LIMITS.maxChars);
  }
  assert.equal(pages.join('\n'), long);
});

const card = (more = []) => ({
  key: 'praise',
  group: 'g',
  name: 'Praise',
  type: 'prayer',
  minutes: 5,
  cues: { lowerThird: false, titleFirst: false, fadeOut: false },
  arrangement: {},
  content: { kind: 'title', hymnIds: [], more },
});

test('a Praise & Worship card chains a PowerPoint deck once, and plays its pictures in order after what it holds', () => {
  const item = { kind: 'pictures', slideIds: [10, 11], minutes: 0 };
  const patch = chainAssignment(card(), item);
  assert.ok(patch);
  const segment = { ...card(), ...patch };
  assert.deepEqual(chainOf(segment), [item]);
  assert.ok(holdsItem(segment, { ...item }));
  assert.equal(chainAssignment(segment, item), null);
  assert.equal(chainAssignment(card(), { kind: 'pictures', slideIds: [], minutes: 0 }), null);
  assert.equal(chainAssignment(card(), { kind: 'pictures', slideIds: Array.from({ length: MAX_PICTURES + 1 }, (_, n) => n), minutes: 0 }), null);

  const slides = slidesFor(segment, { more: [{ pictures: [{ title: 'Welcome', src: 'apcc-media://slide/10' }, { title: '', src: 'apcc-media://slide/11' }] }] });
  assert.deepEqual(slides.slice(-2), [
    { kind: 'picture', label: 'Welcome', src: 'apcc-media://slide/10' },
    { kind: 'picture', label: 'Praise', src: 'apcc-media://slide/11' },
  ]);
});

test('a chained deck whose pictures are not loaded adds no slides, and the card still has its title slide', () => {
  const segment = card([{ kind: 'pictures', slideIds: [10], minutes: 0 }]);
  const slides = slidesFor(segment, { more: [{ pictures: [] }] });
  assert.ok(slides.every((s) => s.kind !== 'picture'));
  assert.ok(slides.length >= 1);
});

test('a 246-slide PowerPoint is one queue row, labelled with its count and thumbnailed by its first picture', () => {
  const slides = Array.from({ length: 246 }, (_, i) => ({ slideId: 100 + i, folderId: 7, title: `S${i + 1}` }));
  const decks = decksOf(slides, () => 'Retreat');
  assert.equal(decks.length, 1);
  const rows = decks.map(deckRow);
  assert.deepEqual(rows, [{ module: 'announcements', sourceId: '100', label: 'Retreat (246 slides)' }]);
  const placed = insertIntoMassFlow(plan(), rows, { kind: 'slot', slot: 'offertory' });
  assert.equal(placed.items.length, plan().length + 1);
  assert.equal(deckThumb(rows[0]), 'apcc-media://slide/100');
  assert.equal(deckThumb({ module: 'lyrics', sourceId: '5' }), null);
});

test('inside a deck row, Next, Back and a jump move the sub-slide only, and the queue row stays', () => {
  const slides = Array.from({ length: 4 }, (_, i) => ({ title: `S${i + 1}`, src: `apcc-media://slide/${i + 1}` }));
  const items = plan().map((it, i) => ({ id: String(i), label: it.label, block: it.block, module: it.module, sourceId: it.sourceId, stale: false }));
  let state = liveReducer(initialLiveState(), { type: 'queue/set', items, planId: 1 });
  state = liveReducer(state, { type: 'queue/cursor', index: 3 });
  const frame = (index) => ({ kind: 'image', title: slides[index].title, src: slides[index].src, deck: { slides, index } });
  state = liveReducer(state, { type: 'projector/stage', frame: frame(0) });
  state = liveReducer(state, { type: 'projector/take', source: 'MASS_QUEUE' });
  const at = () => state.projector.staged.deck.index;
  state = liveReducer(state, { type: 'projector/step', delta: 1 });
  assert.equal(at(), 1);
  state = liveReducer(state, { type: 'projector/stage', frame: frame(3) }); // a jump to slide 4
  assert.equal(at(), 3);
  state = liveReducer(state, { type: 'projector/step', delta: 1 }); // past the last slide the deck holds; the console then steps the queue on
  assert.equal(at(), 3);
  state = liveReducer(state, { type: 'projector/step', delta: -1 });
  assert.equal(at(), 2);
  assert.equal(state.queueCursor, 3);
});

test('putting a deck in ahead of a deck on air keeps the on-air row, and each deck stays one row', () => {
  const onAir = [...plan().slice(0, 4), row('word', '40', null, 'announcements'), ...plan().slice(4)]; // the deck on air is row 4
  const placed = insertIntoMassFlow(onAir, [{ ...deck, sourceId: '60', label: 'Other (9 slides)' }], { kind: 'slot', slot: 'psalm' }, 4);
  assert.equal(placed.items[placed.cursor].sourceId, '40');
  assert.equal(placed.items.filter((it) => it.module === 'announcements').length, 2);
});

// The whole Holy Mass order, every slot filled, as the database returns it.
const fullMass = () => MASS_SLOTS.map((slot) => row(slot.block, slot.id, slot.id));
/** The lineup Go Live shows: a filled slot by its slot id, an empty one as (id), any other row by its source. */
const lineupOf = (items) => massLineup(items).map((e) => ('slot' in e ? `(${e.slot.id})` : (items[e.index].slot ?? items[e.index].sourceId)));

test('putting a PowerPoint into the Mass keeps all 17 slots, each with its own item', () => {
  const placed = insertIntoMassFlow(fullMass(), flowRowsOf([{ key: 'folder:7', folderId: 7, title: 'Talk', slideIds: [40, 41, 42] }]), { kind: 'slot', slot: 'kyrie' });
  for (const slot of MASS_SLOTS) {
    const fillers = placed.items.filter((it) => it.slot === slot.id);
    assert.equal(fillers.length, 1, slot.id);
    assert.equal(fillers[0].sourceId, slot.id);
  }
  assert.equal(placed.items.length, 18);
  // The deck plays straight after the Kyrie, and the lineup still reads 1 to 17 in order around it.
  assert.deepEqual(lineupOf(placed.items).slice(0, 4), ['entrance', 'confess', 'kyrie', '40']);
  assert.deepEqual(lineupOf(placed.items).filter((x) => x !== '40'), SLOT_IDS);
});

test('Go Live shows every empty slot in its place, so a plan holding one deck still reads as the whole Mass', () => {
  // A new Standard Sunday plan stores nothing: all 17 slots are empty.
  assert.deepEqual(lineupOf([]), SLOT_IDS.map((id) => `(${id})`));
  const placed = insertIntoMassFlow([], [deck], { kind: 'slot', slot: 'prayer-faithful' });
  // A deck put into an empty slot fills it, so it stays tied to the slot that was picked.
  assert.deepEqual(placed.items, [{ block: 'word', module: 'announcements', sourceId: '40', label: 'Talk (3 slides)', slot: 'prayer-faithful' }]);
  const lineup = lineupOf(placed.items);
  assert.equal(lineup.length, 17);
  assert.deepEqual(lineup.slice(3, 7), ['(psalm)', '(gospel-acclamation)', 'prayer-faithful', '(offertory)']);
  // Empty slots sit between the filled ones, and the note put in after the psalm stays after it.
  assert.deepEqual(lineupOf(plan()).slice(0, 8), ['entrance', '(confess)', 'kyrie', 'psalm', 'note', '(gospel-acclamation)', '(prayer-faithful)', 'offertory']);
  assert.equal(massLineup(plan()).length, 17 + 1);
  // A plan from before slots, with no slot filled, is shown as it is.
  assert.deepEqual(massLineup([row('word', 'reading'), row('eucharist', 'song')]), [{ index: 0 }, { index: 1 }]);
});

test('a deck put into an empty slot lands on that slot in the lineup, and a second one follows it', () => {
  const first = insertIntoMassFlow(plan(), [deck], { kind: 'slot', slot: 'gospel-acclamation' }).items;
  assert.equal(first.find((it) => it.sourceId === '40').slot, 'gospel-acclamation');
  const second = insertIntoMassFlow(first, [{ ...deck, sourceId: '50' }], { kind: 'slot', slot: 'gospel-acclamation' }).items;
  assert.equal(second.find((it) => it.sourceId === '50').slot, null);
  assert.deepEqual(lineupOf(second).slice(3, 8), ['psalm', 'note', 'gospel-acclamation', '50', '(prayer-faithful)']);
  // Several decks into one empty slot: the first fills it and the rest follow, so no slot is ever held twice.
  const many = insertIntoMassFlow(plan(), [deck, { ...deck, sourceId: '41' }], { kind: 'slot', slot: 'confess' }).items;
  assert.deepEqual(many.map((it) => it.slot).filter(Boolean), ['entrance', 'confess', 'kyrie', 'psalm', 'offertory', 'sanctus', 'communion', 'recessional']);
  assert.deepEqual(lineupOf(many).slice(0, 4), ['entrance', 'confess', '41', 'kyrie']);
});

test('a 218-slide PowerPoint sent to the Mass is one row, never a row per slide', () => {
  const big = { key: 'folder:3', folderId: 3, title: 'Retreat', slideIds: Array.from({ length: 218 }, (_, i) => 500 + i) };
  const rows = flowRowsOf([big]);
  assert.deepEqual(rows, [{ module: 'announcements', sourceId: '500', label: 'Retreat (218 slides)' }]);
  assert.equal(insertIntoMassFlow(plan(), rows, { kind: 'slot', slot: 'offertory' }).items.length, plan().length + 1);
  // Rows already made (typed text slides) pass through as they are.
  assert.deepEqual(flowRowsOf([{ module: 'announcements', sourceId: 7, label: 'Intentions (1/2)' }]), [{ module: 'announcements', sourceId: '7', label: 'Intentions (1/2)' }]);
});

test('a deck already in the Mass is not put in again, however often it is sent', () => {
  const once = insertIntoMassFlow(plan(), [deck], { kind: 'slot', slot: 'offertory' }).items;
  // A second click sends the same deck: nothing is new.
  assert.deepEqual(newFlowRows(once, [deck]), { rows: [], duplicates: [deck] });
  // A batch with a copy of itself and one deck already there keeps only the new one, once.
  const other = { ...deck, sourceId: '77', label: 'Other' };
  assert.deepEqual(newFlowRows(once, [deck, other, other]), { rows: [other], duplicates: [deck, other] });
  // The same id in another module is another source.
  assert.equal(newFlowRows(once, [{ ...deck, module: 'media' }]).rows.length, 1);
});

test('putting a deck in while live keeps the slide on air at CURRENT, in one queue change', () => {
  // The Sanctus (row 5) is on air. A deck after the Kyrie goes in ahead of it; one after the Communion Hymn goes in behind it.
  const ahead = insertIntoMassFlow(plan(), flowRowsOf([{ key: 'k', folderId: 1, title: 'Talk', slideIds: [40, 41] }]), { kind: 'slot', slot: 'kyrie' }, 5);
  assert.equal(ahead.cursor, 6);
  assert.equal(ahead.items[ahead.cursor].sourceId, 'sanctus');
  assert.equal(insertIntoMassFlow(plan(), [deck], { kind: 'slot', slot: 'communion' }, 5).cursor, 5);
  // Into an empty slot ahead of the row on air: the cursor moves with its row as well.
  const empty = insertIntoMassFlow(plan(), [deck], { kind: 'slot', slot: 'confess' }, 5);
  assert.equal(empty.items[empty.cursor].sourceId, 'sanctus');

  const queue = (items) => items.map((it, i) => ({ id: `${i}:${it.module}:${it.sourceId}`, label: it.label, block: it.block, module: it.module, sourceId: it.sourceId, slot: it.slot ?? null }));
  let state = liveReducer(initialLiveState(), { type: 'queue/set', items: queue(plan()), planId: 2 });
  state = liveReducer(state, { type: 'queue/cursor', index: 5 });
  state = liveReducer(state, { type: 'projector/stage', frame: { kind: 'text', title: 'Holy, Holy, Holy', text: 'Holy', bg: null } });
  state = liveReducer(state, { type: 'projector/take', source: 'MASS_QUEUE' });
  const onAir = state.projector.live;
  const after = liveReducer(state, { type: 'queue/set', items: queue(ahead.items), planId: 2, cursor: ahead.cursor });
  assert.equal(after.queue[after.queueCursor].sourceId, 'sanctus');
  assert.equal(after.projector.live, onAir);
});

test('Reset order takes out the slide rows a slip put in, and keeps the slots, the readings and the notes', () => {
  const flooded = [...plan().slice(0, 4), ...Array.from({ length: 218 }, (_, i) => row('word', 500 + i, null, 'announcements')), ...plan().slice(4)];
  // A deck that fills a slot is the slot's item, so it stays.
  const filling = row('word', '900', 'gospel-acclamation', 'announcements');
  const { items, removed } = massOrderReset([...flooded.slice(0, 4), filling, ...flooded.slice(4)]);
  assert.equal(removed, 218);
  assert.deepEqual(items, [...plan().slice(0, 4), filling, ...plan().slice(4)]);
  assert.equal(massOrderReset(plan()).removed, 0);
  // Go Live then reads as the whole Mass again: 8 filled slots and 9 empty ones, with the note.
  assert.equal(massLineup(items).filter((e) => 'slot' in e).length, 9);
  assert.equal(massLineup(items).length, 17 + 1);
});

// Ten pictures in one Whiteboard folder, with a designed slide (no picture) among them and another folder after.
const talk = [
  ...Array.from({ length: 5 }, (_, i) => ({ slideId: 101 + i, folderId: 7, title: `Point ${i + 1}` })),
  { slideId: null, folderId: 7, title: 'A designed slide' },
  ...Array.from({ length: 5 }, (_, i) => ({ slideId: 106 + i, folderId: 7, title: `Point ${i + 6}` })),
  { slideId: 200, folderId: 9, title: 'Retreat' },
];
const talkName = (id) => ({ 7: 'Sunday talk', 9: 'Retreat' })[id];

test("a slide card's Add to Holy Mass Queue puts in its deck from that slide to the end, as one row", () => {
  const slice = deckSlice(talk[2], talk, talkName);
  assert.deepEqual(slice, { key: 'slice:103', folderId: 7, title: 'Sunday talk', slideIds: [103, 104, 105, 106, 107, 108, 109, 110], from: { at: 2, of: 10 } });
  const rows = flowRowsOf([slice]);
  assert.deepEqual(rows, [{ module: 'announcements', sourceId: '103:from', label: 'Sunday talk (Slide 3 of 10 • 8 slides)' }]);
  // It plays its folder from that picture on, and is thumbnailed by it.
  assert.deepEqual(announcementSource(rows[0].sourceId), { slideId: 103, alone: false, from: true });
  assert.equal(deckThumb(rows[0]), 'apcc-media://slide/103');

  const placed = insertIntoMassFlow(plan(), rows, { kind: 'slot', slot: 'offertory' }, 5);
  assert.deepEqual(
    placed.items.filter((it) => it.module === 'announcements').map((it) => it.sourceId),
    ['103:from'],
  );
  // The row on air keeps its place.
  assert.equal(placed.items[placed.cursor].sourceId, 'sanctus');
});

test("a slice picked on its deck's first slide is the whole deck, and the last slide is a slice of one", () => {
  assert.deepEqual(deckRow(deckSlice(talk[0], talk, talkName)), { module: 'announcements', sourceId: '101', label: 'Sunday talk (10 slides)' });
  assert.deepEqual(deckRow(deckSlice(talk[10], talk, talkName)), { module: 'announcements', sourceId: '110:from', label: 'Sunday talk (Slide 10 of 10 • 1 slide)' });
  // A folder of one picture plays it, named by the slide.
  assert.deepEqual(deckRow(deckSlice(talk[11], talk, talkName)), { module: 'announcements', sourceId: '200', label: 'Retreat' });
});

test('a slice is put in once, and is not taken for its whole deck or another slice', () => {
  const whole = deckRow(decksOf(talk, talkName)[0]);
  const fromThree = deckRow(deckSlice(talk[2], talk, talkName));
  const fromFour = deckRow(deckSlice(talk[3], talk, talkName));
  const withDeck = [...plan(), { ...whole, block: 'word', slot: null }];
  assert.deepEqual(newFlowRows(withDeck, [fromThree, fromFour]).rows, [fromThree, fromFour]);
  const withSlice = [...plan(), { ...fromThree, block: 'word', slot: null }];
  assert.deepEqual(newFlowRows(withSlice, [fromThree]), { rows: [], duplicates: [fromThree] });
  // Rows saved by older builds that play one picture alone still play.
  assert.deepEqual(announcementSource('12:only'), { slideId: 12, alone: true, from: false });
  assert.deepEqual(announcementSource('12'), { slideId: 12, alone: false, from: false });
  assert.equal(announcementSource('12:all'), null);
  assert.equal(announcementSource(''), null);
});

test('a slice put into an empty slot fills that slot, and Reset order keeps it but takes out the unassigned ones', () => {
  const noKyrie = plan().filter((it) => it.slot !== 'kyrie');
  const slice = deckRow(deckSlice(talk[2], talk, talkName));
  const { items } = insertIntoMassFlow(noKyrie, [slice], { kind: 'slot', slot: 'kyrie' });
  const filled = items.find((it) => it.sourceId === '103:from');
  assert.equal(filled.slot, 'kyrie');
  // The lineup shows it on slot 3 (Lord, Have Mercy), not as an empty slot.
  assert.ok(!massLineup(items).some((e) => 'slot' in e && e.slot.id === 'kyrie'));

  const extra = insertIntoMassFlow(items, [deckRow(deckSlice(talk[4], talk, talkName))], { kind: 'slot', slot: 'psalm' }).items;
  const reset = massOrderReset(extra);
  assert.equal(reset.removed, 1);
  assert.ok(reset.items.some((it) => it.sourceId === '103:from'));
  assert.ok(!reset.items.some((it) => it.sourceId === '105:from'));
  assert.equal(massLineup(reset.items).filter((e) => 'slot' in e).length + reset.items.filter((it) => it.slot).length, 17);
});

test('Replace swaps the item that fills a slot for the deck, which takes the slot; the rows after the slot stay', () => {
  const items = insertIntoMassFlow(plan(), [{ module: 'announcements', sourceId: '50', label: 'Old talk' }], { kind: 'slot', slot: 'kyrie' }).items;
  // entrance, kyrie, Old talk (after kyrie), psalm, ...
  const out = replaceSlotInMassFlow(items, [deck, { module: 'announcements', sourceId: '41', label: 'More' }], 'kyrie', 3);
  assert.equal(out.replaced.sourceId, 'kyrie');
  assert.equal(out.replacedCurrent, false);
  assert.deepEqual(out.items.map((it) => it.sourceId), ['entrance', '40', '41', '50', 'psalm', 'note', 'offertory', 'sanctus', 'communion', 'recessional']);
  assert.equal(out.items[1].slot, 'kyrie');
  assert.equal(out.items[1].block, 'introductory');
  assert.equal(out.items[2].slot, null);
  // No copy of the old item and no row left without its slot.
  assert.equal(out.items.filter((it) => it.slot === 'kyrie').length, 1);
  assert.equal(out.items.length, items.length + 1);
  // CURRENT was on psalm (3) and stays on psalm, one row further down.
  assert.equal(out.items[out.cursor].sourceId, 'psalm');
});

test('Replace keeps CURRENT on the slot when the item replaced was on air, and fills an empty slot like an insert', () => {
  const onAir = replaceSlotInMassFlow(plan(), [deck], 'kyrie', 1);
  assert.equal(onAir.replacedCurrent, true);
  assert.equal(onAir.cursor, 1);
  assert.equal(onAir.items[1].sourceId, '40');
  assert.equal(onAir.items.length, plan().length);
  // Before CURRENT, nothing moves.
  assert.equal(replaceSlotInMassFlow(plan(), [deck], 'psalm', 1).cursor, 1);

  const empty = replaceSlotInMassFlow(plan(), [deck], 'confess', 2);
  assert.equal(empty.replaced, null);
  assert.deepEqual(empty, { ...insertIntoMassFlow(plan(), [deck], { kind: 'slot', slot: 'confess' }, 2), replaced: null, replacedCurrent: false });
  assert.equal(replaceSlotInMassFlow(plan(), [deck], 'nope', 0), null);
  assert.equal(replaceSlotInMassFlow(plan(), [], 'kyrie', 0), null);
});

test('Removing a slot item leaves the slot empty in the Go Live lineup; removing an added row takes it out', () => {
  const out = removeFromMassFlow(plan(), 1, -1);
  assert.equal(out.removed.sourceId, 'kyrie');
  assert.equal(out.items.length, plan().length - 1);
  const lineup = massLineup(out.items);
  assert.ok(lineup.some((e) => 'slot' in e && e.slot.id === 'kyrie'), 'kyrie shows as an empty slot');
  assert.equal(lineup.filter((e) => 'slot' in e).length, MASS_SLOTS.length - out.items.filter((it) => it.slot).length);

  const added = insertIntoMassFlow(plan(), [deck], { kind: 'after', index: 3 }).items;
  assert.deepEqual(removeFromMassFlow(added, 4, -1).items, plan());
  assert.equal(removeFromMassFlow(plan(), 99, 0), null);
});

test('Removing moves CURRENT with its row, and off a removed row on air onto the next row that can play', () => {
  assert.equal(removeFromMassFlow(plan(), 1, 4).cursor, 3); // ahead of CURRENT: it moves up with its row
  assert.equal(removeFromMassFlow(plan(), 5, 4).cursor, 4); // after it: unchanged
  assert.equal(removeFromMassFlow(plan(), 0, -1).cursor, -1); // nothing on air

  const onAir = removeFromMassFlow(plan(), 4, 4);
  assert.equal(onAir.removedCurrent, true);
  assert.equal(onAir.items[onAir.cursor].sourceId, 'sanctus');

  // A missing row is skipped; at the end of the Mass it goes back to the row before.
  const withStale = plan().map((it) => (it.sourceId === 'sanctus' ? { ...it, stale: true } : it));
  const skipped = removeFromMassFlow(withStale, 4, 4);
  assert.equal(skipped.items[skipped.cursor].sourceId, 'communion');
  const last = removeFromMassFlow(plan(), 7, 7);
  assert.equal(last.items[last.cursor].sourceId, 'communion');
  assert.equal(removeFromMassFlow([row('introductory', 'only', 'entrance')], 0, 0).cursor, -1);
});

test('Removing the row on air, sent as one queue change, never leaves CURRENT past the end of the queue', () => {
  let s = liveReducer(initialLiveState(), { type: 'queue/set', items: plan(), planId: 1 });
  s = liveReducer(s, { type: 'queue/cursor', index: 7 });
  const out = removeFromMassFlow(s.queue, 7, s.queueCursor);
  s = liveReducer(s, { type: 'queue/set', items: out.items, planId: 1, cursor: out.cursor });
  assert.equal(s.queueCursor, 6);
  assert.ok(s.queue[s.queueCursor]);
});
