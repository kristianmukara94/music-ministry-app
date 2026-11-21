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

test('the save sends the language and Mass time when given, and only then', () => {
  const plan = { id: 'p1', updatedAt: '2026-10-27T10:00:00.000Z' };
  assert.deepEqual(model.savePayload(plan, []), { id: 'p1', baseUpdatedAt: plan.updatedAt, items: [] });
  assert.deepEqual(model.savePayload(plan, [], { language: 'TL', massTime: '08:00' }), {
    id: 'p1', baseUpdatedAt: plan.updatedAt, items: [], language: 'TL', massTime: '08:00',
  });
  assert.equal(model.savePayload(plan, [], { language: 'EN', massTime: '' }).massTime, null, 'no time clears it');
  assert.deepEqual(model.savePayload(plan, [], { massTime: '6:00 AM', massLanguage: 'Cebuano' }), {
    id: 'p1', baseUpdatedAt: plan.updatedAt, items: [], massTime: '6:00 AM', massLanguage: 'Cebuano',
  }, 'the schedule as the laptop keeps it');
  assert.equal(model.savePayload(plan, [], { massLanguage: '' }).massLanguage, null, 'no schedule language clears it');
});

test('the Holy Mass editor has the readings language switch and the Holy Mass schedule fields, and saves them', () => {
  const html = readWeb('plan/mass.html');
  assert.match(html, /id="language"[^>]*role="radiogroup"/);
  // The schedule is the control strip's: EN / TL / CEB, Other with its own box, and the time in the popover of HOLY MASSES ON THIS DAY.
  assert.match(html, /<button type="button" id="lang-other"/);
  assert.match(html, /<input id="lang-other-input"[^>]*maxlength="30"/);
  assert.match(html, /<div id="time-popover"[^>]*role="dialog"/);
  assert.match(html, /<div id="schedule-conflict"/);
  assert.match(html, /<nav id="schedule-switcher" class="bc-switcher"/);
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
