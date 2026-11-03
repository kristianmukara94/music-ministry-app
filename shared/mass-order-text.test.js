// Tests the Holy Mass Order words and titles as the parish edits them: the text format, what is refused, which words and title a part shows in
// English, Tagalog and Cebuano, the parish's own items, and how a renamed part reaches the planner's cards.
// Run with: node --test shared/mass-order-text.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CEB_STANDARD,
  MASS_ORDER_TEMPLATES,
  checkMassOrderText,
  cleanTitle,
  customParts,
  effectiveSlides,
  effectiveTitle,
  entryForSave,
  isCustomId,
  isCustomized,
  massOrderLang,
  overridesFromRows,
  slidesToText,
  textToSlides,
  withPartNames,
} from './mass-order-text.js';
import { splitDeck } from './projector-autofit.js';

const memorial = {
  id: 'memorial-acclamation',
  name: { en: 'Memorial Acclamation', tl: 'Pagbubunyi', ceb: CEB_STANDARD['memorial-acclamation'].name },
  slides: {
    en: [[{ role: 'priest', text: 'The mystery of faith.' }, { role: 'all', text: 'We proclaim your Death, O Lord, and profess your Resurrection until you come again.' }]],
    tl: [[{ role: 'priest', text: 'Ipagbunyi natin ang misteryo ng pananampalataya.' }, { role: 'all', text: 'Si Kristo’y gunitain…' }]],
    ceb: textToSlides(CEB_STANDARD['memorial-acclamation'].text),
  },
};

test('a part\'s slides become editor text and come back the same', () => {
  const text = slidesToText(memorial.slides.en);
  assert.equal(text, 'P: The mystery of faith.\nWe proclaim your Death, O Lord, and profess your Resurrection until you come again.');
  assert.deepEqual(textToSlides(text), memorial.slides.en);
  const twoSlides = [[{ role: 'all', text: 'One' }], [{ role: 'priest', text: 'Two' }, { role: 'all', text: 'Three' }]];
  assert.deepEqual(textToSlides(slidesToText(twoSlides)), twoSlides);
});

test('a blank line starts a slide; P: marks the priest; All: and no mark are the people', () => {
  const slides = textToSlides('P: Lord, have mercy.\r\nAll: Lord, have mercy.\n\n   \n\nChrist, have mercy.\n  priest:  Pray, brethren  ');
  assert.deepEqual(slides, [
    [{ role: 'priest', text: 'Lord, have mercy.' }, { role: 'all', text: 'Lord, have mercy.' }],
    [{ role: 'all', text: 'Christ, have mercy.' }, { role: 'priest', text: 'Pray, brethren' }],
  ]);
  assert.deepEqual(textToSlides('\n\n'), []);
  assert.deepEqual(textToSlides('P:   '), [], 'a mark with no words is not a line');
});

test('words that make no slide, too many slides or too much text are refused with what to fix; titles are cleaned', () => {
  assert.equal(checkMassOrderText('Holy, Holy, Holy').ok, true);
  const empty = checkMassOrderText('   ');
  assert.equal(empty.ok, false);
  assert.match(empty.error, /Reset to Standard Missal Text/);
  assert.match(checkMassOrderText(Array.from({ length: 61 }, (_, i) => `Slide ${i}`).join('\n\n')).error, /at most 60/);
  assert.match(checkMassOrderText('x'.repeat(20001)).error, /too long/);
  assert.equal(cleanTitle('  Act of   Spiritual\nCommunion '), 'Act of Spiritual Communion');
  assert.equal(cleanTitle('   '), null);
  assert.equal(cleanTitle(null), null);
  assert.throws(() => cleanTitle('x'.repeat(121)), /too long/);
});

// ---- Cebuano ----

