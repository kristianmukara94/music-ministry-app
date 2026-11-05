// The liturgical day of a date and its citations from the built-in Ordo. Run with: node --test shared/liturgical-day.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dateOfIso, dayCodeOf, ordoDayOf, sundayCycleOf, weekdayCycleOf } from './liturgical-day.js';
import { bibleChaptersOf, chaptersOf, inPassage, lectionaryRefOf, parseLectionaryCitation } from './lectionary-citation.js';

const ordo = JSON.parse(fs.readFileSync(new URL('../src/data/lectionary_ordo.json', import.meta.url), 'utf8'));
const code = (iso) => dayCodeOf(dateOfIso(iso));

test('a November 2026 weekday: Saturday of the 32nd Week, Year II', () => {
  const day = ordoDayOf(ordo, '2026-11-14');
  assert.equal(day.code, 'ot32-6');
  assert.equal(day.name, 'Saturday of the 32nd Week in Ordinary Time');
  assert.equal(day.weekdayCycle, 'II');
  assert.deepEqual(day.citations, { 'First Reading': '3 Jn 1:5-8', 'Responsorial Psalm': 'Ps 112:1-2, 3-4, 5-6', Gospel: 'Lk 18:1-8' });
});

test('the cycles turn at Advent: 2026 is Year A and Year II, Advent 2026 starts Year B and Year I', () => {
  assert.equal(sundayCycleOf(dateOfIso('2026-11-22')), 'A');
  assert.equal(sundayCycleOf(dateOfIso('2026-11-29')), 'B');
  assert.equal(weekdayCycleOf(dateOfIso('2025-11-14')), 'I');
  assert.equal(weekdayCycleOf(dateOfIso('2026-11-14')), 'II');
  assert.equal(weekdayCycleOf(dateOfIso('2026-12-01')), 'I');
});

test('Sundays take the cycle readings, with a Second Reading', () => {
  const day = ordoDayOf(ordo, '2026-11-15');
  assert.equal(day.code, 'ot33');
  assert.equal(day.citations.Gospel, 'Mt 25:14-30');
  assert.equal(day.citations['Second Reading'], '1 Thes 5:1-6');
  assert.equal(code('2026-11-22'), 'christ-king');
  assert.equal(code('2026-11-29'), 'adv1');
  assert.equal(ordoDayOf(ordo, '2026-11-29').citations.Gospel, 'Mk 13:33-37');
});

test('Lent, Holy Week and Easter follow the date of Easter (5 April 2026)', () => {
  assert.equal(code('2026-02-18'), 'ash');
  assert.equal(code('2026-02-19'), 'ash-4');
  assert.equal(code('2026-02-22'), 'lent1');
  assert.equal(code('2026-03-02'), 'lent2-1');
  assert.equal(code('2026-03-29'), 'palm');
  assert.equal(code('2026-04-02'), 'holy-thu');
  assert.equal(code('2026-04-03'), 'good-fri');
  assert.equal(code('2026-04-04'), 'vigil');
  assert.equal(code('2026-04-05'), 'easter');
  assert.equal(code('2026-04-08'), 'east1-3');
  assert.equal(code('2026-04-12'), 'east2');
  assert.equal(code('2026-04-14'), 'east2-2');
});

test('the Philippine calendar: Ascension and Corpus Christi on Sundays, Epiphany between 2 and 8 January, the Santo Nino', () => {
  // Ascension Thursday keeps its weekday readings. (14 May 2026 is that Thursday, but the feast of Saint Matthias outranks it.)
  assert.equal(code('2026-05-14'), '05-14');
  assert.equal(code('2027-05-06'), 'east6-4');
  assert.equal(code('2026-05-17'), 'ascension');
  assert.equal(code('2026-05-24'), 'pentecost');
  assert.equal(code('2026-05-25'), 'ot8-1');
  assert.equal(code('2026-05-31'), 'trinity');
  assert.equal(code('2026-06-07'), 'corpus');
  assert.equal(code('2026-06-12'), 'sacred-heart');
  assert.equal(code('2026-01-04'), 'epiphany');
  assert.equal(code('2026-01-06'), 'epi-2');
  assert.equal(code('2026-01-11'), 'baptism');
  assert.equal(code('2026-01-12'), 'ot1-1');
  assert.equal(code('2026-01-18'), 'santo-nino');
  // Epiphany on 8 January moves the Baptism to the Monday, and Ordinary Time starts on the Tuesday.
  assert.equal(code('2023-01-08'), 'epiphany');
  assert.equal(code('2023-01-09'), 'baptism');
  assert.equal(code('2023-01-10'), 'ot1-2');
});

