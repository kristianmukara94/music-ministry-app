// A song's default slide arrangement (shared/song-slides.js): an operator's slides saved on the song, replayed exactly by every later use of
// it (a Praise & Worship card, a Holy Mass song, Quick-Live), and dropped once the song's words are rewritten. Synthetic words only.
// Run with: node --test shared/song-slides.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasCurrentSongSlides,
  lyricsHash,
  resolveSongSlides,
  sanitizeSongSlides,
  songSlideIds,
  songSlidesFor,
  songSlidesOf,
  withSlideDetails,
} from './song-slides.js';
import { sectionOrder, segmentFromTemplate, slidesFor } from './pw.js';
import { lyricsStanzaFrame } from './stage-plan-row.js';
import { goLiveNowActions } from './lyrics-live.js';
import { frameOwnLook } from './slide-look.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** The song as Song Lyrics stores it. */
const master = () => ({
  id: 7,
  title: 'Sample Song Title',
  fontScale: 1,
  style: null,
  stanzas: [
    { id: 11, stanzaType: 'Verse 1', lyricsText: 'Sample Lyric Line One\nSample Lyric Line Two\nSample Lyric Line Three\nSample Lyric Line Four', order: 1 },
    { id: 12, stanzaType: 'Chorus', lyricsText: 'Sample Chorus Line\nSample Chorus Line Again', order: 2 },
    { id: 13, stanzaType: 'Verse 2', lyricsText: 'Sample Lyric Line Five', order: 3 },
  ],
});

/** A Praise & Worship song card that sings `hymnId`, with no title slide. */
const card = (hymnId, arrangement = {}) => {
  const segment = segmentFromTemplate({ key: 'sample-card', group: 'praise', name: 'Sample Card', type: 'song', minutes: 5, content: { kind: 'song', hymnIds: [hymnId], maxSongs: 1, category: null } });
  return { ...segment, arrangement, cues: { ...segment.cues, titleFirst: false } };
};
const lyricSlides = (segment, hymn, options) => slidesFor(segment, { hymns: [hymn] }, options).filter((s) => s.kind === 'lyrics');

/**
 * What an operator leaves on air: Verse 1 merged from two slides into one slide of two long lines, a new slide added after the Chorus, Verse 2
 * deleted, and the Chorus formatted on its own. Built the way the consoles build it (songSlidesOf over the song as Go Live holds it).
 */
function arranged() {
  const song = master();
  const edited = {
    ...song,
    stanzas: [
      { ...song.stanzas[0], lyricsText: 'Sample Lyric Line One Sample Lyric Line Two\nSample Lyric Line Three Sample Lyric Line Four', pages: ['Sample Lyric Line One Sample Lyric Line Two\nSample Lyric Line Three Sample Lyric Line Four'] },
      { ...song.stanzas[1], look: { textCase: 'uppercase', align: 'left', fontScale: 1.5 }, notes: 'Hold for the band' },
      { id: -1, stanzaType: 'Bridge', lyricsText: 'Sample Bridge Line', pages: ['Sample Bridge Line'] },
    ],
  };
  return { song, slides: songSlidesOf(edited) };
}

test('the words hash ignores line endings and trailing spaces, and changes with any word, part or order', () => {
  const song = master();
  const same = song.stanzas.map((s) => ({ ...s, lyricsText: `${s.lyricsText.replace(/\n/g, '  \r\n')}\n\n` }));
  assert.equal(lyricsHash(same), lyricsHash(song.stanzas));
  assert.match(lyricsHash(song.stanzas), /^v1-[0-9a-f]{16}$/);
  const word = song.stanzas.map((s, i) => (i === 1 ? { ...s, lyricsText: 'Sample Chorus Line\nSample Chorus Line Changed' } : s));
  const part = song.stanzas.map((s, i) => (i === 2 ? { ...s, stanzaType: 'Verse 3' } : s));
  const order = [song.stanzas[1], song.stanzas[0], song.stanzas[2]];
  for (const other of [word, part, order]) assert.notEqual(lyricsHash(other), lyricsHash(song.stanzas));
});