test('every built-in part has a standard Cebuano name and words, starting as the Missal does', () => {
  const ids = ['kyrie', 'gloria', 'credo', 'sanctus', 'memorial-acclamation', 'pater-noster', 'agnus-dei'];
  for (const id of ids) {
    assert.ok(CEB_STANDARD[id]?.name, `${id} has a Cebuano name`);
    assert.equal(checkMassOrderText(CEB_STANDARD[id].text).ok, true, `${id} makes slides`);
  }
  assert.match(CEB_STANDARD.kyrie.text, /^P: Ginoo, kaloy-i kami\./);
  assert.match(CEB_STANDARD.gloria.text, /^Himaya sa Dios sa kahitas-an/);
  assert.match(CEB_STANDARD.sanctus.text, /^Santos, santos, santos, Ginoong Dios sa kagahuman\.\nPuno ang langit ug yuta sa imong himaya\.\nOsana sa kahitas-an\./);
  assert.match(CEB_STANDARD['pater-noster'].text, /^Amahan namo, nga anaa sa mga langit/);
  assert.match(CEB_STANDARD['agnus-dei'].text, /^Kordero sa Dios, nga nagawagtang sa mga sala sa kalibutan/);
  assert.equal(textToSlides(CEB_STANDARD.gloria.text).length, 6, 'the Gloria keeps its six slides, as in English and Tagalog');
  // None is so long that the projector has to cut a slide in parts.
  for (const id of ids) assert.equal(splitDeck(id, textToSlides(CEB_STANDARD[id].text)).labels, null, `${id} fits without splitting`);
});

test('Cebuano is its own language: its standard words, and its own edits, never the Tagalog', () => {
  assert.equal(massOrderLang('ceb'), 'ceb');
  assert.equal(massOrderLang('fr'), 'en');
  assert.equal(effectiveSlides(memorial, 'ceb', {}), memorial.slides.ceb);
  assert.equal(effectiveTitle(memorial, 'ceb', {}), 'Ang Misteryo sa Pagtuo');
  const overrides = { 'memorial-acclamation': { ceb: { text: 'P: Ang misteryo sa pagtoo.\nGinasangyaw namo ang imong kamatayon.', title: 'Pagsangyaw' } } };
  assert.equal(effectiveSlides(memorial, 'ceb', overrides)[0][1].text, 'Ginasangyaw namo ang imong kamatayon.');
  assert.equal(effectiveTitle(memorial, 'ceb', overrides), 'Pagsangyaw');
  assert.equal(effectiveSlides(memorial, 'tl', overrides), memorial.slides.tl, 'the Cebuano edit leaves Tagalog alone');
  assert.equal(effectiveTitle(memorial, 'tl', overrides), 'Pagbubunyi');
});

// ---- Words and titles ----

test('a part shows the parish words and title when it has them, and the standard ones otherwise', () => {
  assert.equal(effectiveSlides(memorial, 'en', {}), memorial.slides.en);
  const overrides = { 'memorial-acclamation': { en: { text: 'P: The mystery of faith.\nWhen we eat this Bread and drink this Cup, we proclaim your Death, O Lord, until you come again.', title: null } } };
  assert.equal(effectiveSlides(memorial, 'en', overrides)[0][1].text, 'When we eat this Bread and drink this Cup, we proclaim your Death, O Lord, until you come again.');
  assert.equal(effectiveTitle(memorial, 'en', overrides), 'Memorial Acclamation', 'new words keep the standard title');
  // A title alone: the words stay standard.
  const renamed = { 'memorial-acclamation': { en: { text: null, title: 'Mystery of Faith' } } };
  assert.equal(effectiveTitle(memorial, 'en', renamed), 'Mystery of Faith');
  assert.equal(effectiveSlides(memorial, 'en', renamed), memorial.slides.en);
  // Saved words that somehow make no slide fall back to the standard text rather than showing nothing.
  assert.equal(effectiveSlides(memorial, 'en', { 'memorial-acclamation': { en: { text: '  ', title: null } } }), memorial.slides.en);
});

test('the editor stores only what differs from the standard text and title', () => {
  const standard = { standardText: slidesToText(memorial.slides.en), standardTitle: 'Memorial Acclamation' };
  assert.deepEqual(entryForSave({ text: standard.standardText, title: 'Memorial Acclamation' }, standard), { text: null, title: null });
  assert.deepEqual(entryForSave({ text: `${standard.standardText}\n`, title: ' Mystery of Faith ' }, standard), { text: null, title: 'Mystery of Faith' });
  assert.deepEqual(entryForSave({ text: 'Amen.', title: '' }, standard), { text: 'Amen.', title: null }, 'an emptied title goes back to the standard one');
});

