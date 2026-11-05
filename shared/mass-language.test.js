// The language a Holy Mass plan is celebrated in, and the Bible and app language it reads from. Run with: node --test shared/mass-language.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGE_BIBLE_MAP, MASS_LANGUAGES, PHILIPPINE_MASS_FLOW, bibleOf, massLanguageOf, otherBibles, sectionTitle, slotDefaultTitle, slotLabel, uiLangOf } from './mass-language.js';
import { MASS_SECTIONS, MASS_SLOTS, slotById } from './mass-slots.js';

test('the Philippine order of Mass has the same four parts and slots in every language, in Mass order', () => {
  for (const language of MASS_LANGUAGES) {
    const flow = PHILIPPINE_MASS_FLOW[language];
    assert.deepEqual(flow.sections.map((s) => s.id), ['introductory_rites', 'liturgy_of_the_word', 'liturgy_of_the_eucharist', 'concluding_rites']);
    assert.deepEqual(flow.sections.flatMap((s) => s.slots.map((slot) => slot.id)), MASS_SLOTS.map((s) => s.id), language);
    for (const slot of flow.sections.flatMap((s) => s.slots)) assert.ok(slot.label, `${language} ${slot.type} has a label`);
  }
  assert.deepEqual(PHILIPPINE_MASS_FLOW.EN.sections.map((s) => s.title), ['1. INTRODUCTORY RITES', '2. LITURGY OF THE WORD', '3. LITURGY OF THE EUCHARIST', '4. CONCLUDING RITES']);
  assert.deepEqual(PHILIPPINE_MASS_FLOW.TL.sections.map((s) => s.title), ['1. MGA PAMBUNGAD NA RITO', '2. LITURHIYA NG SALITA NG DIYOS', '3. LITURHIYA NG EUKARISTIYA', '4. MGA PANGWAKAS NA RITO']);
  assert.deepEqual(PHILIPPINE_MASS_FLOW.CEB.sections.map((s) => s.title), ['1. MGA PASIUNANG RITO', '2. LITURHIYA SA PULONG', '3. LITURHIYA SA EUKARISTIYA', '4. MGA PANAPOS NGA RITO']);
});

test('slots and parts are named in the Mass language, with the app language accepted too', () => {
  assert.equal(slotLabel(slotById('entrance'), 'TL'), 'Pambungad na Awit');
  assert.equal(slotLabel(slotById('entrance'), 'ceb'), 'Awit sa Pagsulod');
  assert.equal(slotLabel(slotById('recessional'), 'CEB'), 'Awit sa Pagpawa');
  assert.equal(slotLabel(slotById('gospel'), 'EN'), 'Holy Gospel');
  assert.equal(slotLabel(slotById('doxology'), 'TL'), 'Doxology', 'a slot with no Tagalog name keeps its English one');
  assert.equal(slotDefaultTitle(slotById('final-blessing'), 'TL'), 'Humayo Kayo sa Kapayapaan');
  assert.equal(slotDefaultTitle(slotById('entrance'), 'EN'), null);
  assert.equal(sectionTitle(MASS_SECTIONS[2], 'tl'), 'Liturhiya ng Eukaristiya');
});

test('the flow marks hymns, readings, Sunday parts and optional parts as the slots do', () => {
  const en = Object.fromEntries(PHILIPPINE_MASS_FLOW.EN.sections.flatMap((s) => s.slots).map((slot) => [slot.type, slot]));
  assert.deepEqual(en.GLORIA, { id: 'gloria', type: 'GLORIA', label: 'Glory to God (Gloria)', defaultTitle: 'Glory to God in the Highest', isHymn: true, sundayOnly: true });
  assert.deepEqual(en.RESPONSORIAL_PSALM, { id: 'psalm', type: 'RESPONSORIAL_PSALM', label: 'Responsorial Psalm', isHymn: true, isReading: true });
  assert.deepEqual(en.HOMILY, { id: 'homily', type: 'HOMILY', label: 'Homily', optional: true });
});

test('each Mass language reads its own offline Bible: WEB, TGL, CEB', () => {
  assert.deepEqual(MASS_LANGUAGES, ['EN', 'TL', 'CEB']);
  assert.deepEqual(LANGUAGE_BIBLE_MAP, { EN: 'WEB', TL: 'TGL', CEB: 'CEB' });
  assert.equal(bibleOf('TL'), 'TGL');
  assert.deepEqual(otherBibles('EN'), ['TGL', 'CEB']);
});

test("a plan's saved value or the app's language becomes a Mass language, and anything else is English", () => {
  assert.equal(massLanguageOf('ceb'), 'CEB');
  assert.equal(massLanguageOf('tl'), 'TL');
  assert.equal(massLanguageOf('fr'), 'EN');
  assert.equal(massLanguageOf(null), 'EN');
  assert.equal(uiLangOf('CEB'), 'ceb');
  assert.equal(uiLangOf('nope'), 'en');
});