test('merging lines into one slide and saving gives the arrangement the song record stores', () => {
  const { song, slides } = arranged();
  const saved = songSlidesFor(song.stanzas, slides);
  assert.equal(saved.version, 1);
  assert.equal(saved.lyricsHash, lyricsHash(song.stanzas));
  assert.deepEqual(saved.slides, [
    { label: 'Verse 1', sectionTag: 'V1', lines: ['Sample Lyric Line One Sample Lyric Line Two', 'Sample Lyric Line Three Sample Lyric Line Four'] },
    { label: 'Chorus', sectionTag: 'C', lines: ['Sample Chorus Line', 'Sample Chorus Line Again'], notes: 'Hold for the band', style: { textCase: 'uppercase', align: 'left', fontScale: 1.5 } },
    { label: 'Bridge', sectionTag: 'B', lines: ['Sample Bridge Line'] },
  ]);
  // Stored as JSON text and read back, it is the same arrangement.
  assert.deepEqual(sanitizeSongSlides(JSON.stringify(saved)), saved);
  assert.ok(hasCurrentSongSlides({ ...song, defaultSlides: saved }));
});

test('an arrangement is checked on the way in and out: no words, no hash or a bad look leave nothing unsafe', () => {
  assert.equal(sanitizeSongSlides(null), null);
  assert.equal(sanitizeSongSlides('{not json'), null);
  assert.equal(sanitizeSongSlides({ slides: [{ label: 'Verse 1', lines: ['Sample Lyric Line One'] }] }), null, 'no hash');
  const hash = lyricsHash(master().stanzas);
  assert.equal(sanitizeSongSlides({ lyricsHash: hash, slides: [{ label: 'Verse 1', lines: ['', '  '] }] }), null, 'no words');
  const clean = sanitizeSongSlides({ lyricsHash: hash, slides: [{ label: 'Chorus', lines: ['', 'Sample Chorus Line', ''], style: { align: 'sideways', textCase: 'uppercase' }, extra: 'x' }] });
  assert.deepEqual(clean.slides, [{ label: 'Chorus', sectionTag: 'C', lines: ['Sample Chorus Line'], style: { textCase: 'uppercase' } }]);
});

test('a new Praise & Worship card plays exactly the saved slides: boundaries, line breaks, tags and looks, at any text size', () => {
  const { song, slides } = arranged();
  const resolved = resolveSongSlides({ ...song, defaultSlides: songSlidesFor(song.stanzas, slides) });
  assert.equal(resolved.slideLayout, 'default');
  for (const scale of [1, 2.5]) {
    const shown = lyricSlides(card(song.id), resolved, { scale });
    assert.deepEqual(
      shown.map((s) => [s.label, s.chip, s.text, s.look ?? null]),
      [
        ['Verse 1', 'V1', 'Sample Lyric Line One Sample Lyric Line Two\nSample Lyric Line Three Sample Lyric Line Four', null],
        ['Chorus', 'C', 'Sample Chorus Line\nSample Chorus Line Again', { textCase: 'uppercase', align: 'left', fontScale: 1.5 }],
        ['Bridge', 'B', 'Sample Bridge Line', null],
      ],
      `scale ${scale}`,
    );
    assert.ok(shown.every((s) => s.parts === 1), 'no slide is paged again');
  }
  // The P&W step's look reaches the projector, the monitors and the editor.
  assert.deepEqual(frameOwnLook({ kind: 'pw', slide: lyricSlides(card(song.id), resolved)[1] }), { textCase: 'uppercase', align: 'left', fontScale: 1.5 });
});

test('a long slide the operator combined stays one slide, where automatic paging would split it', () => {
  const long = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((n) => `Sample Lyric Line ${n} Sample Lyric Line ${n} Again`);
  const song = { ...master(), stanzas: [{ id: 21, stanzaType: 'Verse 1', lyricsText: long.join('\n'), order: 1 }] };
  for (const scale of [1, 2.5]) assert.ok(lyricSlides(card(song.id), song, { scale }).length > 1, `automatic paging splits it at ${scale}`);
  const resolved = resolveSongSlides({ ...song, defaultSlides: songSlidesFor(song.stanzas, [{ label: 'Verse 1', lines: long }]) });
  for (const scale of [1, 2.5]) assert.deepEqual(lyricSlides(card(song.id), resolved, { scale }).map((s) => s.text), [long.join('\n')], `kept whole at ${scale}`);
});

