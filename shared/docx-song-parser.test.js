// Tests the Word (.docx) worship lineup importer: songs split from one document, sections and flow cues read, slides cut for the projector.
// Run with: node --test shared/docx-song-parser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseLyrics } from './lyrics-parser.js';
import {
  applyCase,
  chunkSlides,
  classifyLine,
  detectLanguage,
  isMostlyUpperCase,
  normalizeSpacing,
  paragraphsFromDocumentXml,
  parseDocxSongs,
  parseFlowDirective,
  parseLineup,
  parseSongBody,
  parseTextSongs,
  paragraphsFromText,
  songSlides,
  songToTaggedLyrics,
  storedStanzaType,
  docxSongIssues,
} from './docx-song-parser.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A paragraph of document.xml. A title is bold and underlined, as the parish lineups set them. */
function para(text, { bold = false, underline = false } = {}) {
  if (!text) return '<w:p/>';
  const rPr = bold || underline ? `<w:rPr>${bold ? '<w:b/>' : ''}${underline ? '<w:u w:val="single"/>' : ''}</w:rPr>` : '';
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}
const title = (text) => para(text, { bold: true, underline: true });
const docXml = (paras) =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}</w:body></w:document>`;

async function docx(paras) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', docXml(paras));
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Paragraph objects as document.xml would give them, for the tests that do not need a whole file. */
const paras = (lines) => lines.map((l) => (typeof l === 'string' ? { text: l, bold: false, underline: false, heading: false } : { underline: false, heading: false, ...l }));
const labels = (song) => song.sections.map((s) => s.label);

// ---------------------------------------------------------------------------------------------------------------------------------------------

test('word/document.xml is read as paragraphs: entities, tabs and breaks kept, bold and headings marked, deleted text left out', () => {
  const xml = docXml([
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>OUR FATHER</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>I CAN RUN THROUGH &amp; THROUGH</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>CHORUS:</w:t></w:r><w:r><w:tab/></w:r></w:p>',
    '<w:p><w:r><w:t>LINE ONE</w:t><w:br/><w:t>LINE TWO</w:t></w:r><w:del><w:r><w:delText>GONE</w:delText></w:r></w:del></w:p>',
    '<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>NOT BOLD</w:t></w:r></w:p>',
    '<w:p/>',
  ]);
  const out = paragraphsFromDocumentXml(xml);
  assert.equal(out.length, 6);
  assert.equal(out[0].heading, true);
  assert.equal(out[1].text, 'I CAN RUN THROUGH & THROUGH');
  assert.equal(out[1].bold, true);
  assert.equal(normalizeSpacing(out[2].text), 'CHORUS:');
  assert.equal(out[3].text, 'LINE ONE\nLINE TWO');
  assert.equal(out[4].bold, false);
  assert.equal(out[5].text, '');
});

test('runs of three or more spaces become line breaks; single spaces and non-breaking spaces are tidied', () => {
  assert.equal(normalizeSpacing('LIFT HIM HIGH ALL YE HEAVEN          LIFT HIM HIGH ALL YE EARTH   '), 'LIFT HIM HIGH ALL YE HEAVEN\nLIFT HIM HIGH ALL YE EARTH');
  assert.equal(normalizeSpacing('ONE WORD  TWO'), 'ONE WORD TWO');
  assert.equal(normalizeSpacing('   \t  '), '');
});

test('a document typed in capitals is detected, and sentence case keeps "I", God’s names and full stops', () => {
  assert.equal(isMostlyUpperCase(['YOUR LOVE IS BEAUTIFUL', 'IT’S THE REASON WHY I SING.']), true);
  assert.equal(isMostlyUpperCase(['Amazing grace, how sweet the sound']), false);
  assert.equal(applyCase('I WILL LIFT MY HANDS. PRAISE THE LORD JESUS', 'sentence'), 'I will lift my hands. Praise the Lord Jesus');
  assert.equal(applyCase('HOLY IS THE LORD (6x)', 'sentence'), 'Holy is the Lord (6x)');
  assert.equal(applyCase('I’M COMING BACK', 'sentence'), 'I’m coming back');
  // A line that already has small letters is left as typed, and so is everything in "preserve".
  assert.equal(applyCase('Already typed Nicely', 'sentence'), 'Already typed Nicely');
  assert.equal(applyCase('KEEP ME', 'preserve'), 'KEEP ME');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------

test('one .docx buffer with several songs is split at its bold titles, and lyric lines in capitals are not taken for titles', async () => {
  const buffer = await docx([
    title('OUR FATHER'),
    para('I.HEAR OUR PRAY’R, WE ARE YOUR CHILDREN AND WE’VE GATHERED HERE TODAY.'),
    para('CHORUS:'),
    para('OUR FATHER WHO ART IN HEAVEN HALLOWED BE THY NAME.'),
    para(''),
    title('OPEN THE EYES OF MY HEART LORD'),
    para(''),
    para('OPEN THE EYES OF MY HEART LORD'),
    para('OPEN THE EYES OF MY HEART'),
    para(''),
    para('TO SEE YOU HIGH AND LIFTED UP'),
    para('SHINING IN THE LIGHT OF YOUR GLORY'),
    para(''),
    title('SA MATAG ADLAW'),
    para('SA MATAG ADLAW GUSTO KO NGA KAUBAN KA SA MATAG LAKAW SA TANANG BUHATON KO GUSTO KO NGA KAUBAN KA.'),
  ]);
  const result = await parseDocxSongs(buffer);
  assert.equal(result.titleMode, 'emphasis');
  assert.equal(result.allCaps, true);
  assert.deepEqual(result.songs.map((s) => s.title), ['OUR FATHER', 'OPEN THE EYES OF MY HEART LORD', 'SA MATAG ADLAW']);
  assert.deepEqual(labels(result.songs[1]), ['Verse 1', 'Verse 2']);
});

test('without bold titles, short stand-alone lines followed by a section, a verse number or a long line start new songs', () => {
  const { songs, titleMode } = parseLineup(
    paras([
      'HOSANNA',
      'I.I SEE THE KING OF GLORY COMING ON THE CLOUDS WITH FIRE THE WHOLE EARTH SHAKES.',
      'CHORUS:',
      'HOSANNA, HOSANNA, HOSANNA IN THE HIGHEST (2X)',
      '',
      'STILL',
      'HIDE ME NOW UNDER YOUR WINGS COVER ME WITHIN YOUR MIGHTY HANDS AND KEEP ME.',
      '',
      'MORE LOVE, MORE POWER',
      'MORE LOVE, MORE POWER MORE OF YOU IN MY LIFE. 2x',
    ]),
  );
  assert.equal(titleMode, 'text');
  assert.deepEqual(songs.map((s) => s.title), ['HOSANNA', 'STILL', 'MORE LOVE, MORE POWER']);
});

test('a plain-text (.txt) lineup goes through the same parser: CRLF, a BOM and tabs are handled, and titles come from the lines', () => {
  const text = '﻿HOSANNA\r\nI.I SEE THE KING OF GLORY COMING ON THE CLOUDS WITH FIRE THE WHOLE EARTH SHAKES.\r\nCHORUS:\r\nHOSANNA,\tHOSANNA IN THE HIGHEST (2X)\r\n\r\nSTILL\r\nHIDE ME NOW UNDER YOUR WINGS COVER ME WITHIN YOUR MIGHTY HANDS AND KEEP ME.\r\n';
  const lines = paragraphsFromText(text);
  assert.equal(lines[0].text, 'HOSANNA');
  assert.ok(lines.every((p) => !p.bold && !p.underline && !p.heading));
  const { songs, titleMode } = parseTextSongs(text, { existing: [{ id: 7, title: 'Still' }] });
  assert.equal(titleMode, 'text');
  assert.deepEqual(songs.map((s) => s.title), ['HOSANNA', 'STILL']);
  assert.deepEqual(labels(songs[0]), ['Verse 1', 'Chorus']);
  assert.equal(songs[1].duplicate.existingId, 7);
});

test('a broken or non-Word file is refused with a reason', async () => {
  await assert.rejects(() => parseDocxSongs(Buffer.from('not a zip')), /could not be read as a Word document/);
  const zip = new JSZip();
  zip.file('hello.txt', 'hi');
  await assert.rejects(async () => parseDocxSongs(await zip.generateAsync({ type: 'nodebuffer' })), /not a Word \(\.docx\) document/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------

test('section markers are read: I.TEXT, II. TEXT, V1-, CHORUS:, REFRAIN:, KORO:, BRIDGE:, CODA:, END:', () => {
  assert.deepEqual(classifyLine('I.ALMIGHTY GOD MY REDEEMER'), { kind: 'verse', n: 1, text: 'ALMIGHTY GOD MY REDEEMER' });
  assert.deepEqual(classifyLine('II. KAYA HALINA MGA KRISTIYANO'), { kind: 'verse', n: 2, text: 'KAYA HALINA MGA KRISTIYANO' });
  assert.deepEqual(classifyLine('IV.SEE OUR HEARTS'), { kind: 'verse', n: 4, text: 'SEE OUR HEARTS' });
  assert.deepEqual(classifyLine('V3- I’M CAPTURED BY YOUR HOLY CALLING'), { kind: 'verse', n: 3, text: 'I’M CAPTURED BY YOUR HOLY CALLING' });
  assert.equal(classifyLine('CHORUS:\t').section, 'Chorus');
  assert.equal(classifyLine('`CHORUS:').section, 'Chorus');
  assert.equal(classifyLine('REFRAIN:').section, 'Chorus');
  assert.equal(classifyLine('KORO:').section, 'Chorus');
  assert.deepEqual(classifyLine('CHORUS II:'), { kind: 'marker', section: 'Chorus', n: 2, text: '' });
  assert.equal(classifyLine('BRIDGE:').section, 'Bridge');
  assert.deepEqual(classifyLine('CODA: PURIHIN KA ALLELUYA… (3x)'), { kind: 'marker', section: 'Coda', n: null, text: 'PURIHIN KA ALLELUYA… (3x)' });
  assert.equal(classifyLine('END: I’M FREE').section, 'Ending');
  assert.equal(classifyLine('(REPEAT CHORUS 2x)').kind, 'cue');
  assert.equal(classifyLine('REPEAT CHORUS:').kind, 'cue');
  assert.equal(classifyLine('I WILL LIFT MY HANDS IN WORSHIP').kind, 'lyric');
});