test('the store builds its overrides from the saved rows and marks edited parts', () => {
  const overrides = overridesFromRows([
    { partId: 'gloria', lang: 'en', text: 'Glory to God', title: null },
    { partId: 'gloria', lang: 'ceb', text: null, title: 'Himaya' },
    { partId: 'Bad Id', lang: 'en', text: 'x', title: null },
    { partId: 'credo', lang: 'fr', text: 'x', title: null },
    { partId: 'credo', lang: 'en', text: null, title: null },
  ]);
  assert.deepEqual(overrides, { gloria: { en: { text: 'Glory to God', title: null }, ceb: { text: null, title: 'Himaya' } } });
  assert.equal(isCustomized('gloria', 'en', overrides), true);
  assert.equal(isCustomized('gloria', 'ceb', overrides), true, 'a title alone counts as an edit');
  assert.equal(isCustomized('gloria', 'tl', overrides), false);
  assert.equal(isCustomized('credo', 'en', overrides), false);
});

// ---- The parish's own items ----

const SPIRITUAL = 'mass_order_custom_5b7f0f3c-2a6e-4d1b-9a77-0c4c1b2f9e10';

test('a parish item is listed with its own id, and shows its title and words in the nearest language that has them', () => {
  assert.equal(isCustomId(SPIRITUAL), true);
  assert.equal(isCustomId('kyrie'), false);
  const [item] = customParts([{ id: SPIRITUAL, createdAt: '2026-11-03' }, { id: 'kyrie' }, { id: 'mass_order_custom_BAD ID' }]);
  assert.deepEqual(item, { id: SPIRITUAL, name: {}, slides: {}, custom: true });
  assert.equal(customParts([{ id: SPIRITUAL }, { id: 'kyrie' }]).length, 1);
  const overrides = {
    [SPIRITUAL]: {
      en: { text: 'P: My Jesus, I believe that you are present in the Most Holy Sacrament.\nI love you above all things.', title: 'Act of Spiritual Communion' },
      ceb: { text: null, title: 'Buhat sa Espirituhanong Pakigkomunyon' },
    },
  };
  assert.equal(effectiveTitle(item, 'en', overrides), 'Act of Spiritual Communion');
  assert.equal(effectiveTitle(item, 'ceb', overrides), 'Buhat sa Espirituhanong Pakigkomunyon');
  assert.equal(effectiveTitle(item, 'tl', overrides), 'Act of Spiritual Communion', 'no Tagalog title: the English one');
  assert.equal(effectiveSlides(item, 'ceb', overrides)[0][0].text, 'My Jesus, I believe that you are present in the Most Holy Sacrament.', 'no Cebuano words: the English ones');
  assert.deepEqual(effectiveSlides(item, 'en', {}), [], 'a deleted item has nothing to show');
});

test('a long parish item is split into labelled parts for the projector', () => {
  const lines = Array.from({ length: 12 }, (_, i) => `P: Line ${i + 1} of the diocesan synod prayer.`).join('\n');
  const { slides, labels } = splitDeck('Diocesan Synod Prayer', textToSlides(lines));
  assert.equal(slides.length, 2);
  assert.deepEqual(labels, ['Diocesan Synod Prayer (1/2)', 'Diocesan Synod Prayer (2/2)']);
  assert.ok(slides.flat().every((line) => line.role === 'priest'));
});

test('a renamed part is renamed on every planner card; a deleted parish item is marked missing', () => {
  const items = [
    { module: 'mass_order', sourceId: 'kyrie', label: 'Kyrie (Lord, Have Mercy)', block: 'introductory' },
    { module: 'mass_order', sourceId: SPIRITUAL, label: 'Act of Spiritual Communion', block: 'communion' },
    { module: 'lyrics', sourceId: '12', label: 'Here I Am, Lord', block: 'introductory' },
    { module: 'mass_order', sourceId: 'gloria', label: 'Gloria', block: 'introductory' },
  ];
  const names = { kyrie: 'Kyrie Eleison', gloria: 'Gloria' };
  const shown = withPartNames(items, (id) => names[id] ?? null);
  assert.equal(shown[0].label, 'Kyrie Eleison');
  assert.equal(shown[1].stale, true);
  assert.equal(shown[1].label, 'Act of Spiritual Communion', 'the missing item keeps the name it had');
  assert.equal(shown[2], items[2], 'a song row is left as it was');
  assert.equal(shown[3], items[3], 'a row already under its title is left as it was');
  assert.equal(withPartNames(items, () => null)[0], items[0], 'a built-in part is never marked missing');
});

