// The Go Live Output Preview Editor and Slide Inspector edit every kind of cue, not only songs: a Praise & Worship card's prayer and reading
// (scripture) pages and its title slide, as well as its songs, and on the Holy Mass console every item with words. Edits go to this service's
// own copies and reach the projector only when the slide edited is the one on screen. The editor's stage shows one set of words while it is
// typed on, and the dialog's columns never run off the right edge. Synthetic strings only: no real song titles, lyrics or liturgical texts.
// Run with: node --test shared/go-live-edit-every-cue.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cardAddSave, cardEditSave, cardSlidePlan, itemPages, liveStepAfterDelete } from './pw-hot-edit.js';
import { slideOriginsFor } from './pw.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const DIR = 'src/golive/console';

// ── A synthetic lineup card ──────────────────────────────────────────────

const slide = (s) => ({ kind: 'slide', slide: s });
const BLACK = { kind: 'black' };
const title = (label) => slide({ kind: 'title', label, subtitle: '' });
const page = (label, text) => slide({ kind: 'prayer', label, text });
const lyric = (text) => slide({ kind: 'lyrics', label: 'V1', text, hymnId: 7, sectionId: '70', position: 0 });

/** A card: a title slide, two pages of its prayer (the card's first item), a song's page, then a chained reading of two pages. */
function prayerCard() {
  const segment = { key: 'seg-a', name: 'Sample Segment', content: { kind: 'prayer', noteId: 1, hymnIds: [7], more: [{ kind: 'lectionary' }] }, cues: { titleFirst: true } };
  const steps = [
    title('Sample Segment'),
    page('Sample Segment', 'Sample Prayer Line One'),
    page('Sample Segment', 'Sample Prayer Line Two'),
    lyric('Sample Song Line'),
    page('Sample Citation', 'Sample Scripture Verse One'),
    page('Sample Citation', 'Sample Scripture Verse Two'),
    BLACK,
  ];
  const origins = [
    { item: 'head', source: 'prayer', title: true, page: null },
    { item: 'head', source: 'prayer', title: false, page: 0 },
    { item: 'head', source: 'prayer', title: false, page: 1 },
    { item: 'songs', source: 'song', title: false, page: null },
    { item: 0, source: 'reading', title: false, page: 0 },
    { item: 0, source: 'reading', title: false, page: 1 },
  ];
  return { segment, steps, origins };
}

test('a prayer page opens with its words and saves the whole prayer to the card’s copy, on screen only when it is the slide on air', () => {
  const { segment, steps, origins } = prayerCard();
  const plan = cardSlidePlan(steps, origins, 2, segment);
  assert.deepEqual(plan.edit, { kind: 'page', target: { kind: 'head' }, pages: ['Sample Prayer Line One', 'Sample Prayer Line Two'], page: 1 });

  const onAir = cardEditSave(plan, 'Sample Prayer Line Edited', { onScreen: true });
  assert.deepEqual(onAir, { target: { kind: 'head' }, pages: ['Sample Prayer Line One', 'Sample Prayer Line Edited'], showPage: 1 }, 'the slide on air keeps its place with its new words');
  const offScreen = cardEditSave(plan, 'Sample Prayer Line Edited', { onScreen: false });
  assert.equal(offScreen.showPage, null, 'a slide edited off screen never moves the projector');

  assert.deepEqual(cardAddSave(plan, 'Sample Prayer Line Added'), {
    target: { kind: 'head' },
    pages: ['Sample Prayer Line One', 'Sample Prayer Line Two', 'Sample Prayer Line Added'],
    showPage: null,
  }, 'Add After puts the new page straight after this one, off screen');
});