test('a song with roman-numbered verses, a chorus, a coda and a closing line gets those sections in sung order', () => {
  const { sections, arrangement, warnings } = parseSongBody(
    paras([
      'I.HEAR OUR PRAY’R, WE ARE YOUR CHILDREN AND WE’VE GATHERED HERE TODAY, WE’VE GATHERED HERE TO PRAY.',
      'II.HEAR OUR CRY LORD WE NEED YOUR MERCY AND WE NEED YOUR GRACE TODAY, HEAR US AS WE PRAY.',
      'CHORUS:',
      'OUR FATHER WHO ART IN HEAVEN HALLOWED BE THY NAME. OUR FATHER HEAR US FROM HEAVEN FORGIVE OUR SINS WE PRAY.',
      'III.HEAR OUR SONG, AS IT RISES TO HEAVEN MAY YOUR GLORY FILL THE EARTH, AS THE WATERS COVER THE SEA.',
      '(REPEAT CHORUS)',
      'CODA:',
      'THOUGH WE ARE FEW WE’RE SURROUNDED BY MANY WHO HAVE CROSSED THAT RIVER BEFORE',
      'HOLY IS THE LORD – 6X ',
      '(REPEAT 1 & 2 THEN CHORUS 2X)',
      'FORGIVE OUR SINS WE PRAY (2x)',
    ]),
  );
  assert.deepEqual(
    sections.map((s) => s.label),
    ['Verse 1', 'Verse 2', 'Chorus', 'Verse 3', 'Coda', 'Tag'],
  );
  assert.deepEqual(arrangement, ['Verse 1', 'Verse 2', 'Chorus', 'Verse 3', 'Chorus', 'Coda', 'Verse 1', 'Verse 2', 'Chorus', 'Chorus', 'Tag']);
  // The multiplier inside the coda stays on its line; the one on the closing line becomes the tag's repeat.
  assert.deepEqual(sections[4].lines.slice(-1), ['HOLY IS THE LORD (6x)']);
  assert.equal(sections[5].repeat, 2);
  assert.deepEqual(sections[5].lines, ['FORGIVE OUR SINS WE PRAY']);
  assert.deepEqual(warnings, []);
});