test('Christmas: the octave, the Holy Family, and the days before Epiphany', () => {
  assert.equal(code('2026-12-24'), '12-24');
  assert.equal(code('2026-12-25'), '12-25');
  assert.equal(code('2026-12-26'), '12-26');
  assert.equal(code('2026-12-27'), 'holy-family');
  assert.equal(code('2026-12-29'), '12-29');
  assert.equal(code('2027-01-01'), '01-01');
  assert.equal(code('2027-01-02'), '01-02');
  assert.equal(code('2027-01-03'), 'epiphany');
  // Christmas on a Sunday puts the Holy Family on Friday 30 December.
  assert.equal(code('2022-12-30'), 'holy-family');
  assert.equal(code('2026-12-17'), '12-17');
  assert.equal(code('2026-12-16'), 'adv3-3');
});

test('solemnities take a Sunday in Ordinary Time, and move off a Sunday of Advent or Lent', () => {
  assert.equal(code('2026-08-15'), '08-15');
  assert.equal(code('2027-08-15'), '08-15');
  assert.equal(code('2026-11-01'), '11-01');
  assert.equal(code('2026-11-02'), '11-02');
  assert.equal(code('2026-11-09'), '11-09');
  assert.equal(code('2026-12-08'), '12-08');
  assert.equal(code('2024-12-08'), 'adv2');
  assert.equal(code('2024-12-09'), '12-08');
  assert.equal(code('2026-03-19'), '03-19');
  // 2024: Easter 31 March, so the Annunciation falls in Holy Week and moves to Monday 8 April; Saint Joseph (a Tuesday in Lent) stays.
  assert.equal(code('2024-03-25'), 'holy-1');
  assert.equal(code('2024-04-08'), '03-25');
  assert.equal(code('2024-03-19'), '03-19');
  // A feast takes a weekday, but not a Sunday unless it is a feast of the Lord.
  assert.equal(code('2026-09-21'), '09-21');
  assert.equal(code('2025-09-21'), 'ot25');
  assert.equal(code('2025-09-14'), '09-14');
});

test('every day from 2024 to 2035 has an entry with a Gospel', () => {
  const missing = [];
  for (let d = new Date(2024, 0, 1); d.getFullYear() < 2036; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const day = ordoDayOf(ordo, d);
    if (!ordo.days[day.code] || !day.citations.Gospel || !day.citations['First Reading'] || !day.citations['Responsorial Psalm']) missing.push(`${d.toDateString()} ${day.code}`);
  }
  assert.deepEqual(missing.slice(0, 10), []);
});

test('every Ordo entry is a day the calendar can reach', () => {
  const reached = new Set();
  for (let d = new Date(2020, 0, 1); d.getFullYear() < 2060; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) reached.add(dayCodeOf(d));
  assert.deepEqual(Object.keys(ordo.days).filter((c) => !reached.has(c)), []);
});

// Citations the shipped WEB cannot answer: Esther's and Daniel's Greek additions, and Susanna.
const NOT_IN_WEB = /^(Est C:|Dn 13:|Dn 3:(?:5[2-9]|[6-8]\d)|Dn 3:25, 34)/;

test('every citation reads, and each of its passages is in the shipped WEB Bible', () => {
  const web = JSON.parse(fs.readFileSync(new URL('../resources/bible/web.json', import.meta.url), 'utf8'));
  const codeOf = new Map(web.books.map((b) => [b.number, b.code]));
  const chapters = new Map();
  for (const [book, chapter, verse] of web.verses) {
    const key = `${codeOf.get(book)} ${chapter}`;
    if (!chapters.has(key)) chapters.set(key, []);
    chapters.get(key).push(verse);
  }
  const bad = [];
  const each = (entry, at) => {
    for (const [key, value] of Object.entries(entry)) {
      if (value && typeof value === 'object') each(value, `${at}.${key}`);
      else if (key !== 'name' && !NOT_IN_WEB.test(value)) {
        const parsed = parseLectionaryCitation(value);
        if (!parsed) bad.push(`${at}.${key} unreadable: ${value}`);
        else {
          // Numbered as the Lectionary numbers them, as bibleService reads them.
          const numbered = [...new Set(chaptersOf(parsed).flatMap((c) => bibleChaptersOf(parsed.code, c)))].flatMap((c) => {
            const verses = chapters.get(`${parsed.code} ${c}`) ?? [];
            return verses.map((v) => lectionaryRefOf(parsed.code, c, v, verses.length));
          });
          for (const passage of parsed.passages)
            if (!numbered.some((ref) => inPassage(passage, ref.chapter, ref.verse))) bad.push(`${at}.${key} ${value}: nothing at ${passage.chapter}:${passage.from}`);
        }
      }
    }
  };
  for (const [day, entry] of Object.entries(ordo.days)) each(entry, day);
  assert.deepEqual(bad, []);
});
