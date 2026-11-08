// The web planner's per-plan language and Mass time: the Tagalog and Cebuano names are the church laptop's, the Mass times follow the plan's
// day, the save sends both, and the editor shows them. Run with: node --test server/test/web-mass-language.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const web = (file) => import(pathToFileURL(path.join(root, 'web', 'js', file)).href);
const readWeb = (rel) => fs.readFileSync(path.join(root, 'web', rel), 'utf8');

const lang = await web('mass-language.js');
const schedule = await web('mass-schedule.js');
const model = await web('plan-model.js');
const webSlots = await web('mass-slots.js');
const laptopSlots = await import(pathToFileURL(path.join(root, 'shared', 'mass-slots.js')).href);
const laptopLang = await import(pathToFileURL(path.join(root, 'shared', 'mass-language.js')).href);

test('the web offers the laptop\'s three Mass languages', () => {
  assert.deepEqual(lang.MASS_LANGUAGES.map((l) => l.code), laptopLang.MASS_LANGUAGES);
  assert.equal(lang.DEFAULT_MASS_LANGUAGE, laptopLang.DEFAULT_MASS_LANGUAGE);
  assert.equal(lang.massLanguageOf(undefined), 'EN', 'a plan saved before languages is English');
  assert.equal(lang.massLanguageOf('XX'), 'EN');
  assert.equal(lang.massLanguageOf('CEB'), 'CEB');
});

test('every slot\'s name in English, Tagalog and Cebuano is the laptop\'s, slot by slot', () => {
  const numberOf = new Map(laptopSlots.MASS_SLOTS.map((s) => [s.id, s.number]));
  for (const code of laptopLang.MASS_LANGUAGES) {
    for (const section of laptopLang.PHILIPPINE_MASS_FLOW[code].sections) {
      for (const slot of section.slots) {
        const webSlot = webSlots.slotOfNumber(numberOf.get(slot.id));
        assert.equal(lang.slotName(webSlot, code), slot.label, `${code} slot ${slot.id}`);
      }
    }
  }
});

test('every part of the Mass is titled as on the laptop, in each language', () => {
  for (const code of laptopLang.MASS_LANGUAGES) {
    const laptopTitles = laptopLang.PHILIPPINE_MASS_FLOW[code].sections.map((s) => s.title);
    const webTitles = webSlots.MASS_SECTIONS.map((s) => `${s.number}. ${lang.sectionName(s, code).toUpperCase()}`);
    assert.deepEqual(webTitles, laptopTitles, code);
  }
});

test('an editor row is named in the plan\'s language; an other step keeps its own name', () => {
  assert.equal(lang.slotName({ slot: 12, name: "The Lord's Prayer (Our Father)" }, 'TL'), 'Ama Namin');
  assert.equal(lang.slotName({ slot: 12, name: "The Lord's Prayer (Our Father)" }, 'CEB'), 'Amahan Namo');
  assert.equal(lang.slotName({ slot: null, name: 'Greeting' }, 'TL'), 'Greeting');
});

test('the Mass times follow the plan\'s day: Sunday Masses, the anticipated Mass on Saturday, the daily Masses on a weekday', () => {
  const list = [
    { day: 0, time: '10:00' },
    { day: 0, time: '06:00', label: 'Early' },
    { day: 6, time: '17:30', label: 'Anticipated' },
    { day: -1, time: '06:00', label: 'Morning' },
    { day: -1, time: '18:00' },
    { day: 2, time: 'bad' },
  ];
  // 1 Nov 2026 is a Sunday, 31 Oct a Saturday, 3 Nov a Tuesday.
  assert.deepEqual(schedule.massTimesFor('2026-11-01', list).map((t) => t.label), ['6:00 AM · Early', '10:00 AM', '6:00 PM']);
  assert.deepEqual(schedule.massTimesFor('2026-10-31', list).map((t) => t.time), ['06:00', '17:30', '18:00']);
  assert.deepEqual(schedule.massTimesFor('2026-11-03', list).map((t) => t.time), ['06:00', '18:00']);
  assert.equal(schedule.timeLabel('00:15'), '12:15 AM');
  assert.equal(schedule.timeLabel('12:00'), '12:00 PM');
  assert.equal(schedule.timeLabel('8:00'), '');
});

test('the parish schedule itself is valid, and every day of the week has at least one Mass time', () => {
  for (const entry of schedule.PARISH_MASS_SCHEDULE) {
    assert.ok(schedule.isMassTime(entry.time), entry.time);
    assert.ok(Number.isInteger(entry.day) && entry.day >= -1 && entry.day <= 6);
  }
  for (let d = 1; d <= 7; d += 1) assert.ok(schedule.massTimesFor(`2026-11-0${d}`).length > 0, `day ${d}`);
});

test('the save sends the language and Mass time when given, and only then', () => {
  const plan = { id: 'p1', updatedAt: '2026-10-27T10:00:00.000Z' };
  assert.deepEqual(model.savePayload(plan, []), { id: 'p1', baseUpdatedAt: plan.updatedAt, items: [] });
  assert.deepEqual(model.savePayload(plan, [], { language: 'TL', massTime: '08:00' }), {
    id: 'p1', baseUpdatedAt: plan.updatedAt, items: [], language: 'TL', massTime: '08:00',
  });
  assert.equal(model.savePayload(plan, [], { language: 'EN', massTime: '' }).massTime, null, 'no time clears it');
});

test('the Holy Mass editor has the language switch and the Mass time, and saves them', () => {
  const html = readWeb('plan/mass.html');
  assert.match(html, /id="language"[^>]*role="radiogroup"/);
  assert.match(html, /<select id="mass-time"/);
  assert.match(html, /<label for="mass-time"/);
  const js = readWeb('js/mass.js');
  assert.match(js, /savePayload\(plan, massToItems\(state, ROWS\), details\)/);
  assert.match(js, /sectionName\(section, state\.language\)/);
});

test('the sign-in page has the forgot-password dialog and the sync badge, and its script is not inline', () => {
  const html = readWeb('login.html');
  assert.match(html, /<button type="button" id="forgot-open"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /<dialog id="forgot-dialog"[^>]*aria-labelledby="forgot-title"/);
  assert.match(html, /v1\.0\.59 Sync Ready/);
  assert.match(html, /name="destination" value="planner" checked/, 'Ministry Planner is the default tab');
  assert.match(html, /name="destination" value="booth"/);
  assert.match(html, /id="code-status"[^>]*aria-live="polite"/, 'the church code status is announced');
  const js = readWeb('js/login.js');
  assert.match(js, /booth: 'devices\.html'/, 'Booth Operator Sync lands on Devices & sync');
  assert.match(js, /remember\(reply\.churchCode, reply\.churchName\)/, 'the parish name is remembered only from a successful sign-in');
  assert.doesNotMatch(html, /<script(?![^>]*src=)/, 'the CSP allows no inline script');
  assert.doesNotMatch(html, /@[a-z0-9-]+\.[a-z]{2,}/i, 'no made-up email address');
  assert.match(readWeb('js/login.js'), /forgot\.showModal\(\)/);
});