test('a reading (scripture) page is edited in its own chained item, not the card’s prayer', () => {
  const { segment, steps, origins } = prayerCard();
  const plan = cardSlidePlan(steps, origins, 4, segment);
  assert.deepEqual(plan.edit, { kind: 'page', target: { kind: 'chain', index: 0 }, pages: ['Sample Scripture Verse One', 'Sample Scripture Verse Two'], page: 0 });
  assert.deepEqual(cardEditSave(plan, 'Sample Scripture Verse Edited', { onScreen: false }).pages, ['Sample Scripture Verse Edited', 'Sample Scripture Verse Two']);
  assert.deepEqual(cardAddSave(plan, 'Sample Scripture Verse Added').pages, ['Sample Scripture Verse One', 'Sample Scripture Verse Added', 'Sample Scripture Verse Two']);
});

test('a title slide renames the card; a prayer slot with no prayer yet starts the card’s own words', () => {
  const { segment, steps, origins } = prayerCard();
  const plan = cardSlidePlan(steps, origins, 0, segment);
  assert.deepEqual(plan.edit, { kind: 'title', text: 'Sample Segment' });
  assert.deepEqual(cardEditSave(plan, 'Sample Segment Renamed', { onScreen: true }), { rename: 'Sample Segment Renamed' });
  assert.deepEqual(plan.add, { target: { kind: 'head' }, pages: ['Sample Prayer Line One', 'Sample Prayer Line Two'], at: 0 }, 'a page added on the title goes first in the words after it');

  const empty = { key: 'seg-b', name: 'Sample Segment', content: { kind: 'prayer', noteId: null, hymnIds: [] }, cues: { titleFirst: false } };
  const placeholder = [slide({ kind: 'prayer', label: 'Sample Segment', text: 'placeholder', placeholder: true }), BLACK];
  const slot = cardSlidePlan(placeholder, [{ item: 'head', source: 'prayer', title: false, page: 0 }], 0, empty);
  assert.deepEqual(slot.edit, { kind: 'page', target: { kind: 'head' }, pages: [''], page: 0 }, 'the placeholder is never saved as words');
  assert.deepEqual(cardEditSave(slot, 'Sample Prayer Line', { onScreen: true }).pages, ['Sample Prayer Line']);
});

test('a song’s slide is left to the song’s own target; a picture and the black step have no words', () => {
  const { segment, steps, origins } = prayerCard();
  assert.equal(cardSlidePlan(steps, origins, 3, segment), null, 'songs: pwSongTarget');
  assert.equal(cardSlidePlan(steps, origins, 6, segment), null, 'the black step');
  const pictures = [slide({ kind: 'picture', label: 'Sample Picture', src: 'x' }), BLACK];
  const plan = cardSlidePlan(pictures, [{ item: 0, source: 'pictures', title: false, page: null }], 0, segment);
  assert.equal(plan.edit, null);
  assert.equal(cardEditSave(plan, 'Sample Prayer Line', { onScreen: true }), null);
});

test('the item’s pages are its text slides only, in order, as the lineup shows them', () => {
  const { steps, origins } = prayerCard();
  assert.deepEqual(itemPages(steps, origins, 'head'), ['Sample Prayer Line One', 'Sample Prayer Line Two']);
  assert.deepEqual(itemPages(steps, origins, 0), ['Sample Scripture Verse One', 'Sample Scripture Verse Two']);
  assert.deepEqual(itemPages(steps, origins, 'songs'), []);
});

test('the plan agrees with the origins the lineup itself builds for a reading card', () => {
  const segment = { key: 'seg-c', name: 'Sample Segment', content: { kind: 'lectionary' }, cues: { titleFirst: true } };
  const origins = slideOriginsFor(segment, { reading: { citation: 'Sample Citation', rawText: 'Sample Scripture Verse' } });
  assert.deepEqual(origins.map((o) => [o.item, o.source, o.title, o.page]), [
    ['head', 'reading', true, null],
    ['head', 'reading', false, 0],
  ]);
  const steps = [title('Sample Segment'), page('Sample Citation', 'Sample Scripture Verse'), BLACK];
  const plan = cardSlidePlan(steps, origins, 1, segment);
  assert.deepEqual(cardEditSave(plan, 'Sample Scripture Verse Edited', { onScreen: true }), { target: { kind: 'head' }, pages: ['Sample Scripture Verse Edited'], showPage: 0 });
});

