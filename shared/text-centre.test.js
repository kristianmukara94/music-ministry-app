// Where prayer and lyric text starts on the slide, on every surface. Normal slides of one group (a prayer, or a song's stanzas) share one top in
// the text area, so the text does not jump between them. A short slide (its block less than 75% of the tallest block in its group) is centred
// vertically in the text area on its own. The rule is the same on the lineup, the live preview, the projector and the Notes & Prayers view.
// Horizontal centring, the text size, the split and the lower third are unchanged. Run with: node --test shared/text-centre.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEMPLATE, segmentFromTemplate, slidesFor } from './pw.js';
import { pageTops, prayerBlockHeightPx, prayerSlidesFor, PRAYER_MAX_PX } from './prayer-slides.js';
import { screenPagesOf } from './prayer-screen.js';
import { SHORT_BLOCK_SHARE, blockTops, blockTopShare, textAreaShare } from './text-area.js';
import { STAGE_H } from './lower-third-layout.js';
import { lyricBottomOf } from './lyric-area.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// The sample prayer. Its four slides are 480, 360, 360 and 480px: the 360px ones are exactly 75% of the tallest, so they count as normal.
const LONG = 'Lord God, we ask you to take authority over every power that would turn our hearts away from you and our families away from your house. Through the intercession of Saint Michael the Archangel, who stands before your throne, and of Our Lady, Queen of the Angels and the Saints, we pray that your Word be proclaimed without fear in this parish!';
const SAMPLE = `${LONG}\n\nHoly Spirit, fill this place with your presence and your peace; let every worship song lift the name of Jesus above all things. Who is like the Lord? No one. Amen.`;
// A sentence of exactly five lines (600px), then "Amen." in its own paragraph (120px): two slides, the last well under 75% of the first.
const FIVE_LINES = `${Array.from({ length: 25 }, () => 'hear us').join(' ')}.`;
const WITH_SHORT_LAST = `${FIVE_LINES}\n\nAmen.`;

function prayerSlides(body) {
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'prayer_authority')) };
  return slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { prayer: { title: 'Prayer', body, split: null, align: 'center' } }).filter((s) => s.kind === 'prayer');
}

/** The block heights of a list of pages, at full size. */
const heightsOf = (pages) => pages.map((p) => prayerBlockHeightPx(p.text, PRAYER_MAX_PX));

test('(a) normal slides of one prayer share one top', () => {
  const pages = prayerSlidesFor(SAMPLE, null).pages;
  assert.equal(pages.length, 4);
  const tops = new Set(pages.map((p) => p.top));
  assert.equal(tops.size, 1, 'every normal slide starts at the same top');
  assert.equal(pages[0].top, blockTopShare(Math.max(...heightsOf(pages))), 'the shared top is where the tallest block is centred');
  assert.ok(pages.every((p) => p.centred === false), 'none of them is short');
});

test('(b) a short slide is centred vertically in the text area', () => {
  const pages = prayerSlidesFor(WITH_SHORT_LAST, null).pages;
  assert.equal(pages.length, 2, 'the five lines and the short last line are two slides');
  const [normal, short] = pages;
  assert.equal(normal.centred, false);
  assert.equal(short.centred, true, 'the short slide is centred');
  const height = prayerBlockHeightPx(short.text, PRAYER_MAX_PX);
  assert.ok(height < SHORT_BLOCK_SHARE * prayerBlockHeightPx(normal.text, PRAYER_MAX_PX), 'it is short');
  assert.ok(Math.abs(short.top - blockTopShare(height)) < 1e-9, 'its top centres its own block');
  assert.ok(Math.abs(short.top + height / STAGE_H / 2 - textAreaShare().centre) < 1e-9, 'its centre is the centre of the text area');
  assert.notEqual(short.top, normal.top, 'and it does not start at the normal top');
});