test('unlabelled stanzas before a chorus are Verse 1, Verse 2; a repeated identical CHORUS: block is one section sung twice', () => {
  const { sections, arrangement } = parseSongBody(
    paras([
      'WHEN THE MUSIC FADES ALL IS STRIPPED AWAY, AND I SIMPLY COME LONGING JUST TO BRING SOMETHING.',
      'I’LL BRING YOU MORE THAN A SONG, FOR A SONG IN ITSELF IS NOT WHAT YOU HAVE REQUIRED.',
      'CHORUS:',
      'I’M COMING BACK TO THE HEART OF WORSHIP AND IT’S ALL ABOUT YOU, IT’S ALL ABOUT YOU JESUS.',
      'KING OF ENDLESS WORTH NO ONE COULD EXPRESS HOW MUCH YOU DESERVE THOUGH I’M WEAK AND POOR.',
      'CHORUS:',
      // The same chorus with a typo and a repeat mark is still the same chorus.
      ' /:I’M COMING BACK TO THE HEART OF WORSHIP AND IT’S ALL ABOUT YOU, T’S ALL ABOUT YOU JESUS.://',
    ]),
  );
  assert.deepEqual(sections.map((s) => s.label), ['Verse 1', 'Verse 2', 'Chorus', 'Verse 3']);
  assert.deepEqual(arrangement, ['Verse 1', 'Verse 2', 'Chorus', 'Verse 3', 'Chorus']);
  assert.equal(sections[2].repeat, 2);
});