test('a delete off screen never moves the projector; deleting the slide on air shows the one that took its place', () => {
  assert.equal(liveStepAfterDelete({ shown: 1, start: 4, removed: 1, slides: 5 }), null, 'a slide before the deleted one stays up');
  assert.equal(liveStepAfterDelete({ shown: 5, start: 2, removed: 1, slides: 5 }), 4, 'a slide after it keeps its place, one step earlier');
  assert.equal(liveStepAfterDelete({ shown: 6, start: 2, removed: 3, slides: 3 }), 3, 'a whole chained item taken out before it');
  assert.equal(liveStepAfterDelete({ shown: 2, start: 2, removed: 1, slides: 5 }), 2, 'the deleted slide on air: the next one');
  assert.equal(liveStepAfterDelete({ shown: 5, start: 5, removed: 1, slides: 5 }), 4, 'the last went: the one before');
});

// ── Both consoles wire every cue kind ────────────────────────────────────

test('P&W: the editor modal and the inspector build a target for every slide with words, songs and the rest alike', () => {
  const view = read('src/praise-worship/LiveView.tsx');
  assert.match(view, /target: hymn\s+\? pwSongTarget\(\{ t, segmentIndex: seg, steps: segSteps, onAir: i, hymn \}\)\s+: pwCardTarget\(\{ t, segmentIndex: seg, steps: segSteps, step: i, onAir: seg === segmentIndex \? at\.slide : null \}\)/);
  assert.match(view, /const editTarget = lyricHymn\s+\? pwSongTarget\([^)]*\)\s+: pwCardTarget\(\{ t, segmentIndex, steps, step: at\.slide, onAir: at\.slide \}\);/);
  assert.doesNotMatch(view, /target: hymn \? pwSongTarget\([^)]*\) : null/, 'no song-only guard is left');

  const targets = read(`${DIR}/editTargets.ts`);
  const card = targets.slice(targets.indexOf('export function pwCardTarget'), targets.indexOf('export function massPagesTarget'));
  assert.match(card, /cardSlidePlan\(steps, origins, step, segment\)/);
  assert.match(card, /cardEditSave\(plan, next, \{ onScreen: step === onAir \}\)/, 'the screen follows only the slide on air');
  assert.match(card, /renameCard\(segmentIndex, change\.rename\)/);
  assert.match(card, /await saveCardText\(\{ segmentIndex, target, pages, showPage, keep \}\)/, 'the card’s own copy, through saveCopy');
  assert.match(card, /deleteCardStep\(segmentIndex, steps, step\)/);
  assert.doesNotMatch(card, /bridge\.(notes|lyrics|lectionary)\.(save|edit|delete|update)\b/, 'never the Hub, the Lectionary or Song Lyrics');
  // The card's own copy is written through notes:saveCopy only.
  const copy = read('src/praise-worship/lineupSlideCopy.ts');
  assert.match(copy, /await bridge\.notes\.saveCopy\(/);
  assert.doesNotMatch(copy, /bridge\.notes\.save\(/);
});

