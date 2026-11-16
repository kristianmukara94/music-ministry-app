// Every Praise & Worship lineup card can have its function (Song, Prayer, Scripture) changed, from the card's edit control or its icon, and
// the Library follows it. Synthetic content only. Run with: node --test shared/pw-card-type.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_TEMPLATE, PW_TYPES, acceptsTab, segmentFromTemplate, segmentStatus, slidesFor, songAssignment, typesFor, withCardType } from './pw.js';
import { attachMany } from './pw-attach.js';
import { pwT } from './pw-i18n.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const card = (key) => segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === key));
const apply = (segment, type) => ({ ...segment, ...withCardType(segment, type) });
const sampleHymn = { id: 41, title: 'Sample Song', stanzas: [{ id: 410, stanzaType: 'Verse 1', lyricsText: 'Sample line 1\nSample line 2' }] };

test('every card in the default lineup can be switched to each of the other functions', () => {
  for (const template of DEFAULT_TEMPLATE.segments) {
    const segment = segmentFromTemplate(template);
    for (const type of PW_TYPES) {
      const patch = withCardType(segment, type);
      if (type === segment.type) {
        assert.equal(patch, null, `${template.key} is already ${type}`);
        continue;
      }
      assert.ok(patch, `${template.key} -> ${type}`);
      const next = { ...segment, ...patch };
      assert.equal(next.type, type);
      // The new function takes items from its own Library tab.
      assert.ok(acceptsTab(next, type), `${template.key} as ${type} takes ${type} items`);
      // A card with no reading becomes a title slide as a Scripture card.
      assert.equal(next.content.kind, type === 'scripture' ? 'title' : type);
    }
  }
});

test('an unknown function changes nothing', () => {
  assert.equal(withCardType(card('marian_song'), 'video'), null);
});

test('a title-slide Scripture card switched to Song needs a song, takes one, and projects its lyrics with no title slide', () => {
  const scripture = card('bible_enthronement');
  assert.equal(scripture.type, 'scripture');
  assert.equal(scripture.content.kind, 'title');
  const song = apply(scripture, 'song');
  assert.equal(song.content.kind, 'song');
  assert.equal(segmentStatus(song), 'needs_song');
  assert.deepEqual(song.content.hymnIds, []);
  // The Add button and Add selected use attachMany; Insert into segment for a Replace uses songAssignment. Both take the song.
  const added = attachMany(song, [{ type: 'song', id: sampleHymn.id, title: sampleHymn.title }]);
  assert.equal(added.added, 1);
  assert.deepEqual(songAssignment(song, sampleHymn.id, null)?.content.hymnIds, [sampleHymn.id]);
  const filled = added.segment;
  assert.equal(segmentStatus(filled), 'ready');
  const slides = slidesFor({ ...filled, cues: { ...filled.cues, titleFirst: false } }, { hymns: [sampleHymn] });
  assert.deepEqual(slides.map((s) => s.kind), ['lyrics']);
  assert.equal(slides[0].text, 'Sample line 1\nSample line 2');
});

test('nothing assigned is lost: a prayer moves into the chain on a Song card, and comes back as the first item on a Prayer card', () => {
  const prayer = { ...card('prayer_authority'), content: { kind: 'prayer', noteId: 5, hymnIds: [] } };
  const song = apply(prayer, 'song');
  assert.deepEqual(song.content.more, [{ kind: 'prayer', noteId: 5, minutes: 0 }]);
  const back = apply(song, 'prayer');
  assert.equal(back.content.noteId, 5);
  assert.equal(back.content.more, undefined);
});

test('songs stay on the card whatever its function, and a reading comes back when it becomes Scripture again', () => {
  const reading = { ...card('gospel_acclamation'), content: { kind: 'lectionary', readingType: 'Gospel Acclamation', hymnIds: [41] } };
  const song = apply(reading, 'song');
  assert.deepEqual(song.content.hymnIds, [41]);
  assert.deepEqual(song.content.more, [{ kind: 'lectionary', readingType: 'Gospel Acclamation', minutes: 0 }]);
  const back = apply(song, 'scripture');
  assert.deepEqual(back.content, { kind: 'lectionary', readingType: 'Gospel Acclamation', hymnIds: [41] });
});

test('a card switched away from its template type still accepts its new type', () => {
  const prayer = apply(card('bible_enthronement'), 'prayer');
  assert.deepEqual(typesFor(prayer).sort(), ['prayer', 'scripture', 'song']);
  assert.equal(acceptsTab(prayer, 'prayer'), true);
});

test('the card edit control and the card icon both switch the function', () => {
  const rail = read('src/praise-worship/LineupRail.tsx');
  // The ✎ editor shows the function picker beside the name field.
  assert.match(rail, /<CardTypePicker value=\{segment\.type\} onChange=\{changeType\}/);
  // The icon badge is its own button with the same choices.
  assert.match(rail, /<CardTypeBadge segment=\{segment\} onChange=\{changeType\} t=\{t\} \/>/);
  assert.match(rail, /switchCardType\(i, segment, type\)/);
  const picker = read('src/praise-worship/CardTypePicker.tsx');
  assert.match(picker, /const patch = withCardType\(segment, type\);\s+if \(!patch\) return false;\s+updateSegment\(index, patch\);/);
});

test('the Library tab follows the card function, Add is never blocked by it, and a mismatch offers the switch', () => {
  const lib = read('src/praise-worship/Library.tsx');
  assert.match(lib, /setTab\(segment\.type === 'prayer' \? 'prayer' : segment\.type === 'scripture' \? 'scripture' : 'song'\);\s+\}, \[segment\?\.type, selected\]\);/);
  assert.match(lib, /const canInsert = \(row: Row \| null\) => Boolean\(row && segment && !row\.added\);/);
  assert.match(lib, /const mismatch = segment && tab !== segment\.type \? tab : null;/);
  assert.match(lib, /onClick=\{\(\) => switchCardType\(selected, segment, mismatch\)\}/);
});

test('the function labels and switch actions read in English, Tagalog and Cebuano', () => {
  const keys = ['cardFunction', 'cardIsType', 'type_song', 'type_prayer', 'type_scripture', 'switchTo_song', 'switchTo_prayer', 'switchTo_scripture'];
  for (const key of keys) {
    const en = pwT('en', key, { type: 'X', name: 'Y' });
    assert.notEqual(en, key, `${key} en`);
    for (const lang of ['tl', 'ceb']) assert.notEqual(pwT(lang, key, { type: 'X', name: 'Y' }), en, `${key} ${lang} is translated`);
  }
  assert.equal(pwT('en', 'switchTo_song'), 'Switch to Song');
});
