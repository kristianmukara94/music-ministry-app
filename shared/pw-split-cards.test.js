// Further Scripture references and typed notes on a filled Praise & Worship card: they chain onto that card as typed text, play as slides,
// print, and a split card an earlier version made for one ("worship.2") folds back onto its step's card. Synthetic strings only.
// Run with: node --test shared/pw-split-cards.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE, MAX_CHAIN, MAX_CHAIN_TEXT, chainAccepts, mergeSplitCards, segmentFromTemplate, slideOriginsFor, slidesFor, splitCardBase } from './pw.js';
import { attachItem, attachMany, parseDrag } from './pw-attach.js';
import { pwPrintLineup } from './print-lineup.js';

const card = (key) => segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === key));
const REF_1 = 'Sample Scripture Reference 1:1';
const REF_2 = 'Sample Scripture Reference 2:2';
const NOTE = 'Sample Typed Note';
const typed = (contentType, title) => ({ type: 'text', id: contentType, title });

test('a second Scripture reference and a typed note chain onto a card that already holds a song, a prayer or a reading', () => {
  const filled = [
    { ...card('worship'), content: { ...card('worship').content, hymnIds: [7] } },
    { ...card('prayer_authority'), content: { kind: 'prayer', noteId: 3, hymnIds: [] } },
    { ...card('gospel_acclamation') },
  ];
  for (const segment of filled) {
    const result = attachMany(segment, [typed('scripture', REF_1), typed('scripture', REF_2), typed('text_note', NOTE)]);
    assert.equal(result.chained, 3, segment.key);
    assert.deepEqual(result.segment.content.more.map((m) => [m.kind, m.contentType, m.text]), [
      ['text', 'scripture', REF_1], ['text', 'scripture', REF_2], ['text', 'text_note', NOTE],
    ]);
    // What the card held first is untouched.
    assert.deepEqual({ ...result.segment.content, more: undefined }, { ...segment.content, more: undefined });
  }
});

test('typed text is refused when empty, too long, of an unknown kind, already on the card, or past the chain limit', () => {
  const worship = card('worship');
  assert.equal(attachItem(worship, typed('scripture', '   ')).refused, 'type');
  assert.equal(attachItem(worship, typed('scripture', 'x'.repeat(MAX_CHAIN_TEXT + 1))).refused, 'type');
  assert.equal(attachItem(worship, typed('song', REF_1)).refused, 'type');
  const once = { ...worship, ...attachItem(worship, typed('scripture', REF_1)).patch };
  assert.equal(attachItem(once, typed('scripture', ` ${REF_1.toUpperCase()} `)).refused, 'present');
  // The same words as a note are another item.
  assert.equal(attachItem(once, typed('text_note', REF_1)).mode, 'chained');
  const full = { ...worship, content: { ...worship.content, more: Array.from({ length: MAX_CHAIN }, (_, i) => ({ kind: 'text', text: `Sample ${i}`, contentType: 'text_note', minutes: 0 })) } };
  assert.equal(attachItem(full, typed('text_note', NOTE)).refused, 'full');
  assert.equal(chainAccepts(worship, { kind: 'text', text: NOTE, contentType: 'text_note', minutes: 0 }), true);
  assert.equal(chainAccepts(worship, { kind: 'text', text: NOTE, contentType: 'other', minutes: 0 }), false);
});

test('a typed-text drag from the Library is read back as one', () => {
  assert.deepEqual(parseDrag(JSON.stringify(typed('scripture', REF_1))), { type: 'text', items: [{ id: 'scripture', title: REF_1 }] });
});