test('Holy Mass: every item with words has a target (songs’ stanzas, and prayers, readings, decks and psalms in the plan’s copy)', () => {
  const view = read('src/golive/MassLiveView.tsx');
  assert.match(view, /songTarget\(\{ hymn: hymn!, stanza: i - 1/);
  assert.match(view, /massPagesTarget\(\{ t: tp, item, index: v\.row, frame, note, page: i \}\)/);
  assert.match(view, /massPagesTarget\(\{ t: tp, item, index: cursor, frame, note \}\)/, 'the inspector too');
  const pages = read('src/golive/massSlideCopy.ts');
  const of = pages.slice(pages.indexOf('export function slidePagesOf'), pages.indexOf('export function slideIndexOf'));
  for (const kind of ["case 'text'", "case 'deck'", "case 'psalm'"]) assert.ok(of.includes(kind), `${kind}: prayers, readings and scripture decks, psalms`);
});

// ── One set of words on the stage ────────────────────────────────────────

test('typing on the preview hides the slide’s own words and lays one text box exactly on them, with no shade or second copy', () => {
  const css = read('src/styles.css');
  assert.match(css, /\[data-stage-editing\] \[data-slide-words\] \{\s*visibility: hidden;\s*\}/, 'the slide’s words keep their place for the fit but are not painted');

  const modal = read(`${DIR}/SlideEditorModal.tsx`);
  assert.match(modal, /const typing = editable && inline;/);
  assert.match(modal, /<div ref=\{stageRef\} className="absolute inset-0" data-stage-editing=\{typing \? '' : undefined\}>/);
  assert.match(modal, /\{typing && !lowerThird && \(\s*<StageWordsEditor/);
  assert.match(modal, /\{editable && !inline && \(\s*<button/, 'the click target goes once the box is up');
  // The band's line is replaced by the box, never drawn under it.
  assert.match(modal, /\{typing \? \(\s*<BandWordsEditor[\s\S]*?\) : \(\s*<div className="line-clamp-2/);
  // No shade over the stage and no copy of the words in the box's own type: it takes the slide's measured type.
  assert.doesNotMatch(modal, /bg-black\/70/);
  assert.doesNotMatch(modal, /InlineEditor/);
  assert.match(modal, /querySelectorAll<HTMLElement>\('\[data-slide-words\]'\)/);
  assert.match(modal, /const type = getComputedStyle\(line\);/);
  assert.match(modal, /lineHeight: `\$\{pitch\}px`/);
  assert.match(modal, /mutations\.observe\(stage, /, 'the box follows the slide as it refits');

  // Every renderer marks its words, so the box finds them on any kind of slide.
  const projector = read('src/output/ProjectorView.tsx');
  assert.equal(projector.split('data-slide-words').length - 1, 6, 'lyrics, text lines, headed body, deck lines, psalm response, rosary prayer');
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.equal(face.split('data-slide-words').length - 1, 3, 'title, prayer or lyric page, edge-to-edge page');
});

// ── Layout and no-drag ───────────────────────────────────────────────────

test('the dialog’s columns shrink instead of running off the right edge, and every box in it is no-drag', () => {
  const modal = read(`${DIR}/SlideEditorModal.tsx`);
  assert.match(modal, /data-editor-body className="grid min-h-0 w-full min-w-0 grid-cols-1 [^"]*lg:grid-cols-\[minmax\(0,7fr\)_minmax\(0,5fr\)\]"/);
  assert.match(modal, /<div className="flex w-full min-w-0 flex-col gap-3">/, 'the preview column');
  assert.match(modal, /data-editor-inspector className="flex w-full min-w-0 flex-col gap-3"/, 'the inspector column');
  assert.match(modal, /max-w-\[1120px\] min-w-0/);
  // Rows of nowrap buttons wrap; the backdrop buttons shrink and cut their names short.
  assert.match(modal, /aria-label=\{t\('consoleEdHelpers'\)\} className="flex flex-wrap gap-1"/);
  assert.match(modal, /aria-label=\{t\('consoleEdCase'\)\} className="flex flex-wrap/);
  assert.match(modal, /aria-label=\{t\('consoleEdAlign'\)\} className="flex flex-wrap/);
  assert.match(modal, /\$\{SM\} w-full min-w-0 !shrink justify-start`\}>\s*<span aria-hidden[^>]*\/>\s*<span className="min-w-0 truncate">/);
  // No-drag on the shell and every text box on the stage.
  assert.match(modal, /aria-modal="true"[\s\S]{0,200}style=\{NO_DRAG\}/);
  const boxes = modal.split('<textarea').slice(1).map((b) => b.slice(0, b.indexOf('/>')));
  assert.equal(boxes.length, 3, 'Slide Lines, the stage box and the band box');
  for (const b of boxes.filter((x) => x.includes('data-stage-words-editor'))) assert.match(b, /style=\{\{ \.\.\.NO_DRAG/);
});