test('a new Holy Mass plan plays the saved slides as its stanzas, with their looks', () => {
  const { song, slides } = arranged();
  const resolved = resolveSongSlides({ ...song, defaultSlides: songSlidesFor(song.stanzas, slides) });
  const frames = resolved.stanzas.map((_, i) => lyricsStanzaFrame(resolved, i));
  assert.deepEqual(
    frames.map((f) => [f.label, f.text, f.song.count, frameOwnLook(f)]),
    [
      ['Verse 1', 'Sample Lyric Line One Sample Lyric Line Two\nSample Lyric Line Three Sample Lyric Line Four', 3, null],
      ['Chorus', 'Sample Chorus Line\nSample Chorus Line Again', 3, { textCase: 'uppercase', align: 'left', fontScale: 1.5 }],
      ['Bridge', 'Sample Bridge Line', 3, null],
    ],
  );
  assert.equal(resolved.stanzas[1].notes, 'Hold for the band', 'the booth notes come back for the editor');
});

test('Quick-Live opens the song on its first saved slide', () => {
  const { song, slides } = arranged();
  const resolved = resolveSongSlides({ ...song, defaultSlides: songSlidesFor(song.stanzas, slides) });
  const frames = goLiveNowActions({ hymn: resolved, band: null })
    .map((a) => a.frame)
    .filter((f) => f?.kind === 'lyrics');
  assert.equal(frames[0].text, 'Sample Lyric Line One Sample Lyric Line Two\nSample Lyric Line Three Sample Lyric Line Four');
  assert.equal(frames[0].song.count, 3);
});

test('a song with no arrangement, or whose words were rewritten in Song Lyrics, is paged automatically as before', () => {
  const { song, slides } = arranged();
  const saved = songSlidesFor(song.stanzas, slides);
  const auto = lyricSlides(card(song.id), song);
  // No arrangement: the stored stanzas, paged as usual.
  const plain = resolveSongSlides(song);
  assert.equal(plain.slideLayout, 'auto');
  assert.deepEqual(plain.stanzas, song.stanzas);
  assert.deepEqual(lyricSlides(card(song.id), plain), auto);
  // Rewritten words: the arrangement no longer fits and is ignored.
  const rewritten = { ...song, stanzas: song.stanzas.map((s, i) => (i === 2 ? { ...s, lyricsText: 'Sample Lyric Line Rewritten' } : s)), defaultSlides: saved };
  assert.equal(hasCurrentSongSlides(rewritten), false);
  const back = resolveSongSlides(rewritten);
  assert.equal(back.slideLayout, 'auto');
  assert.deepEqual(back.stanzas, rewritten.stanzas);
  assert.equal(lyricSlides(card(song.id), back).at(-1).text, 'Sample Lyric Line Rewritten');
});

test('Reset Default Layout (no arrangement) brings back the automatic slides exactly', () => {
  const { song, slides } = arranged();
  const before = lyricSlides(card(song.id), song);
  const withDefault = resolveSongSlides({ ...song, defaultSlides: songSlidesFor(song.stanzas, slides) });
  assert.notDeepEqual(lyricSlides(card(song.id), withDefault), before);
  const reset = resolveSongSlides({ ...song, defaultSlides: null });
  assert.deepEqual(lyricSlides(card(song.id), reset), before);
});

test('resolved slides get ids of their own: the same after a restart, new for another arrangement, never a stored stanza id', () => {
  const { song, slides } = arranged();
  const saved = songSlidesFor(song.stanzas, slides);
  const ids = songSlideIds(saved);
  assert.deepEqual(songSlideIds(sanitizeSongSlides(JSON.stringify(saved))), ids, 'stable');
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => Number.isSafeInteger(id) && id < -999_999));
  const other = songSlideIds(songSlidesFor(song.stanzas, slides.slice(0, 2)));
  assert.ok(other.every((id) => !ids.includes(id)), 'another arrangement shares no id');
  // A card order made for the song's own stanzas matches none of them, so the card sings the arrangement as saved.
  const resolved = resolveSongSlides({ ...song, defaultSlides: saved });
  assert.deepEqual(sectionOrder(resolved, { [String(song.id)]: ['13', '11'] }), ids.map(String));
});

