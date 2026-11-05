// Lectionary citations read into passages for the offline Bible. Run with: node --test shared/lectionary-citation.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bibleChaptersOf, chaptersOf, inPassage, lectionaryRefOf, parseLectionaryCitation } from './lectionary-citation.js';

const passages = (text) => parseLectionaryCitation(text)?.passages;

test('a plain reading is one passage with its book code', () => {
  assert.deepEqual(parseLectionaryCitation('Lk 4:1-13'), { book: 'Lk', code: 'LUK', passages: [{ chapter: 4, from: 1, toChapter: 4, to: 13 }] });
  assert.equal(parseLectionaryCitation('1 Cor 13:1-8')?.code, '1CO');
  assert.equal(parseLectionaryCitation('Jn 3:16')?.passages[0].to, 16);
});

test('a psalm keeps each stanza as its own passage, and verse parts are read as the whole verse', () => {
  assert.deepEqual(passages('Ps 23:1-3a, 3b-4, 5, 6'), [
    { chapter: 23, from: 1, toChapter: 23, to: 3 },
    { chapter: 23, from: 3, toChapter: 23, to: 4 },
    { chapter: 23, from: 5, toChapter: 23, to: 5 },
    { chapter: 23, from: 6, toChapter: 23, to: 6 },
  ]);
});

test('a semicolon starts a new chapter, and a dash can run across chapters', () => {
  assert.deepEqual(passages('Gn 2:7-9; 3:1-7'), [
    { chapter: 2, from: 7, toChapter: 2, to: 9 },
    { chapter: 3, from: 1, toChapter: 3, to: 7 },
  ]);
  assert.deepEqual(passages('Mt 26:14—27:66'), [{ chapter: 26, from: 14, toChapter: 27, to: 66 }]);
  assert.deepEqual(chaptersOf(parseLectionaryCitation('Mt 26:14—27:66')), [26, 27]);
});

test('the printed extras are dropped: Cf., the response number, the shorter form', () => {
  assert.deepEqual(passages('Cf. Mt 4:4b'), [{ chapter: 4, from: 4, toChapter: 4, to: 4 }]);
  assert.deepEqual(passages('Ps 51:3-4, 5-6 (3a)'), [
    { chapter: 51, from: 3, toChapter: 51, to: 4 },
    { chapter: 51, from: 5, toChapter: 51, to: 6 },
  ]);
  assert.deepEqual(passages('Jn 11:1-45 or 11:3-7, 17'), [{ chapter: 11, from: 1, toChapter: 11, to: 45 }]);
});

test('a chapter alone is the whole chapter', () => {
  assert.deepEqual(passages('Ps 23'), [{ chapter: 23, from: 1, toChapter: 23, to: null }]);
});

test('text that is not a citation is null', () => {
  for (const text of ['', 'Lk', 'Paste here', 'Xyz 1:2', 'Lk 4:13-1', 'Lk 4:a']) assert.equal(parseLectionaryCitation(text), null, text);
});

test('inPassage follows the chapter boundaries of a cross-chapter range', () => {
  const [p] = passages('Mt 26:14—27:66');
  assert.equal(inPassage(p, 26, 13), false);
  assert.equal(inPassage(p, 26, 75), true);
  assert.equal(inPassage(p, 27, 66), true);
  assert.equal(inPassage(p, 27, 67), false);
  assert.equal(inPassage(passages('Ps 23')[0], 23, 6), true);
});

test('verse parts can be several letters, as the Lectionary prints them', () => {
  assert.deepEqual(passages('Ps 98:1bcde, 2-3ab, 3cd-4'), [
    { chapter: 98, from: 1, toChapter: 98, to: 1 },
    { chapter: 98, from: 2, toChapter: 98, to: 3 },
    { chapter: 98, from: 3, toChapter: 98, to: 4 },
  ]);
  assert.equal(parseLectionaryCitation('1 Thes 5:16-24')?.code, '1TH');
  assert.equal(parseLectionaryCitation('Hb 1:2-3; 2:2-4')?.code, 'HAB');
});

test('an English-numbered Bible is read in the Lectionary (Hebrew) numbering', () => {
  // A psalm's title is verse 1 in the Lectionary: the English Ps 51:1 is its 51:3, Ps 23 has no title.
  assert.deepEqual(lectionaryRefOf('PSA', 51, 1, 19), { chapter: 51, verse: 3 });
  assert.deepEqual(lectionaryRefOf('PSA', 34, 1, 22), { chapter: 34, verse: 2 });
  assert.deepEqual(lectionaryRefOf('PSA', 23, 1, 6), { chapter: 23, verse: 1 });
  // Malachi 4 and Joel 3 are the Lectionary's Malachi 3:19-24 and Joel 4.
  assert.deepEqual(lectionaryRefOf('MAL', 4, 1, 6), { chapter: 3, verse: 19 });
  assert.deepEqual(lectionaryRefOf('JOL', 3, 12, 21), { chapter: 4, verse: 12 });
  assert.deepEqual(bibleChaptersOf('MAL', 3), [2, 3, 4]);
  // Daniel without the Greek additions: its 3:24 is the Lectionary's 3:91. A Bible with them (97 verses) is not renumbered.
  assert.deepEqual(lectionaryRefOf('DAN', 3, 24, 30), { chapter: 3, verse: 91 });
  assert.deepEqual(lectionaryRefOf('DAN', 3, 24, 97), { chapter: 3, verse: 24 });
  // Romans' doxology: WEB prints it as 14:24-26, TGL and CEB as 16:25-27.
  assert.deepEqual(lectionaryRefOf('ROM', 14, 24, 26), { chapter: 16, verse: 25 });
  assert.deepEqual(lectionaryRefOf('ROM', 14, 23, 23), { chapter: 14, verse: 23 });
  assert.deepEqual(bibleChaptersOf('ROM', 16), [14, 16]);
  assert.deepEqual(lectionaryRefOf('LUK', 4, 1, 44), { chapter: 4, verse: 1 });
});
