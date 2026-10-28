// The Notes & Prayers split, used by every surface: the breaks the operator places by hand are hard boundaries, the sections between them are
// split by the automatic rule where they are too long for one slide, and with no breaks the whole prayer uses the automatic split. Tested on
// the prayer on the laptop (its text is kept here, as saved). Run with: node --test shared/prayer-manual.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE, segmentFromTemplate, slidesFor } from './pw.js';
import { PRAYER_MAX_PX, prayerSlidesFor } from './prayer-slides.js';
import { screenPagesOf, splitSummaryOf } from './prayer-screen.js';
import { manualParts, normalizeSplit, splitFingerprint } from './prayer-split.js';

const LAPTOP = "In the name of Jesus, I take authority, and I bind all the powers and forces in the air, in the ground, in the water, in the underground, in the netherworld, in nature, and in fire.  You are the Lord over the entire universe, and I give you the glory for your creation.  In your name, I bind all demonic forces that have come against our families and us, and I seal all of us in the protection of your precious blood that was shed for us on the cross.\nMary Our Mother, we seek your protection and intercession, with the Sacred Heart of Jesus, for our families and us, and surround us with your mantle of love to discourage the enemy.\nSt. Michael and our Guardian Angels, come and defend us and our families in battle against all the evil ones that roam the earth.\nIn the name of Jesus, I bind and command all the powers and forces of evil to depart right now away from us, our families, our homes, and our lands, and I cast you at the foot of the cross to remain there forever. And I thank you, Lord Jesus, for you are a faithful and compassionate God, Amen.\nHail Mary, Full of Grace, the Lord is with thee.\nBlessed art thou among women,\nand blessed be the fruit of thy womb, Jesus.\nHoly Mary, Mother of God, pray for us sinners now\nand at the hour of our death.  Amen.";
const LINES = LAPTOP.split('\n');
// The breaks the operator placed on the laptop: after lines 0, 1, 2, 3, 5 and 7.
// As saved: the split carries the fingerprint of the text it was made for.
const MANUAL = { mode: 'manual', at: [0, 1, 2, 3, 5, 7], of: splitFingerprint(LAPTOP) };
const words = (text) => String(text).split(/\s+/).filter(Boolean);
const texts = (split) => prayerSlidesFor(LAPTOP, split).pages.map((p) => p.text);

test('(a) a manual split is honoured exactly: every section that fits is one slide, as placed', () => {
  const slides = texts(MANUAL);
  // The sections that fit a slide at full size are exactly the lines the operator placed them on.
  for (const k of [1, 2, 8]) assert.ok(slides.includes(LINES[k]), `line ${k} is one slide, as placed`);
  assert.ok(slides.includes(`${LINES[4]}\n${LINES[5]}`), 'lines 4 and 5 are one slide, as placed');
  assert.ok(slides.includes(`${LINES[6]}\n${LINES[7]}`), 'lines 6 and 7 are one slide, as placed');
});

test('(b) an unsplit section between manual boundaries uses the automatic split', () => {
  // Line 0 is too long for one slide and has no break inside it: it is split by the automatic rule, as it would be alone.
  const automaticForLine0 = prayerSlidesFor(LINES[0], null).pages.map((p) => p.text);
  assert.ok(automaticForLine0.length > 1, 'line 0 needs more than one slide');
  const slides = texts(MANUAL);
  assert.deepEqual(slides.slice(0, automaticForLine0.length), automaticForLine0, 'the automatic split of line 0 fills its section');
});

test("(c) a manual part too long for one slide is split automatically within it, and the operator's boundaries do not move", () => {
  const slides = texts(MANUAL);
  // Each section holds exactly its own words, and its slides come next, in order: the operator's boundary after each section is kept.
  let at = 0;
  for (const section of manualParts(LAPTOP, MANUAL.at)) {
    const count = prayerSlidesFor(section, null).pages.length;
    assert.deepEqual(words(slides.slice(at, at + count).join(' ')), words(section), `the slides of "${section.slice(0, 30)}" hold exactly that section`);
    at += count;
  }
  assert.equal(at, slides.length, 'no slide is left outside a section');
});

test('(d) with no manual split, the whole prayer uses the automatic split', () => {
  const auto = prayerSlidesFor(LAPTOP, null);
  assert.equal(auto.mode, 'auto');
  assert.equal(auto.manualBreaks, 0);
  assert.deepEqual(prayerSlidesFor(LAPTOP, { mode: 'manual', at: [] }).pages, auto.pages, 'an empty manual split is the automatic split');
  assert.deepEqual(prayerSlidesFor(LAPTOP, { mode: 'auto' }).pages, auto.pages);
  assert.deepEqual(normalizeSplit({ mode: 'manual', at: [] }, LAPTOP), { mode: 'manual', at: [] });
});

test('(e) the same split appears on every surface: the Notes preview and full-screen view, the lineup and the live preview', () => {
  const note = { title: 'prayer to take autority', body: LAPTOP, style: null, split: MANUAL };
  const shared = texts(MANUAL);
  assert.deepEqual(screenPagesOf(note).map((p) => p.text), shared, 'the Notes & Prayers preview and full-screen view');
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority')) };
  const lineup = slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { prayer: { title: note.title, body: LAPTOP, split: MANUAL } }).filter((s) => s.kind === 'prayer');
  assert.deepEqual(lineup.map((s) => s.text), shared, 'the lineup and the live preview, and the projector draws the lineup slide');
});

test('(f) no words are lost or repeated, with or without manual splits', () => {
  for (const split of [MANUAL, null, { mode: 'manual', at: [] }, { mode: 'manual', at: [0] }]) {
    assert.deepEqual(words(texts(split).join(' ')), words(LAPTOP));
  }
});

test('the panel counts: the breaks placed by hand, and the slides the automatic rule adds beyond them', () => {
  const manual = splitSummaryOf({ body: LAPTOP, split: MANUAL });
  assert.equal(manual.mode, 'manual');
  assert.equal(manual.manualBreaks, 6);
  assert.equal(manual.automaticSlides, prayerSlidesFor(LAPTOP, MANUAL).pages.length - 7, 'seven sections, and the rest are automatic');
  assert.equal(manual.slides, 10);
  const auto = splitSummaryOf({ body: LAPTOP, split: null });
  assert.equal(auto.mode, 'auto');
  assert.equal(auto.manualBreaks, 0);
  assert.equal(auto.slides, 8);
});

test('every slide of the laptop prayer is at full size, and each slide has its own centred top', () => {
  const { pages, fontPx } = prayerSlidesFor(LAPTOP, MANUAL);
  assert.equal(fontPx, PRAYER_MAX_PX);
  for (const page of pages) {
    assert.equal(page.fontPx, PRAYER_MAX_PX);
    assert.equal(typeof page.top, 'number');
  }
});