test('V1- verses with a REFRAIN:, BRIDGE: and a numbered second chorus', () => {
  const { sections, arrangement } = parseSongBody(
    paras([
      'V1- BEAUTIFUL LORD WONDERFUL SAVIOR I KNOW FOR SURE ALL OF MY DAYS ARE HELD IN YOUR HAND',
      'V2- YOU GENTLY CALL ME INTO YOUR PRESENCE GUIDING ME BY YOUR HOLY SPIRIT',
      'V3- I’M CAPTURED BY YOUR HOLY CALLING SET ME APART',
      'REFRAIN:',
      'TAKE ME, MOLD ME, USE ME, FILL ME I GIVE MY LIFE TO THE POTTER’S HAND',
      'BRIDGE:',
      'O MY GOD YOU ARE MY STRENGTH AND MY SONG',
      'CHORUS II:',
      'WE’VE COME TO BLESS (4x)',
      '(REPEAT V2 & V3)',
      '(REFRAIN CHORUS)',
    ]),
  );
  assert.deepEqual(sections.map((s) => s.label), ['Verse 1', 'Verse 2', 'Verse 3', 'Chorus', 'Bridge', 'Chorus 2']);
  assert.equal(sections[5].repeat, 4);
  assert.deepEqual(arrangement.slice(-3), ['Verse 2', 'Verse 3', 'Chorus']);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------

test('flow cues are read into arrangement steps', () => {
  const labels = ['Verse 1', 'Verse 2', 'Verse 3', 'Chorus', 'Bridge', 'Coda'];
  const flow = (text, arrangement = ['Verse 1', 'Chorus', 'Verse 2', 'Coda']) => parseFlowDirective(text, { labels, arrangement }).steps;
  assert.deepEqual(flow('(REPEAT CHORUS)'), ['Chorus']);
  assert.deepEqual(flow('(CHORUS)'), ['Chorus']);
  assert.deepEqual(flow('(KORO)'), ['Chorus']);
  assert.deepEqual(flow('(ULITIN ANG KORO)'), ['Chorus']);
  assert.deepEqual(flow('(REPEAT CHORUS 2X)'), ['Chorus', 'Chorus']);
  assert.deepEqual(flow('(REPEAT CHORUS 3x)'), ['Chorus', 'Chorus', 'Chorus']);
  assert.deepEqual(flow('(REPEAT 1 & 2 THEN CHORUS 2X)'), ['Verse 1', 'Verse 2', 'Chorus', 'Chorus']);
  assert.deepEqual(flow('(REPEAT V2 & V3)'), ['Verse 2', 'Verse 3']);
  assert.deepEqual(flow('(REPEAT V- I / THEN CHORUS 2x)'), ['Verse 1', 'Chorus', 'Chorus']);
  assert.deepEqual(flow('(REPEAT CHO. & V1)'), ['Chorus', 'Verse 1']);
  assert.deepEqual(flow('(REPEAT VERSES 1&2)'), ['Verse 1', 'Verse 2']);
  assert.deepEqual(flow('(2ND VERSE 3x)'), ['Verse 2', 'Verse 2', 'Verse 2']);
  assert.deepEqual(flow('(REPEAT: I -4x-)(REPEAT: II)'), ['Verse 1', 'Verse 1', 'Verse 1', 'Verse 1', 'Verse 2']);
  // REPEAT ALL sings the flow so far again, without the coda.
  assert.deepEqual(flow('(REPEAT ALL)'), ['Verse 1', 'Chorus', 'Verse 2']);
  assert.deepEqual(flow('(REPEAT ALL THEN CHORUS)'), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);
  // A bare repeat is the step before it again; a bare multiplier sings it that many times in all.
  assert.deepEqual(flow('(REPEAT)', ['Verse 1']), ['Verse 1']);
  assert.deepEqual(flow('(2x, THEN REPEAT ALL)', ['Verse 1', 'Verse 2']), ['Verse 2', 'Verse 1', 'Verse 2']);
  assert.deepEqual(flow('(INSTRUMENTAL)'), []);
});

test('a cue that asks for a section the song does not have is reported, not guessed', () => {
  const result = parseFlowDirective('(REPEAT CHORUS, BRIDGE 3x)', { labels: ['Verse 1', 'Chorus'], arrangement: ['Verse 1', 'Chorus'] });
  assert.deepEqual(result.steps, ['Chorus']);
  assert.deepEqual(result.missing, ['Bridge']);
  const song = parseSongBody(paras(['I.ONE LINE OF A VERSE THAT IS SUNG', '(REPEAT CHORUS)']));
  assert.match(song.warnings[0], /no Chorus/);
});

test('//: … :// repeat marks and multipliers (2x), – 6X, (8x) are kept on the section or line they belong to', () => {
  const { sections, arrangement } = parseSongBody(
    paras([
      '//: WHERE THE SPIRIT OF THE LORD IS THERE IS FREEDOM ://',
      '',
      'THERE IS PEACE, THERE IS LOVE, THERE IS JOY.',
      '//: IT IS FOR FREEDOM YOU SET US FREE ://',
      '',
      'CODA:',
      'OH, SING FOR JOY TO GOD OUR STRENGTH (8x)',
    ]),
  );
  assert.equal(sections[0].repeat, 2);
  assert.deepEqual(sections[0].lines, ['WHERE THE SPIRIT OF THE LORD IS THERE IS FREEDOM']);
  // A repeat around part of a stanza stays on that line.
  assert.deepEqual(sections[1].lines, ['THERE IS PEACE, THERE IS LOVE, THERE IS JOY.', 'IT IS FOR FREEDOM YOU SET US FREE (2x)']);
  assert.equal(sections[2].label, 'Coda');
  assert.equal(sections[2].repeat, 8);
  assert.deepEqual(arrangement, ['Verse 1', 'Verse 2', 'Coda']);
});

test('a cue at the end of a lyric line is split off and read', () => {
  const { sections, arrangement } = parseSongBody(paras(['WHEN I’M WEAK, WHEN I FALL WHEN I’M DOWN CALL ME HAPPY. (REPEAT)']));
  assert.deepEqual(sections[0].lines, ['WHEN I’M WEAK, WHEN I FALL WHEN I’M DOWN CALL ME HAPPY.']);
  assert.deepEqual(arrangement, ['Verse 1', 'Verse 1']);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------

test('a wall of text is cut into slides of 2 to 4 lines, with no line too long for the projector', () => {
  const wall =
    'YOU SURROUNDED ME WITH SONGS OF PRAISE; YOU HAVE BROUGHT ME TO THIS PLACE; WHERE YOUR LOVE AND GRACE MOVE WITHIN MY LIFE NOW YOUR MESSAGE IS MY LIGHT. I AM PLANTED HERE BY THE WATERS AND I’M LIVING FOR THE KING I HAVE FOUND MY PEACE IN THE HOUSE OF GOD THIS IS WHERE I MEANT TO BE.';
  const slides = chunkSlides([wall]);
  assert.ok(slides.length >= 2);
  for (const slide of slides) {
    const lines = slide.split('\n');
    assert.ok(lines.length >= 2 && lines.length <= 4, `slide has ${lines.length} lines`);
    for (const line of lines) assert.ok(line.length <= 40, `"${line}" is ${line.length} characters`);
  }
  // Every word is kept, in order.
  assert.equal(slides.join(' ').replace(/\n/g, ' '), wall);
});

test('slides break at full stops where they can, and a short stanza stays one slide', () => {
  const slides = chunkSlides(['OUR FATHER WHO ART IN HEAVEN HALLOWED BE THY NAME. OUR FATHER HEAR US FROM HEAVEN FORGIVE OUR SINS WE PRAY.']);
  assert.ok(slides.join('\n').split('\n').some((l) => l.endsWith('NAME.')));
  assert.deepEqual(chunkSlides(['OPEN THE EYES OF MY HEART LORD', 'OPEN THE EYES OF MY HEART', 'I WANT TO SEE YOU']), ['OPEN THE EYES OF MY HEART LORD\nOPEN THE EYES OF MY HEART\nI WANT TO SEE YOU']);
  // Seven short lines: no slide of one line is left at the end.
  const seven = chunkSlides(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']).map((s) => s.split('\n').length);
  assert.ok(seven.every((n) => n >= 2 && n <= 4), String(seven));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------

test('each song’s language is detected: English, Tagalog and Cebuano, with mixed songs flagged', () => {
  assert.equal(detectLanguage('YOUR LOVE IS BEAUTIFUL, IT’S THE REASON WHY I SING. ALL AROUND THE WORLD LET THE PRAISE BEGIN').language, 'EN');
  assert.equal(detectLanguage('SALAMAT SA’YO HESUS SA BUHAY SUMIGLA. IYONG INIHAYAG ANG BAGONG PAG-ASA. KAYA NGAYON ANG BUHAY KO’Y MAY KATIYAKAN NA PURIHIN SIYA').language, 'TL');
  assert.equal(detectLanguage('ADLAW KARON SA PAGMAYA SA KAGAWASAN TA ANG PAGDAUG NI CRISTO KANATO NAGTUBOS. GUSTO KONG MO KANTA SA PAGDAYEG KANIYA UG DILI KA').language, 'CEB');
  const mixed = detectLanguage('MAGAGAWA NATIN ANG LAHAT NG BAGAY DITO SA MUNDO. IT’S A NEW DAY WITH THE LORD, A DAY OF JOY AND GLADNESS AND A VICTORY TO BE WON');
  assert.deepEqual([...mixed.mixed].sort(), ['EN', 'TL']);
  // God's names alone do not make a Cebuano song English.
  assert.deepEqual(detectLanguage('ADLAW SA PAGMAYA SA KAGAWASAN TA KANG JESUS UG GINOO NGA DILI MOBIYA KANATO').mixed, []);
});

test('duplicate titles are flagged within the file and against the library', () => {
  const doc = paras([
    { text: 'HEART OF WORSHIP', bold: true },
    'WHEN THE MUSIC FADES ALL IS STRIPPED AWAY AND I SIMPLY COME',
    { text: 'SHOUT TO THE LORD', bold: true },
    'MY JESUS, MY SAVIOUR LORD THERE IS NONE LIKE YOU ALL OF MY DAYS',
    { text: 'HEART OF WORSHIP', bold: true },
    'KING OF ENDLESS WORTH NO ONE COULD EXPRESS HOW MUCH YOU DESERVE',
  ]);
  const { songs } = parseLineup(doc, { existing: [{ id: 42, title: 'Shout to the Lord!' }] });
  assert.deepEqual(songs.map((s) => s.duplicate), [
    { inFile: null, existingId: null },
    { inFile: null, existingId: 42 },
    { inFile: songs[0].key, existingId: null },
  ]);
  assert.deepEqual(docxSongIssues(songs[1]).map((i) => i.code), ['inLibrary']);
  assert.deepEqual(docxSongIssues(songs[2]).map((i) => i.code), ['inFile']);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------

test('a song is saved as tagged lyrics in sung order that the hymn library accepts; a coda becomes the Outro', () => {
  const song = {
    title: 'X',
    sections: [
      { label: 'Verse 1', kind: 'Verse', lines: ['I WILL LIFT MY HANDS'], repeat: 1 },
      { label: 'Chorus', kind: 'Chorus', lines: ['YOU ARE WORTHY'], repeat: 1 },
      { label: 'Coda', kind: 'Coda', lines: ['AMEN'], repeat: 1 },
      { label: 'Ending', kind: 'Ending', lines: ['LA LA LA'], repeat: 1 },
    ],
    arrangement: ['Verse 1', 'Chorus', 'Chorus', 'Coda', 'Ending'],
  };
  const raw = songToTaggedLyrics(song, { caseMode: 'sentence' });
  const parsed = parseLyrics(raw);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.stanzas.map((s) => s.stanzaType), ['Verse 1', 'Chorus', 'Chorus', 'Outro', 'Outro 2']);
  assert.equal(parsed.stanzas[0].lyricsText, 'I will lift my hands');
  assert.equal(storedStanzaType('Coda'), 'Outro');
  assert.equal(storedStanzaType('Ending', ['Verse 1']), 'Outro');
  assert.equal(storedStanzaType('Chorus 2'), 'Chorus 2');
});

test('a song with more slides than a hymn can hold, or with no title, cannot be imported as it is', () => {
  const sections = [{ label: 'Verse 1', kind: 'Verse', lines: ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'], repeat: 1 }];
  const long = { title: 'LONG', sections, arrangement: Array(25).fill('Verse 1'), duplicate: { inFile: null, existingId: null }, warnings: [] };
  assert.ok(songSlides(long).length > 40);
  assert.deepEqual(docxSongIssues(long).map((i) => i.code), ['tooManySlides']);
  assert.deepEqual(docxSongIssues({ ...long, title: ' ', arrangement: ['Verse 1'] }).map((i) => i.code), ['noTitle']);
});

test('every importer label is written in English, Tagalog and Cebuano, with the same placeholders', async () => {
  const { DOCX_KEYS, DOCX_LANGS, docxStrings } = await import('./docx-import-i18n.js');
  const holes = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const lang of DOCX_LANGS) {
    const table = docxStrings(lang);
    assert.deepEqual(Object.keys(table).sort(), [...DOCX_KEYS].sort(), lang);
    for (const key of DOCX_KEYS) assert.equal(holes(table[key]), holes(docxStrings('en')[key]), `${lang}.${key}`);
  }
});

test('songs are sorted A–Z: case-insensitive, natural numbers, leading quotes ignored, ties keep file order', async () => {
  const { sortSongsAlphabetically } = await import('./docx-song-parser.js');
  const titles = (list) => list.map((s) => s.title);
  const songs = [
    { title: '"THIS I BELIEVE (THE CREED)"', n: 1 },
    { title: 'awesome in this place', n: 2 },
    { title: 'Psalm 10', n: 3 },
    { title: 'All Things Are Possible', n: 4 },
    { title: 'Psalm 2', n: 5 },
    { title: '“Freedom”', n: 6 },
    { title: 'FREEDOM', n: 7 },
    { title: 'Call Me Happy', n: 8 },
  ];
  const sorted = sortSongsAlphabetically(songs);
  assert.deepEqual(titles(sorted), ['All Things Are Possible', 'awesome in this place', 'Call Me Happy', '“Freedom”', 'FREEDOM', 'Psalm 2', 'Psalm 10', '"THIS I BELIEVE (THE CREED)"']);
  // Equal titles keep the file's order, and the input is left alone.
  assert.deepEqual(sorted.filter((s) => /freedom/i.test(s.title)).map((s) => s.n), [6, 7]);
  assert.equal(songs[0].n, 1);
  assert.deepEqual(sortSongsAlphabetically([]), []);
});

test('reorderPreviewSlides moves one slide to a new place in the preview grid', async () => {
  const { reorderPreviewSlides } = await import('./docx-song-parser.js');
  const grid = ['V1', 'V2', 'V3', 'C-a', 'C-b', 'V2b']; // two rows of three
  // Forward along a row.
  assert.deepEqual(reorderPreviewSlides(grid, 0, 2), ['V2', 'V3', 'V1', 'C-a', 'C-b', 'V2b']);
  // Backward along a row.
  assert.deepEqual(reorderPreviewSlides(grid, 2, 0), ['V3', 'V1', 'V2', 'C-a', 'C-b', 'V2b']);
  // Across rows, both ways.
  assert.deepEqual(reorderPreviewSlides(grid, 1, 4), ['V1', 'V3', 'C-a', 'C-b', 'V2', 'V2b']);
  assert.deepEqual(reorderPreviewSlides(grid, 5, 0), ['V2b', 'V1', 'V2', 'V3', 'C-a', 'C-b']);
  // No-op drops and bad indexes give an unchanged copy.
  assert.deepEqual(reorderPreviewSlides(grid, 3, 3), grid);
  assert.notEqual(reorderPreviewSlides(grid, 3, 3), grid);
  assert.deepEqual(reorderPreviewSlides(grid, 9, 0), grid);
  assert.deepEqual(reorderPreviewSlides(grid, -1, 0), grid);
  // A target past the end lands last.
  assert.deepEqual(reorderPreviewSlides(grid, 0, 99), ['V2', 'V3', 'C-a', 'C-b', 'V2b', 'V1']);
  assert.deepEqual(grid, ['V1', 'V2', 'V3', 'C-a', 'C-b', 'V2b']);
});


// The slides deck: the review screen's one source of truth for a song's slide order.
const deckSong = () => ({
  title: 'DECK',
  sections: [
    { label: 'Verse 1', kind: 'Verse', lines: ['FIRST VERSE OF GOD'], repeat: 1 },
    { label: 'Chorus', kind: 'Chorus', lines: ['THE CHORUS'], repeat: 1 },
    { label: 'Verse 2', kind: 'Verse', lines: ['SECOND VERSE'], repeat: 1 },
    // Long enough to make two slides.
    { label: 'Tag', kind: 'Tag', lines: ['TAG ONE', 'TAG TWO', 'TAG THREE', 'TAG FOUR', 'TAG FIVE', 'TAG SIX'], repeat: 1 },
  ],
  arrangement: ['Verse 1', 'Chorus', 'Verse 2'],
  duplicate: { inFile: null, existingId: null },
  warnings: [],
});
const texts = (song, opts) => songSlides(song, opts).map((s) => s.text);

test('with no deck of its own, a song follows its parsed arrangement, slide by slide', async () => {
  const { defaultDeck, songDeck } = await import('./docx-song-parser.js');
  const song = deckSong();
  assert.deepEqual(
    defaultDeck(song).map((r) => [r.id, r.label, r.chunk]),
    [
      ['d0', 'Verse 1', 0],
      ['d1', 'Chorus', 0],
      ['d2', 'Verse 2', 0],
    ],
  );
  // The parsed deck's ids are the same every time, so cards keep their keys until the operator edits.
  assert.deepEqual(songDeck(song), defaultDeck(song));
  assert.deepEqual(texts(song), ['FIRST VERSE OF GOD', 'THE CHORUS', 'SECOND VERSE']);
  assert.deepEqual(texts({ ...song, deck: null }), texts(song));
});

test('adding a section puts all of its slides at the end of the deck', async () => {
  const { appendSection, defaultDeck } = await import('./docx-song-parser.js');
  const song = deckSong();
  const deck = appendSection(defaultDeck(song), song, 'Tag');
  assert.deepEqual(
    deck.slice(3).map((r) => [r.label, r.chunk]),
    [
      ['Tag', 0],
      ['Tag', 1],
    ],
  );
  assert.equal(new Set(deck.map((r) => r.id)).size, deck.length);
  const tag = texts({ ...song, deck }).slice(3);
  assert.equal(tag.length, 2);
  assert.match(tag[0], /^TAG ONE/);
  assert.match(tag[1], /TAG SIX$/);
  // A section the song does not have adds nothing.
  assert.deepEqual(appendSection(deck, song, 'Bridge'), deck);
  // Adding the chorus again repeats it at the end.
  assert.deepEqual(texts({ ...song, deck: appendSection(defaultDeck(song), song, 'Chorus') }), ['FIRST VERSE OF GOD', 'THE CHORUS', 'SECOND VERSE', 'THE CHORUS']);
});

test('duplicating a slide card puts a copy straight after it, with its own id', async () => {
  const { defaultDeck, duplicateSlide } = await import('./docx-song-parser.js');
  const base = defaultDeck(deckSong());
  const deck = duplicateSlide(base, 1);
  assert.deepEqual(
    deck.map((r) => r.label),
    ['Verse 1', 'Chorus', 'Chorus', 'Verse 2'],
  );
  assert.notEqual(deck[2].id, deck[1].id);
  assert.deepEqual(
    base.map((r) => r.label),
    ['Verse 1', 'Chorus', 'Verse 2'],
  );
  assert.deepEqual(duplicateSlide(base, 9), base);
  assert.deepEqual(duplicateSlide(base, -1), base);
});

test('removing a slide card takes it out, but never the last slide', async () => {
  const { defaultDeck, removeSlide } = await import('./docx-song-parser.js');
  const song = deckSong();
  const deck = removeSlide(defaultDeck(song), 0);
  assert.deepEqual(texts({ ...song, deck }), ['THE CHORUS', 'SECOND VERSE']);
  const one = removeSlide(removeSlide(deck, 0), 0);
  assert.equal(one.length, 1);
  assert.deepEqual(removeSlide(one, 0), one);
  assert.deepEqual(removeSlide(deck, 5), deck);
});

test('dragging cards across rows reorders the deck, and the saved lyrics follow it 1:1', async () => {
  const { appendSection, defaultDeck, duplicateSlide, reorderPreviewSlides } = await import('./docx-song-parser.js');
  const song = deckSong();
  // Six cards: two rows of three.
  let deck = appendSection(duplicateSlide(defaultDeck(song), 1), song, 'Tag');
  assert.equal(deck.length, 6);
  // From the first row into the second, then from the end back to the front.
  deck = reorderPreviewSlides(deck, 0, 4);
  deck = reorderPreviewSlides(deck, 5, 0);
  assert.deepEqual(
    deck.map((r) => `${r.label}/${r.chunk}`),
    ['Tag/1', 'Chorus/0', 'Chorus/0', 'Verse 2/0', 'Tag/0', 'Verse 1/0'],
  );
  const shown = texts({ ...song, deck });
  const saved = parseLyrics(songToTaggedLyrics({ ...song, deck })).stanzas;
  assert.deepEqual(
    saved.map((s) => s.lyricsText),
    shown,
  );
  assert.deepEqual(
    saved.map((s) => s.stanzaType),
    ['Tag', 'Chorus', 'Chorus', 'Verse 2', 'Tag', 'Verse 1'],
  );
});

test('reset brings back the parsed arrangement, and a deck edited back to it is not a custom order', async () => {
  const { defaultDeck, duplicateSlide, removeSlide, reorderPreviewSlides, sameDeck } = await import('./docx-song-parser.js');
  const song = deckSong();
  const edited = reorderPreviewSlides(defaultDeck(song), 2, 0);
  assert.equal(sameDeck(edited, defaultDeck(song)), false);
  assert.deepEqual(texts({ ...song, deck: edited }), ['SECOND VERSE', 'FIRST VERSE OF GOD', 'THE CHORUS']);
  // Reset is `deck: null`.
  assert.deepEqual(texts({ ...song, deck: null }), ['FIRST VERSE OF GOD', 'THE CHORUS', 'SECOND VERSE']);
  // Duplicating a card and then removing the copy gives the parsed order again.
  assert.equal(sameDeck(removeSlide(duplicateSlide(defaultDeck(song), 0), 1), defaultDeck(song)), true);
  assert.equal(sameDeck(null, defaultDeck(song)), false);
});

test('switching between sentence case and original capitals keeps the custom slide order', async () => {
  const { appendSection, defaultDeck, reorderPreviewSlides } = await import('./docx-song-parser.js');
  const song = deckSong();
  const deck = reorderPreviewSlides(appendSection(defaultDeck(song), song, 'Chorus'), 2, 0);
  const sentence = songSlides({ ...song, deck }, { caseMode: 'sentence' });
  const preserve = songSlides({ ...song, deck }, { caseMode: 'preserve' });
  assert.deepEqual(
    sentence.map((s) => s.id),
    deck.map((r) => r.id),
  );
  assert.deepEqual(
    preserve.map((s) => s.id),
    deck.map((r) => r.id),
  );
  assert.deepEqual(
    preserve.map((s) => s.text),
    ['SECOND VERSE', 'FIRST VERSE OF GOD', 'THE CHORUS', 'THE CHORUS'],
  );
  assert.deepEqual(
    sentence.map((s) => s.text),
    ['Second verse', 'First verse of God', 'The chorus', 'The chorus'],
  );
  assert.match(songToTaggedLyrics({ ...song, deck }, { caseMode: 'sentence' }), /^\[V2\]\s*Second verse/);
});

test('a deck entry for a section or slide the song does not have is skipped', () => {
  const song = deckSong();
  const deck = [
    { id: 'a', label: 'Chorus', chunk: 0 },
    { id: 'b', label: 'Bridge', chunk: 0 },
    { id: 'c', label: 'Verse 1', chunk: 3 },
    { id: 'd', label: 'Verse 1', chunk: 0 },
  ];
  assert.deepEqual(
    songSlides({ ...song, deck }).map((s) => [s.id, s.text]),
    [
      ['a', 'THE CHORUS'],
      ['d', 'FIRST VERSE OF GOD'],
    ],
  );
  assert.deepEqual(
    docxSongIssues({ ...song, deck: [] }).map((i) => i.code),
    ['noSlides'],
  );
});

test('each imported slide can be given a part on its card; a long section’s later slides start as continuations', async () => {
  const { defaultDeck, sameDeck, setDeckSlidePart } = await import('./docx-song-parser.js');
  const verse = Array.from({ length: 8 }, (_, i) => `SAMPLE LYRIC LINE ${i + 1}`);
  const song = { sections: [{ label: 'Verse 1', lines: verse }, { label: 'Chorus', lines: ['SAMPLE CHORUS LINE'] }], arrangement: ['Verse 1', 'Chorus'] };
  const deck = defaultDeck(song);
  const parts = (d) => songSlides({ ...song, deck: d }).map((s) => [s.continuation ? '' : s.type, s.type]);
  assert.deepEqual(parts(deck), [['Verse 1', 'Verse 1'], ['', 'Verse 1'], ['Chorus', 'Chorus']]);

  const tagged = setDeckSlidePart(deck, 1, 'Bridge');
  assert.deepEqual(parts(tagged), [['Verse 1', 'Verse 1'], ['Bridge', 'Bridge'], ['Chorus', 'Chorus']]);
  assert.equal(sameDeck(tagged, deck), false, 'a chosen part is an edit');
  assert.deepEqual(parseLyrics(songToTaggedLyrics({ ...song, deck: tagged })).stanzas.map((s) => s.stanzaType), ['Verse 1', 'Bridge', 'Chorus']);

  // A continuation carries on the slide before it, whatever that is; the first slide cannot be one.
  const cont = setDeckSlidePart(setDeckSlidePart(deck, 2, ''), 0, '');
  assert.deepEqual(parts(cont), [['Verse 1', 'Verse 1'], ['', 'Verse 1'], ['', 'Verse 1']]);
  assert.deepEqual(parseLyrics(songToTaggedLyrics({ ...song, deck: cont })).stanzas.map((s) => s.stanzaType), ['Verse 1', 'Verse 1', 'Verse 1']);
});
