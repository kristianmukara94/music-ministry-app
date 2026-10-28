// A song can be attached to the Gospel Acclamation slot. It replaces the lectionary reading for the session: the slot shows Ready instead of
// Auto, and it projects the song's lyric slides, not the reading. Other lectionary-free slots keep their rules. Run with:
// node --test shared/gospel-song.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE, acceptsTab, segmentFromTemplate, segmentStatus, slidesFor, songAssignment, typesFor } from './pw.js';

const gospel = () => segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'gospel_acclamation'));
const HYMN = { id: 42, title: 'Alleluia, Sing to Jesus', stanzas: [{ id: 1, stanzaType: 'Verse 1', lyricsText: 'Alleluia\nSing to Jesus' }] };
const READING = { citation: 'Jn 6:63', rawText: 'Your words, Lord, are Spirit and life.' };

test('the Gospel Acclamation slot takes a song as well as the reading', () => {
  assert.deepEqual(typesFor(gospel()), ['scripture', 'song']);
  assert.equal(acceptsTab(gospel(), 'song'), true, 'the Add button is enabled for the song tab');
  assert.equal(acceptsTab(gospel(), 'scripture'), true, 'the reading still goes in');
});

test('attaching a song replaces the reading with the song, and the slot shows Ready', () => {
  const seg = gospel();
  assert.equal(segmentStatus(seg), 'auto', 'before a song, the slot is Auto');
  const patch = songAssignment(seg, 42, null);
  assert.equal(patch.content.kind, 'song');
  assert.deepEqual(patch.content.hymnIds, [42]);
  assert.equal(segmentStatus({ ...seg, ...patch }), 'ready', 'after a song, the slot is Ready');
});

test('the attached song projects its lyric slides, not the reading', () => {
  const seg = { ...gospel(), ...songAssignment(gospel(), 42, null) };
  const slides = slidesFor(seg, { hymns: [HYMN], reading: READING }, {});
  const lyrics = slides.filter((s) => s.kind === 'lyrics');
  assert.ok(lyrics.length > 0, 'the song is on the screen');
  assert.ok(!slides.some((s) => String(s.text ?? '').includes('Spirit and life')), 'the reading does not show');
});

test('without an attached song, the slot still projects the reading', () => {
  const slides = slidesFor(gospel(), { reading: READING }, {});
  assert.ok(slides.some((s) => String(s.text ?? '').includes('Spirit and life')));
});

test('the prayer slot still refuses a song', () => {
  assert.equal(acceptsTab(segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority')), 'song'), false);
});
