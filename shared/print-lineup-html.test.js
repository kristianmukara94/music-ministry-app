// Print Lineup paper (shared/print-lineup-html.js): one standalone, monochrome, script-free HTML document used by the preview, the Print
// dialog and the PDF. Synthetic data only. Run with: node --test shared/print-lineup-html.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DENSITIES, HALF_GUTTER, MARGINS, PAGE, SIZES, checkPrintJob, copyWidth, fitDensity, iconSvg, lineupDocument, pageSizeRule, pdfFileName, sheetOf } from './print-lineup-html.js';
import { PAPER_SIZES, paperSizeOf, pwPrintLineup } from './print-lineup.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const hymns = { 1: { title: 'Sample Song 1', musicalKey: 'Bb' }, 2: { title: 'Sample Song 2', musicalKey: 'F#m' }, 3: { title: 'Sample Song 3', musicalKey: 'None' } };
const seg = (name, group, minutes, content) => ({ name, group, minutes, content: { hymnIds: [], more: [], ...content } });
const session = {
  groups: [{ key: 'a', name: 'Sample Opening' }, { key: 'b', name: 'Sample Worship' }],
  segments: [
    seg('Sample Segment', 'a', 3, { kind: 'prayer', noteId: 7 }),
    seg('Sample Slot', 'a', 5, { kind: 'song', hymnIds: [1] }),
    seg('Sample Chained Segment', 'b', 8, { kind: 'song', hymnIds: [2, 3] }),
    seg('Sample Empty Slot', 'b', 4, { kind: 'song' }),
    seg('Sample Reading Slot', 'b', 2, { kind: 'lectionary', readingType: 'Sample Scripture' }),
    seg('Sample Title Slot', 'b', 1, { kind: 'title' }),
  ],
};
const lineup = pwPrintLineup(session, { title: 'Sample Session', subtitle: 'Sample Day', hymns, noteTitle: () => 'Sample Prayer' });
const doc = (options) => lineupDocument(lineup, { church: 'Sample Parish', ...options });

/** The body's text between two markers of the document, for checking one row. */
const rowOf = (html, text) => {
  const at = html.indexOf(text);
  const start = html.lastIndexOf('<li class="row"', at);
  const ends = [html.indexOf('<li class="row"', at), html.indexOf('</ol></section>', at)].filter((i) => i > 0);
  return html.slice(start, Math.min(...ends));
};