test('(c) the threshold is applied the same way on every surface', () => {
  // The rule itself: a block counts as short below 75% of the tallest in its group, and a block at exactly 75% is normal.
  assert.equal(SHORT_BLOCK_SHARE, 0.75);
  const heights = [600, 450, 449, 600];
  const tops = blockTops(heights);
  assert.deepEqual(tops.map((t) => t.centred), [false, false, true, false], '450 is at 75% (normal), 449 is short');

  // The lineup and the projector draw the prayer's pages: their flags follow the rule over the prayer's own blocks.
  const lineup = prayerSlides(WITH_SHORT_LAST);
  assert.deepEqual(lineup.map((s) => s.centred), pageTops(lineup.map((s) => s.text)).map((t) => t.centred), 'the lineup follows the rule');

  // The Notes & Prayers preview and full-screen view: the same rule, over the headline and body together.
  const note = { title: 'Prayer to Take Authority', body: WITH_SHORT_LAST, style: null, split: null };
  const notes = screenPagesOf(note);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].centred, false);
  assert.equal(notes[1].centred, true, 'the short page is centred on the full-screen view too');

  // A song's stanzas are one group: the same rule over the group's blocks.
  const hymn = { id: 5, title: 'Hail Mary', stanzas: [{ id: 1, stanzaType: 'Verse 1', lyricsText: Array.from({ length: 5 }, () => 'Hail, full of grace.').join('\n') }, { id: 2, stanzaType: 'Verse 2', lyricsText: 'Amen.' }] };
  const segment = { ...segmentFromTemplate(DEFAULT_TEMPLATE.segments.find((s) => s.key === 'marian_song')), content: { kind: 'song', hymnIds: [5], maxSongs: 1, category: null } };
  const songs = slidesFor({ ...segment, cues: { ...segment.cues, titleFirst: false } }, { hymns: [hymn] }, { band: null }).filter((s) => s.kind === 'lyrics');
  assert.deepEqual(songs.map((s) => s.centred), [false, true], 'a short stanza is centred; the others share the normal top');
  // The projector and the live preview use the same top for the same slide: the top is set once, in the shared rule.
  assert.equal(lyricBottomOf({ kind: 'pw', slide: songs[1] }), songs[1].top + prayerBlockHeightPx(songs[1].text, 96) / STAGE_H, 'the band follows the same top');
});

test('(c, surfaces) every surface reads the top from the same rule, not its own', () => {
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.match(face, /top: `\$\{\(slide\.top \?\? textAreaShare\(\)\.top\) \* 100\}%`/, 'the lineup, the live preview and the projector start the text at the slide\'s top');
  assert.match(read('src/output/ProjectorView.tsx'), /top: `\$\{\(frame\.top \?\? textAreaShare\(\)\.top\) \* 100\}%`/, 'the projector starts a Notes page at its top');
  assert.match(read('src/notes/present.ts'), /top: page\.top,\s*\n\s*centred: page\.centred/, 'the Notes frame carries the page\'s top');
  assert.match(read('src/notes/NotesPrayersView.tsx'), /top=\{screen\[shown\]\?\.top \?\? null\}/, 'the Notes preview uses the same top');
  assert.match(read('src/announcements/TextSlideModal.tsx'), /top: `\$\{top \* 100\}%`/, 'the preview places its block at that top');
});

test('(d) the text size, the split and the lower third are unchanged', () => {
  for (const page of prayerSlidesFor(SAMPLE, null).pages) assert.equal(page.fontPx, PRAYER_MAX_PX, 'full size');
  assert.equal(prayerSlidesFor(SAMPLE, null).pages.length, 4, 'the split of the sample prayer is the same as before');
  assert.equal(PRAYER_MAX_PX, 96);
  // The lower third still sits below the text: a short slide's bottom is its own top plus its own block.
  const short = prayerSlidesFor(WITH_SHORT_LAST, null).pages[1];
  const bottom = lyricBottomOf({ kind: 'pw', slide: { kind: 'prayer', text: short.text, fontPx: 96, top: short.top, label: 'x' } });
  assert.ok(Math.abs(bottom - (short.top + prayerBlockHeightPx(short.text, 96) / STAGE_H)) < 1e-9);
});