test('a card sung in its own order saves that order, a repeat included, with each stanza paged as the card shows it', () => {
  const song = master();
  const order = sectionOrder(song, { [String(song.id)]: ['12', '11', '12'] });
  const slides = songSlidesOf(song, { order, pagesOf: (s) => (s.id === 11 ? ['Sample Lyric Line One\nSample Lyric Line Two', 'Sample Lyric Line Three\nSample Lyric Line Four'] : null) });
  assert.deepEqual(
    slides.map((s) => [s.label, s.lines.join(' / ')]),
    [
      ['Chorus', 'Sample Chorus Line / Sample Chorus Line Again'],
      ['Verse 1', 'Sample Lyric Line One / Sample Lyric Line Two'],
      ['Verse 1', 'Sample Lyric Line Three / Sample Lyric Line Four'],
      ['Chorus', 'Sample Chorus Line / Sample Chorus Line Again'],
    ],
  );
  const resolved = resolveSongSlides({ ...song, defaultSlides: songSlidesFor(song.stanzas, slides) });
  assert.deepEqual(lyricSlides(card(song.id), resolved).map((s) => s.text), slides.map((s) => s.lines.join('\n')));
});

test("a slide's look and notes can be set alone, and cleared", () => {
  const { slides } = arranged();
  const looked = withSlideDetails(slides, 0, { look: { align: 'right' }, notes: 'Sample note' });
  assert.deepEqual(looked[0].style, { align: 'right' });
  assert.equal(looked[0].notes, 'Sample note');
  assert.equal(looked[1], slides[1], 'other slides are untouched');
  const cleared = withSlideDetails(looked, 0, { look: null, notes: '' });
  assert.equal('style' in cleared[0], false);
  assert.equal('notes' in cleared[0], false);
});

test('every console reads songs through the resolver, and every song edit saves the song default', () => {
  const live = source('../src/live/liveSongEdits.ts');
  assert.match(live, /const resolved = resolveSongSlides\(stored\) as Hymn;/, 'liveLyrics.getHymn lays the song out by its arrangement');
  assert.match(live, /await bridge\.lyrics\.saveDefaultSlides\(hymnId, slides\)/);
  assert.match(live, /await bridge\.lyrics\.saveDefaultSlides\(hymnId, null\)/, 'Reset Default Layout');
  // The song's words in Song Lyrics are never written from Go Live.
  assert.doesNotMatch(live, /lyrics\.(editLyrics|editHymn|splitStanza|createHymn)\(/);
  const targets = source('../src/golive/console/editTargets.ts');
  assert.match(targets, /layout: pwSongLayout\(segmentIndex, steps, onAir, hymn\.id\)/, 'Praise & Worship');
  assert.match(targets, /if \(layout\) await saveLayout\(next, layout, details\);/, 'Save / Apply / Live Sync');
  assert.match(targets, /if \(layout\) await saveLayout\(await fresh\(next\), layout\);/, 'Add After / Duplicate');
  assert.match(targets, /await saveLayout\(await fresh\(hymn\), layout\);/, 'Delete');
  const mass = source('../src/golive/MassLiveView.tsx');
  assert.equal((mass.match(/layout: massSongLayout\(/g) ?? []).length, 2, 'Holy Mass: the editor modal and the inspector');
  // Planner staging, Quick-Live and the P&W store read songs as Go Live does.
  assert.match(source('../src/planner/MassPlanner.tsx'), /songRowActions\(row, index, await liveLyrics\.getHymn\(/);
  assert.match(source('../src/praise-worship/useQuickLiveController.ts'), /liveLyrics\.getHymn\(hymnId\)/);
  assert.match(source('../src/praise-worship/store.ts'), /ids\.map\(\(id\) => liveLyrics\.getHymn\(id\)\)/);
  assert.match(source('../src/planner/routing.ts'), /await liveLyrics\.getHymn\(Number\(item\.sourceId\)\)/);
});