test('a Scripture reference plays as a title slide naming it, a note as its words; neither is offered for editing as prayer text', () => {
  const worship = { ...card('worship'), content: { ...card('worship').content, more: [
    { kind: 'text', text: REF_1, contentType: 'scripture', minutes: 0 },
    { kind: 'text', text: `${NOTE}\n\nSample second page`, contentType: 'text_note', minutes: 0 },
  ] } };
  const resolved = { hymns: [], more: [{}, {}] };
  assert.deepEqual(slidesFor(worship, resolved), [
    { kind: 'title', label: REF_1, subtitle: 'Worship' },
    { kind: 'prayer', label: 'Worship', text: NOTE },
    { kind: 'prayer', label: 'Worship', text: 'Sample second page' },
  ]);
  assert.deepEqual(slideOriginsFor(worship, resolved).map((o) => [o.item, o.source]), [[0, 'text'], [1, 'text'], [1, 'text']]);
});

test('typed text prints in the card\'s items: a reference as a reading, a note as itself', () => {
  const worship = { ...card('worship'), content: { ...card('worship').content, more: [
    { kind: 'text', text: REF_1, contentType: 'scripture', minutes: 0 },
    { kind: 'text', text: NOTE, contentType: 'text_note', minutes: 0 },
  ] } };
  const doc = pwPrintLineup({ groups: DEFAULT_TEMPLATE.groups, segments: [worship] });
  const items = doc.sections.flatMap((s) => s.entries).flatMap((e) => e.items ?? []);
  assert.deepEqual(items.map((i) => [i.kind, i.title]), [['reading', REF_1], ['other', NOTE]]);
});

test('a split card ("worship.2") is folded back onto its step\'s card with its words, songs, minutes and notes', () => {
  assert.equal(splitCardBase('worship.2'), 'worship');
  assert.equal(splitCardBase('worship.2.3'), 'worship');
  assert.equal(splitCardBase('worship'), null);
  const worship = { ...card('worship'), content: { ...card('worship').content, hymnIds: [7] }, notes: 'Sample booth note' };
  const ref = { ...card('bible_enthronement'), key: 'worship.2', group: 'praise', name: REF_1, type: 'scripture', minutes: 2, content: { kind: 'title', hymnIds: [8] } };
  const note = { ...card('prayer_authority'), key: 'worship.3', group: 'praise', name: NOTE, type: 'prayer', minutes: 0, content: { kind: 'prayer', noteId: null, hymnIds: [] }, notes: 'Sample split note' };
  const prayer = { ...card('prayer_authority'), key: 'worship.4', group: 'praise', name: 'Sample Prayer Title', type: 'prayer', minutes: 0, content: { kind: 'prayer', noteId: 5, hymnIds: [] } };
  const other = card('finale');
  const merged = mergeSplitCards([worship, ref, other, note, prayer]);
  assert.deepEqual(merged.map((s) => s.key), ['worship', 'finale']);
  const w = merged[0];
  assert.deepEqual(w.content.hymnIds, [7, 8]);
  assert.equal(w.content.maxSongs, 3);
  assert.deepEqual(w.content.more.map((m) => [m.kind, m.contentType ?? null, m.text ?? m.noteId]), [
    ['text', 'scripture', REF_1], ['text', 'text_note', NOTE], ['prayer', null, 5],
  ]);
  assert.equal(w.minutes, card('worship').minutes + 2);
  assert.equal(w.notes, 'Sample booth note\nSample split note');
  // A lineup with no split card is returned as it was.
  const clean = [worship, other];
  assert.equal(mergeSplitCards(clean), clean);
});

test('a split card ahead of its step\'s card still joins it, and one whose step is not in the lineup gets a key that saves', () => {
  const worship = card('worship');
  const early = { ...card('bible_enthronement'), key: 'worship.2', group: 'praise', name: REF_1, type: 'scripture', content: { kind: 'title', hymnIds: [] } };
  const orphan = { ...card('bible_enthronement'), key: 'seg_9.2', group: 'word', name: REF_2, type: 'scripture', content: { kind: 'title', hymnIds: [] } };
  const merged = mergeSplitCards([early, worship, orphan]);
  assert.deepEqual(merged.map((s) => s.key), ['worship', 'seg_9_2']);
  assert.deepEqual(merged[0].content.more.map((m) => m.text), [REF_1]);
  assert.match(merged[1].key, /^[a-z][a-z0-9_]{0,39}$/);
  assert.equal(merged[1].name, REF_2);
});