test('the paper is a complete light-mode document with no script and nothing loaded from outside', () => {
  const html = doc();
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /color-scheme: light/);
  assert.match(html, /html, body \{ margin: 0; padding: 0; background: #ffffff;/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /https?:\/\//, 'no fonts, images or styles fetched from anywhere');
});

/** Every distinct #rrggbb in a document, and whether it is a grey (the neutral Tailwind greys have the faintest hint of blue). */
const coloursOf = (html) => [...new Set((html.match(/#[0-9a-f]{6}\b/gi) ?? []).map((x) => x.toLowerCase()))];
const isGrey = (c) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) <= 28;
};

test('B&W: the paper is strictly black and white, every colour a grey, with black-ruled grey section bands', () => {
  const html = doc({ colorMode: 'bw' });
  assert.match(html, /<body class="density-roomy" data-color-mode="bw">/);
  const colours = coloursOf(html);
  assert.ok(colours.length > 0);
  for (const c of colours) assert.ok(isGrey(c), `${c} is a grey`);
  assert.doesNotMatch(html, /rgb\(|hsl\(/);
  assert.match(html, /html, body \{ margin: 0; padding: 0; background: #ffffff;/, 'white paper');
  assert.match(html, /\.section-head \{[^}]*background: #f3f4f6; border-top: 1\.5px solid #000000; border-bottom: 1px solid #000000; padding: 3px 6px; margin-top: 8px;[^}]*print-color-adjust: exact;/);
  assert.match(html, /\.section-head h2, \.section-head \.mono \{ color: #000000; font-weight: 700; \}/, 'section name and minutes in solid black');
  assert.doesNotMatch(html, /data-kind="song"\] > \.icon/, 'no colour-coded icon boxes');
});

test('Color (the default): white paper, a tinted section band, colour-coded icons and key pills, all kept in colour when printed', () => {
  const html = doc();
  assert.equal(html, doc({ colorMode: 'color' }), 'colour is the default');
  assert.equal(doc({ colorMode: 'sepia' }), html, 'an unknown mode prints in colour');
  assert.match(html, /data-color-mode="color"/);
  assert.match(html, /html, body \{ margin: 0; padding: 0; background: #ffffff;/, 'still white paper');
  assert.match(html, /\.sheet \{\n  position: relative; display: grid; align-items: stretch; background: #ffffff;/);
  assert.match(html, /\.section-head \{[^}]*background: #fef9ec; border-left: 3px solid #b45309; border-bottom: 1px solid #d97706; padding: 3px 6px;[^}]*print-color-adjust: exact;/);
  assert.match(html, /\.section-head h2, \.section-head \.mono \{ color: #111827; font-weight: 700; \}/);
  assert.match(html, /\.row\[data-kind="song"\] > \.icon \{ border-color: #b45309; background: #fffbeb; \}/);
  assert.match(html, /\.row\[data-kind="prayer"\] > \.icon \{ border-color: #4338ca; background: #eef2ff; \}/);
  assert.match(html, /\.row\[data-kind="reading"\] > \.icon \{ border-color: #047857; background: #ecfdf5; \}/);
  assert.match(html, /\.row\[data-kind="song"\] > \.icon svg, \.subcard\[data-kind="song"\] svg \{ stroke: #b45309; \}/, 'the notes in a multi-song card are amber too');
  assert.match(html, /\.key \{ background: #eff6ff; border: 1px solid #1d4ed8; color: #1e3a8a; font-weight: 700; \}/);
  assert.match(html, /\.badge, \.icon, \.icon svg, \.subcard svg, \.key \{ -webkit-print-color-adjust: exact; print-color-adjust: exact; \}/);
  assert.ok(coloursOf(html).some((c) => !isGrey(c)), 'colour mode carries colour');
  // The key pill still prints only a real key, in its own case.
  assert.match(rowOf(html, 'Sample Song 1'), /<small>Key<\/small>Bb<\/span>/);
  assert.doesNotMatch(rowOf(html, 'Sample Song 3'), /<small>Key<\/small>None/);
});

test('both modes: songs extra-bold black, slot labels and title cards normal-weight black', () => {
  for (const colorMode of ['color', 'bw']) {
    const html = doc({ colorMode });
    assert.match(html, /\.title, \.song \{\n  font-weight: 800; color: #000000;/, colorMode);
    assert.match(html, /\.role, \.text, \.under \{ font-weight: 400; color: #000000;[^}]*print-color-adjust: exact; \}/, colorMode);
    assert.doesNotMatch(html, /\.(role|text|under)[^{]*\{[^}]*color: (?!#000000)/, `${colorMode}: no slot or card title in grey`);
  }
});

test('the letterhead carries the parish, the lineup badge, the title, the date and the total runtime over a 1.5pt rule', () => {
  const html = doc();
  assert.match(html, /<span class="parish">Sample Parish<\/span>/);
  assert.match(html, /<span class="badge">Praise &amp; Worship Lineup<\/span>/);
  assert.match(html, /<h1>Sample Session<\/h1>/);
  assert.match(html, /<p class="meta">Sample Day &nbsp;·&nbsp; <span class="total">Total 23 min<\/span><\/p>/);
  assert.match(html, /\.head \{ border-bottom: 1\.5pt solid var\(--ink\);/);
  assert.doesNotMatch(lineupDocument(lineup, {}), /class="parish"/, 'no parish name, no empty letterhead line');
  const mass = lineupDocument({ type: 'mass', title: 'Sample Plan', subtitle: '', minutes: null, sections: [] }, {});
  assert.match(mass, /<span class="badge">Holy Mass Lineup<\/span>/);
  assert.match(mass, /<p class="empty">/);
});

test('each section heads its rows with its name and minutes; each row has a number and a monochrome icon box', () => {
  const html = doc();
  assert.match(html, /<div class="section-head"><h2>Sample Opening<\/h2><span class="mono">8 min<\/span><\/div>/);
  assert.match(html, /<div class="section-head"><h2>Sample Worship<\/h2><span class="mono">15 min<\/span><\/div>/);
  assert.match(html, /\.icon \{\n  width: 18pt; height: 18pt; border: 1px solid #000000; border-radius: 4px;/, 'a short lineup prints roomy: an 18 pt rounded box with a black border');
  assert.match(rowOf(html, 'Sample Prayer'), /<span class="num mono">01<\/span><span class="icon">/);
  // The icon matches the item: a cross for a prayer, a note for a song, a book for a reading.
  assert.ok(rowOf(html, 'Sample Prayer').includes(iconSvg('prayer')));
  assert.ok(rowOf(html, 'Sample Song 1').includes(iconSvg('song')));
  assert.ok(rowOf(html, 'Sample Scripture').includes(iconSvg('reading')));
  assert.notEqual(iconSvg('prayer'), iconSvg('song'));
  assert.notEqual(iconSvg('song'), iconSvg('reading'));
  for (const kind of ['prayer', 'song', 'reading', 'other']) assert.match(iconSvg(kind), /stroke="#000"/);
});

test('a single song shows its slot role small above a large bold title; a prayer or reading shows its title with the role under it', () => {
  const html = doc();
  assert.match(rowOf(html, 'Sample Song 1'), /<span class="role">Sample Slot<\/span><span class="title">Sample Song 1<\/span>/);
  assert.match(rowOf(html, 'Sample Prayer'), /<span class="text">Sample Prayer<\/span><span class="under">Sample Segment<\/span>/);
  assert.match(html, /\.title \{ font-size: 11pt; \}/, 'the song title is the largest word on a row');
  assert.match(html, /\.role \{ font-size: 7\.5pt;/);
  assert.match(doc({ layout: 'single' }), /\.title \{ font-size: 13pt; \}/, 'one copy per page reads larger');
});

test('song titles are solid bold black; slot labels and title-only cards are normal weight', () => {
  const html = doc();
  // Every song, alone on its card or in a multi-song card, is 800-weight pure black, kept black even where a printer saves ink.
  assert.match(html, /\.title, \.song \{\n  font-weight: 800; color: #000000; overflow-wrap: anywhere; line-height: 1\.15;\n  -webkit-print-color-adjust: exact; print-color-adjust: exact;\n\}/);
  assert.match(rowOf(html, 'Sample Song 1'), /<span class="title">Sample Song 1<\/span>/);
  assert.match(rowOf(html, 'Sample Chained Segment'), /<span class="song">Sample Song 2<\/span>[^]*<span class="song">Sample Song 3<\/span>/);
  // Slot labels (above a song, under a prayer, heading a multi-song card) and title-only cards are never bold.
  // Solid pure black at normal weight, kept black where a printer would save ink.
  assert.match(html, /\.role, \.text, \.under \{ font-weight: 400; color: #000000; overflow-wrap: anywhere; -webkit-print-color-adjust: exact; print-color-adjust: exact; \}/);
  assert.match(html, /\.num \{ font-size: [\d.]+pt; font-weight: 700; color: #000000;/, 'row numbers in black');
  assert.match(html, /\.subcard \.n \{[^}]*color: #1f2937;/, 'sub-card numbers in dark charcoal');
  assert.match(rowOf(html, 'Sample Title Slot'), /<span class="text">Sample Title Slot<\/span>/, 'a title-only card is normal weight');
  assert.match(rowOf(html, 'Sample Song 1'), /<span class="role">Sample Slot<\/span>/, 'the slot above a song is normal weight');
  assert.match(rowOf(html, 'Sample Chained Segment'), /<span class="role segment">Sample Chained Segment<\/span>/);
  assert.doesNotMatch(html, /\.(role|text|under|segment)[^{]*\{[^}]*font-weight: (600|700|800)/, 'no slot or title-card rule is bold');
  // A title-only card from the synthetic plan.
  const titleCard = { type: 'mass', title: 'Sample Plan', subtitle: '', minutes: null, sections: [{ heading: 'Sample Part', minutes: null, entries: [{ number: '01', name: 'Sample Title Card', kind: 'other', minutes: null, items: [] }] }] };
  assert.match(lineupDocument(titleCard, {}), /<div class="body"><span class="text">Sample Title Card<\/span><\/div>/);
});

test('a card with several songs lists each as an indented sub-card with its own key', () => {
  const row = rowOf(doc(), 'Sample Chained Segment');
  assert.match(row, /data-chained/);
  assert.match(row, /<span class="role segment">Sample Chained Segment<\/span><span class="count">2 items<\/span>/);
  assert.match(row, /<ol class="subs"><li class="subcard" data-kind="song"><span class="n mono">1<\/span><svg[^]*?<span class="song">Sample Song 2<\/span><span class="key" data-song-key><small>Key<\/small>F#m<\/span><\/li><li class="subcard" data-kind="song"><span class="n mono">2<\/span><svg[^]*?<span class="song">Sample Song 3<\/span><\/li><\/ol>/);
  assert.match(doc(), /\.subs \{\n  grid-column: 2 \/ -1; margin: [^;]+; padding-left: 2\.6mm;\n  border-left: 1\.5px solid var\(--rule\);/);
});

test('a song key prints only when set, and keeps its musical case whatever the text case', () => {
  const html = doc();
  assert.match(rowOf(html, 'Sample Song 1'), /<span class="key" data-song-key><small>Key<\/small>Bb<\/span>/);
  assert.match(html, /<span class="song">Sample Song 3<\/span><\/li>/, '"None" prints no key');
  assert.doesNotMatch(html, />None</);
  assert.doesNotMatch(rowOf(html, 'Sample Prayer'), /data-song-key/);
  for (const mode of ['uppercase', 'lowercase']) {
    const cased = doc({ mode });
    assert.match(cased, /<small>Key<\/small>Bb<\/span>/, `${mode}: Bb stays Bb`);
    assert.match(cased, /<small>Key<\/small>F#m<\/span>/, `${mode}: F#m stays F#m`);
  }
  assert.match(doc({ mode: 'uppercase' }), /<span class="title">SAMPLE SONG 1<\/span>/);
  assert.match(doc({ mode: 'lowercase' }), /<span class="title">sample song 1<\/span>/);
  assert.match(doc(), /\.key \{[^}]*text-transform: none;/);
});

test('an empty song slot prints its name and a write-in line', () => {
  const row = rowOf(doc(), 'Sample Empty Slot');
  assert.match(row, /data-empty/);
  assert.match(row, /<span class="role">Sample Empty Slot<\/span><span class="writein" data-write-in><\/span>/);
  const title = rowOf(doc(), 'Sample Title Slot');
  assert.match(title, /<div class="body"><span class="text">Sample Title Slot<\/span><\/div>/, 'a title card prints its name alone');
  assert.doesNotMatch(title, /data-write-in|data-empty/);
  assert.match(doc(), /\.writein \{ display: block; height: [\d.]+pt; border-bottom: 1px solid var\(--ink\);/);
});

test('2 copies per page: a portrait sheet with two identical columns split by a dashed cut line, each footed "Copy n of 2"', () => {
  const html = doc({ layout: 'double' });
  assert.equal(PAGE.double.landscape, false);
  assert.match(html, /@page \{ size: A4 portrait; margin: 0; \}/);
  assert.match(html, /<main class="sheet" data-layout="double" data-paper="A4" data-copies="2">/);
  assert.match(html, /\.sheet\[data-copies="2"\] \{ grid-template-columns: 1fr 1fr; \}/);
  // 8 mm either side of the cut line, as at the outer edges: each cut slip has equal left and right margins.
  assert.equal(HALF_GUTTER, 8);
  assert.match(html, /\.sheet\[data-copies="2"\] \.copy:first-of-type \{ padding-right: 8mm; \}/);
  assert.match(html, /\.sheet\[data-copies="2"\] \.copy \+ \.copy \{ padding-left: 8mm; \}/);
  assert.match(html, /\.sheet \{\n[^}]*padding: 10mm 8mm;/);
  // The line is drawn over the middle of the sheet, not as a border on one copy, so both columns are exactly as wide.
  assert.match(html, /\.sheet\[data-copies="2"\]::before \{\n  content: ''; position: absolute; left: 50%; top: 10mm; bottom: 10mm; border-left: 1px dashed var\(--rule\);/);
  assert.doesNotMatch(html, /\.copy[^{]*\{[^}]*border-left/);
  for (const paper of PAPER_SIZES) {
    const width = copyWidth(sheetOf('double', paper), 'double');
    assert.ok(width >= 88 && width <= 94, `${paper}: each copy's column is about 90 mm (${width} mm)`);
  }
  assert.equal((html.match(/✂ Cut here/g) ?? []).length, 2, 'a cut mark at the top and the foot of the line');
  const copies = html.match(/<article class="copy" data-copy="\d">[^]*?<\/article>/g);
  assert.equal(copies.length, 2);
  const strip = (c) => c.replace(/data-copy="\d"/, '').replace(/Copy \d of 2/, '');
  assert.equal(strip(copies[0]), strip(copies[1]), 'the two copies are identical');
  assert.match(copies[0], /<footer class="foot"><span>Copy 1 of 2<\/span><\/footer>/);
  assert.match(copies[1], /<footer class="foot"><span>Copy 2 of 2<\/span><\/footer>/);
});

test('1 copy per page: one full-width copy on a portrait sheet, with no cut line or copy footer', () => {
  const html = doc({ layout: 'single' });
  assert.equal(PAGE.single.landscape, false);
  assert.match(html, /@page \{ size: A4 portrait; margin: 0; \}/);
  assert.match(html, /data-copies="1"/);
  assert.equal((html.match(/<article class="copy"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /class="cut|class="foot"/);
});

test('no row or sub-card splits across a page; headings stay with their first row', () => {
  const html = doc();
  assert.match(html, /\.row \{[^}]*break-inside: avoid; page-break-inside: avoid;/);
  assert.match(html, /\.subcard \{[^}]*break-inside: avoid;/);
  assert.match(html, /\.section-head \{[^}]*break-after: avoid;/);
});

test('every word from the plan is escaped', () => {
  const bad = { type: 'pw', title: 'Sample <b>Session</b>', subtitle: '"Sample" & Day', minutes: null, sections: [{ heading: '<i>Sample</i>', minutes: null, entries: [{ number: '01', name: 'Sample <script>alert(1)</script>', kind: 'song', minutes: null, items: [{ kind: 'song', title: "Sample 'Song' <1>", key: '<G>' }] }] }] };
  const html = lineupDocument(bad, { church: 'Sample <Parish>' });
  assert.doesNotMatch(html, /<script|<b>|<i>|<G>|<Parish>|<1>/);
  assert.match(html, /Sample &lt;b&gt;Session&lt;\/b&gt;/);
  assert.match(html, /Sample &#39;Song&#39; &lt;1&gt;/);
});

test('the type steps down only as far as a usual lineup needs to fit one sheet', () => {
  // Three parts, as a usual lineup has, with the cards shared among them. (Thresholds checked against real layout in Electron printToPDF, A4/Letter/Legal, both inks.)
  const many = (n, title = 'Sample Song') => ({
    type: 'pw', title: 'Sample', subtitle: '', minutes: null,
    sections: [0, 1, 2].map((g) => ({ heading: `Sample ${g}`, minutes: null, entries: Array.from({ length: Math.ceil(n / 3) }, (_, i) => ({ number: '01', name: 'Sample Slot', kind: 'song', minutes: 3, items: [{ kind: 'song', title: `${title} ${i + 1}`, key: null }] })) })),
  });
  assert.deepEqual(DENSITIES, ['roomy', 'normal', 'compact', 'dense', 'tight']);
  // Two portrait columns are tall: a usual lineup prints roomy and steps down only past 18 cards.
  assert.equal(fitDensity(many(6), 'double'), 'roomy', 'a very short lineup prints roomy, so the copy fills its column');
  assert.equal(fitDensity(many(12), 'double'), 'roomy');
  assert.equal(fitDensity(many(18), 'double'), 'roomy', 'a full 18-card lineup fits two portrait copies at the roomiest');
  assert.equal(fitDensity(many(21), 'double'), 'compact');
  assert.equal(fitDensity(many(22), 'double'), 'dense', 'a 22-card lineup still fits two copies on one sheet');
  assert.equal(fitDensity(many(22), 'double', 'Legal'), 'roomy', 'Legal paper is taller still');
  assert.equal(fitDensity(many(15), 'single'), 'roomy', 'one copy of 15 cards still prints roomy under the slimmer section bands');
  assert.equal(fitDensity(many(18), 'single'), 'compact', 'one copy per page reads larger, so steps down sooner');
  assert.equal(fitDensity(many(15), 'single', 'Legal'), 'roomy');
  assert.equal(fitDensity(many(21), 'single', 'Letter'), 'dense');
  assert.equal(fitDensity(many(21), 'single'), 'dense');
  assert.equal(fitDensity(many(60), 'double'), 'tight', 'too long for one sheet: the tightest size, over more pages');
  const long = 'Sample Song With A Very Long Title That Wraps Onto Another Line';
  assert.equal(fitDensity(many(12, long), 'double'), 'dense', 'long titles that wrap in a narrow column count against the room');
  // Each step keeps the song title the largest word on a row, within the sizes a musician reads at a glance.
  for (const d of DENSITIES) {
    assert.ok(SIZES.double[d].title >= 9.5 && SIZES.double[d].title <= 11, `two copies, ${d}: 9.5–11 pt`);
    assert.ok(SIZES.single[d].title >= 11.5 && SIZES.single[d].title <= 13, `one copy, ${d}: 11.5–13 pt`);
    for (const l of ['double', 'single']) assert.ok(SIZES[l][d].title > SIZES[l][d].sub && SIZES[l][d].sub > SIZES[l][d].role);
  }
  assert.match(lineupDocument(many(60), {}), /<body class="density-tight" data-color-mode="color">/);
});

test('a print job from the window is checked: known layout, case and language; a bounded, well-formed lineup', () => {
  assert.throws(() => checkPrintJob(null), /no lineup/);
  assert.throws(() => checkPrintJob({ lineup: { sections: 'x' } }), /no lineup/);
  const job = checkPrintJob({ lineup, layout: 'sideways', mode: 'shouting', lang: 'xx', church: 'Sample Parish' });
  assert.equal(job.layout, 'double', 'an unknown layout prints two copies');
  assert.equal(job.landscape, false, 'two copies print portrait');
  assert.equal(job.mode, 'original');
  assert.equal(job.lang, 'en');
  assert.equal(job.church, 'Sample Parish');
  assert.equal(job.paper, 'A4', 'no paper prints on A4');
  assert.equal(job.pageSize, 'A4');
  assert.equal(job.colorMode, 'color', 'no ink prints in colour');
  assert.equal(checkPrintJob({ lineup, colorMode: 'bw' }).colorMode, 'bw');
  assert.equal(checkPrintJob({ lineup, colorMode: 'rainbow' }).colorMode, 'color');
  assert.deepEqual(job.lineup, lineup, 'a good lineup passes through unchanged');
  for (const [given, paper] of [['Letter', 'Letter'], ['legal', 'Legal'], ['Tabloid', 'A4'], [42, 'A4']]) {
    const checked = checkPrintJob({ lineup, paper: given });
    assert.equal(checked.paper, paper, `${given} → ${paper}`);
    assert.equal(checked.pageSize, paper);
  }
  for (const layout of ['double', 'single']) {
    for (const paper of PAPER_SIZES) assert.equal(checkPrintJob({ lineup, layout, paper }).landscape, false, `${layout} on ${paper} is portrait`);
  }
  const odd = checkPrintJob({ lineup: { title: 'x'.repeat(5000), sections: [{ entries: [{ kind: 'bogus', items: [{ kind: 'prayer', title: 1, key: 'G' }, { kind: 'song', title: 'Sample Song 1', key: '-' }] }] }] } });
  assert.equal(odd.lineup.title.length, 300);
  assert.equal(odd.lineup.sections[0].entries[0].kind, 'other');
  assert.deepEqual(odd.lineup.sections[0].entries[0].items, [{ kind: 'prayer', title: '1', key: null }, { kind: 'song', title: 'Sample Song 1', key: null }], 'only a song carries a key, and only a real one');
});

test('a saved PDF is offered as <Service-Title>-Lineup.pdf, safe as a Windows file name', () => {
  assert.equal(pdfFileName('Sample Session'), 'Sample-Session-Lineup.pdf');
  assert.equal(pdfFileName('Sample: Session / 2026?'), 'Sample-Session-2026-Lineup.pdf');
  assert.equal(pdfFileName(''), 'Lineup.pdf');
  assert.equal(pdfFileName('...'), 'Lineup.pdf');
});

test('the preview shows this same document, in a frame that runs no script', () => {
  const dialog = read('src/planner/PrintLineup.tsx');
  assert.match(dialog, /const html = useMemo\(\(\) => lineupDocument\(lineup, \{ layout, mode, lang, church, paper, colorMode \}\)/);
  assert.match(dialog, /const job: LineupPrintJob = useMemo\(\(\) => \(\{ lineup, layout, mode, lang, church, paper, colorMode \}\)/, 'Print and the PDFs get the same ink');
  assert.match(dialog, /readStored\(COLOR_KEY, colorModeOf, 'color'\)/, 'the ink is remembered, colour by default');
  assert.match(dialog, /srcDoc=\{html\}/);
  assert.match(dialog, /sandbox="allow-same-origin allow-modals"/);
  assert.doesNotMatch(dialog, /allow-scripts/);
  assert.ok(!fs.existsSync(new URL('../src/planner/print-lineup.css', import.meta.url)), 'the in-window @media print overlay is gone');
});

test('the @page rule locks in the paper, always portrait: A4, Letter or Legal, for 2 copies and for 1', () => {
  assert.deepEqual(PAPER_SIZES, ['A4', 'Letter', 'Legal']);
  assert.equal(paperSizeOf('letter'), 'Letter');
  assert.equal(paperSizeOf('B5'), 'A4');
  for (const paper of PAPER_SIZES) {
    for (const layout of ['double', 'single']) {
      const html = doc({ layout, paper });
      assert.match(html, new RegExp(`@page \\{ size: ${paper} portrait; margin: 0; \\}`));
      assert.doesNotMatch(html, /landscape/);
      assert.equal(pageSizeRule(layout, paper), `${paper} portrait`);
    }
    assert.match(doc({ paper }), new RegExp(`data-paper="${paper}"`));
  }
  assert.match(doc({ paper: 'Folio' }), /@page \{ size: A4 portrait;/, 'an unknown paper prints on A4');
});

test('the preview sheet has the paper\'s real portrait proportions for both layouts', () => {
  const sizes = { A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
  for (const [paper, size] of Object.entries(sizes)) {
    for (const layout of ['double', 'single']) {
      const sheet = sheetOf(layout, paper);
      assert.deepEqual([sheet.width, sheet.height], size, `${layout} on ${paper}`);
      assert.equal(sheet.landscape, false);
    }
  }
  assert.deepEqual(PAGE.double, sheetOf('double', 'A4'));
  assert.match(doc({ layout: 'single', paper: 'Legal' }), /width: 215\.9mm; min-height: 355\.6mm; padding: 12mm 14mm;/);
  assert.match(doc({ layout: 'double', paper: 'Letter' }), /width: 215\.9mm; min-height: 279\.4mm; padding: 10mm 8mm;/);
  const dialog = read('src/planner/PrintLineup.tsx');
  assert.match(dialog, /\{t\('printPortrait'\)\}/, 'the 2-copies button reads Portrait too');
  assert.doesNotMatch(dialog, /printLandscape/);
});

test('safe outer margins: the letterhead, the cut marks and the copy footers never touch the paper\'s edge', () => {
  assert.deepEqual(MARGINS, { double: { y: 10, x: 8 }, single: { y: 12, x: 14 } });
  for (const paper of PAPER_SIZES) {
    for (const layout of ['double', 'single']) {
      const html = doc({ paper, layout });
      const sheet = sheetOf(layout, paper);
      const { y, x } = MARGINS[layout];
      assert.ok(y >= 8 && x >= 8, 'every margin is clear of a printer\'s unprintable edge (3–5 mm)');
      // The @page margin is 0: on screen and on paper alike the sheet pads itself by the margins, and on paper fills the page's height.
      assert.match(html, new RegExp(`@page \\{ size: ${paper} portrait; margin: 0; \\}`));
      assert.match(html, new RegExp(`\\.sheet \\{[^}]*width: ${sheet.width}mm; min-height: ${sheet.height}mm; padding: ${y}mm ${x}mm;`));
      assert.match(html, new RegExp(`\\.sheet \\{ width: auto; min-height: ${sheet.fill + 2 * y}mm; -webkit-box-decoration-break: clone; box-decoration-break: clone; \\}`));
      assert.ok(sheet.fill + 2 * y < sheet.height, 'the sheet never runs onto a blank second page');
      // A lineup laid out again for a page-numbered PDF keeps the margins on every page through @page.
      const paged = lineupDocument(lineup, { paper, layout, paged: true });
      assert.match(paged, new RegExp(`@page \\{ size: ${paper} portrait; margin: ${y}mm ${x}mm; \\}`));
      assert.match(paged, new RegExp(`\\.sheet \\{ width: auto; padding: 0; min-height: ${sheet.fill}mm; \\}`));
    }
    // The cut marks sit on the inner edge of the margin (and the copies 4 mm further in), never at the paper's edge.
    const html = doc({ paper });
    assert.match(html, /\.cut-top \{ top: 10mm; \}/);
    assert.match(html, /\.cut-bottom \{ bottom: 10mm; \}/);
    assert.match(html, /\.sheet\[data-copies="2"\] \.copy \{ padding: 4mm 0; \}/);
  }
  // The footer is the last thing in each copy, inside the sheet (and so inside the margins).
  assert.match(doc(), /<footer class="foot"><span>Copy 2 of 2<\/span><\/footer><\/article><\/main>/);
});