// ---- The Cebuano texts against the published Mass guides, and the Nicene Creed template ----

test('the Cebuano Kyrie, Agnus Dei, Sanctus, Lord\'s Prayer and Memorial Acclamation say what the published Cebuano Mass guides say', () => {
  const lines = (id) => textToSlides(CEB_STANDARD[id].text).flat();
  assert.deepEqual(lines('kyrie').map((l) => [l.role, l.text]), [
    ['priest', 'Ginoo, kaloy-i kami.'], ['all', 'Ginoo, kaloy-i kami.'],
    ['priest', 'Kristo, kaloy-i kami.'], ['all', 'Kristo, kaloy-i kami.'],
    ['priest', 'Ginoo, kaloy-i kami.'], ['all', 'Ginoo, kaloy-i kami.'],
  ]);
  assert.deepEqual(lines('agnus-dei').map((l) => l.text), [
    'Kordero sa Dios, nga nagawagtang sa mga sala sa kalibutan, kaloy-i kami.',
    'Kordero sa Dios, nga nagawagtang sa mga sala sa kalibutan, kaloy-i kami.',
    'Kordero sa Dios, nga nagawagtang sa mga sala sa kalibutan, hatagi kami sa kalinaw.',
  ]);
  assert.equal(lines('sanctus').at(-1).text, 'Osana sa kahitas-an.');
  assert.match(CEB_STANDARD['pater-noster'].text, /^Amahan namo, nga anaa sa mga langit, pagdaygon ang imong ngalan, umabut kanamo ang imong gingharian/);
  assert.match(CEB_STANDARD['pater-noster'].text, /Kay imo man ang gingharian, ug ang gahum, ug ang himaya, hangtud sa kahangturan\.$/);
  assert.deepEqual(lines('memorial-acclamation').map((l) => [l.role, l.text]), [
    ['priest', 'Kini ang misteryo sa pagtuo.'],
    ['all', 'Si Kristo namatay, si Kristo nabanhaw, si Kristo mobalik nganhi.'],
  ]);
});

test('the Credo stays the Apostles\' Creed; the Nicene Creed is a template for a new parish item, in English and Cebuano', () => {
  assert.match(CEB_STANDARD.credo.text, /^Nagatoo ako sa Dios, Amahan nga makagagahum sa tanan/);
  assert.doesNotMatch(CEB_STANDARD.credo.text, /usa ka Dios/, 'the standard Credo is not the Nicene Creed');
  const nicene = MASS_ORDER_TEMPLATES.find((x) => x.id === 'nicene-creed');
  assert.ok(nicene);
  assert.match(nicene.entries.ceb.text, /^Nagatoo ako sa usa ka Dios, ang Amahan ang makagagahum sa tanan/);
  assert.match(nicene.entries.en.text, /^I believe in one God, the Father almighty, maker of heaven and earth, of all things visible and invisible\./);
  assert.match(nicene.entries.en.text, /consubstantial with the Father/, 'the 2011 Missal wording');
  for (const [lang, entry] of Object.entries(nicene.entries)) {
    assert.ok(entry.title && cleanTitle(entry.title) === entry.title, `${lang} has a clean title`);
    const checked = checkMassOrderText(entry.text);
    assert.equal(checked.ok, true, `${lang} makes slides`);
    assert.equal(checked.slides.length, 8, `${lang}: eight slides, one per article`);
    assert.equal(splitDeck(entry.title, checked.slides).labels, null, `${lang} fits without splitting`);
    assert.match(entry.text, /Amen\.$/);
  }
});
