// Drop rules for dragging a song from the Song List onto a lineup slot. Run with: node --test shared/pw-drop.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE, segmentFromTemplate, songAssignment } from './pw.js';
import { songDrop } from './pw-drop.js';

const slot = (key) => segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === key));
const applied = (segment, patch) => ({ ...segment, ...patch });
const snapshot = (segment) => structuredClone(segment);

test('dropping a song on a song slot assigns it, as click-to-add does', () => {
  const seg = slot('marian_song');
  const drop = songDrop(seg, 7);
  assert.ok(drop.patch, 'the drop is accepted');
  assert.deepEqual(applied(seg, drop.patch).content, { kind: 'song', hymnIds: [7], maxSongs: 1, category: null });
  assert.equal(applied(seg, drop.patch).type, 'song');
  assert.deepEqual(drop.patch, songAssignment(seg, 7, null), 'the drop uses the same assignment as Add');
});

test('dropping a song on a multi-song slot adds it until the limit', () => {
  let seg = slot('worship');
  for (const id of [1, 2, 3]) {
    const drop = songDrop(seg, id);
    assert.ok(drop.patch, `song ${id} is added`);
    seg = applied(seg, drop.patch);
  }
  assert.deepEqual(seg.content.hymnIds, [1, 2, 3]);
});

test('dropping a song on segment 4 (Bible Enthronement) is accepted, as the title slide allows songs', () => {
  const seg = slot('bible_enthronement');
  const drop = songDrop(seg, 7);
  assert.ok(drop.patch, 'the drop is accepted');
  const after = applied(seg, drop.patch);
  assert.equal(after.type, 'song');
  assert.deepEqual(after.content, { kind: 'song', hymnIds: [7], maxSongs: 1, category: null });
  assert.equal(after.minutes, seg.minutes, 'the slot keeps its minutes');
});

test('dropping a song on a scripture slot that is not segment 4 is refused and changes nothing', () => {
  const seg = slot('gospel_acclamation');
  const before = snapshot(seg);
  const drop = songDrop(seg, 7);
  assert.deepEqual(drop, { refused: 'type' });
  assert.deepEqual(seg, before, 'the slot is unchanged');
});

test('dropping a song on a prayer slot is refused and changes nothing', () => {
  const seg = slot('prayer_authority');
  const before = snapshot(seg);
  assert.deepEqual(songDrop(seg, 7), { refused: 'type' });
  assert.deepEqual(seg, before);
});

test('dropping a song on a full multi-song slot is refused and changes nothing', () => {
  let seg = slot('worship');
  for (const id of [1, 2, 3]) seg = applied(seg, songDrop(seg, id).patch);
  const before = snapshot(seg);
  assert.deepEqual(songDrop(seg, 4), { refused: 'full' });
  assert.deepEqual(seg, before);
});

test('dropping a song that is already in the slot is refused as present and changes nothing', () => {
  let seg = slot('worship');
  seg = applied(seg, songDrop(seg, 1).patch);
  const before = snapshot(seg);
  assert.deepEqual(songDrop(seg, 1), { refused: 'present' });
  assert.deepEqual(seg, before);
});

test('dropping a song on a single-song slot that holds one replaces it, as click-to-add does', () => {
  let seg = slot('joyful_song');
  seg = applied(seg, songDrop(seg, 1).patch);
  seg = applied(seg, songDrop(seg, 2).patch);
  assert.deepEqual(seg.content.hymnIds, [2]);
});
