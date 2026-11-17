// The printed lineup as paper: one standalone HTML document, black ink on white, laid out like the on-screen Lineup (numbered rows with an
// icon box, section headings with their minutes, a song card's songs as indented sub-cards). The same document is shown in the Print Lineup
// preview (an <iframe srcdoc>), printed from a hidden window with the system Print dialog, and saved as a PDF (electron/print-lineup.js), so
// the preview, the paper and the PDF match. It carries no script, and every word in it is escaped. Pure: the tests run it under Node.
import { PAPER_MM, casePrintLineup, copiesFor, paperSizeOf, printLayoutOf, songKeyLabel } from './print-lineup.js';
import { PLANNER_LANGS, plannerT } from './planner-i18n.js';
import { textCaseOf } from './text-fit.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/**
 * The safe margins (mm), top/bottom and sides, all clear of a printer's unprintable edge (3–5 mm). The sheet pads itself by them (the @page
 * margin is 0), so the preview, the paper and the PDF place everything identically. Two copies share a portrait sheet with 8 mm outer sides
 * and a 16 mm gutter (8 mm either side of the dashed cut line), so cutting down the middle gives two identical slips, each with 8 mm left
 * and right.
 */
export const MARGINS = Object.freeze({ double: Object.freeze({ y: 10, x: 8 }), single: Object.freeze({ y: 12, x: 14 }) });

/** Half the gutter between two copies (mm): the room on each side of the cut line, equal to the outer side margin. */
export const HALF_GUTTER = MARGINS.double.x;

/**
 * The sheet of a layout on a paper. Every layout prints portrait: two copies side by side in two columns, or one copy across the width.
 * Width and height are the paper's (mm); `fill` is how tall the copies stand inside the margins, so each copy's footer sits near the foot.
 */
export function sheetOf(layout, paper) {
  const l = printLayoutOf(layout);
  const p = paperSizeOf(paper);
  const { width, height } = PAPER_MM[p];
  const { y, x } = MARGINS[l];
  return Object.freeze({ landscape: false, paper: p, width, height, marginY: y, marginX: x, fill: Math.floor(height - 2 * y - 2) });
}

/** The A4 sheet of each layout (the default paper). */
export const PAGE = Object.freeze({ double: sheetOf('double', 'A4'), single: sheetOf('single', 'A4') });

/** The CSS @page size and orientation, as in "A4 portrait" or "Legal portrait". */
export function pageSizeRule(layout, paper) {
  const sheet = sheetOf(layout, paper);
  return `${sheet.paper} ${sheet.landscape ? 'landscape' : 'portrait'}`;
}

// Monochrome line icons (24 × 24, stroked in black), after the Lineup's own: a cross for a prayer, a note for a song, an open book for a
// reading, a screen for slides.
const ICON_PATHS = {
  prayer: '<path d="M9.5 3h5v6.5H21v5h-6.5V21h-5v-6.5H3v-5h6.5z"/>',
  song: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  reading:
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  other: '<rect x="2" y="4" width="20" height="13" rx="1.5"/><path d="M12 17v4M8 21h8"/>',
};

/** One icon as inline SVG. */
export function iconSvg(kind) {
  const paths = ICON_PATHS[kind] ?? ICON_PATHS.other;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// The type sizes, in points, per layout and density. A song title is the largest word on a row: 9.5–11 pt in a two-copy column (about
// 89–92 mm wide), 11.5–13 pt across one copy. Smaller steps shrink the padding, the icons and the labels before the song titles.
export const SIZES = {
  double: {
    roomy: { h1: 15, title: 11, sub: 10, role: 7.5, num: 10, meta: 8, icon: 18, pad: 4, sec: 3.4 },
    normal: { h1: 14, title: 10.75, sub: 9.75, role: 7.25, num: 9.5, meta: 7.75, icon: 16, pad: 3, sec: 2.6 },
    compact: { h1: 13, title: 10.25, sub: 9.25, role: 7, num: 9, meta: 7.5, icon: 14, pad: 2, sec: 2 },
    dense: { h1: 12, title: 9.75, sub: 8.75, role: 6.75, num: 8.5, meta: 7.25, icon: 12, pad: 1.1, sec: 1.4 },
    tight: { h1: 11, title: 9.5, sub: 8.5, role: 6.5, num: 8, meta: 7, icon: 11, pad: 0.5, sec: 1 },
  },
  single: {
    roomy: { h1: 18, title: 13, sub: 12, role: 8.75, num: 12, meta: 9.5, icon: 22, pad: 5.2, sec: 4.2 },
    normal: { h1: 16.5, title: 12.5, sub: 11.5, role: 8.25, num: 11, meta: 9, icon: 20, pad: 4, sec: 3.2 },
    compact: { h1: 15, title: 12, sub: 11, role: 7.75, num: 10, meta: 8.5, icon: 17, pad: 2.5, sec: 2.2 },
    dense: { h1: 14, title: 11.75, sub: 10.5, role: 7.25, num: 9.5, meta: 8, icon: 14, pad: 1.5, sec: 1.4 },
    tight: { h1: 13, title: 11.5, sub: 10, role: 7, num: 9, meta: 7.5, icon: 12, pad: 0.8, sec: 1 },
  },
};

/** The strip (mm) above and below two copies that holds the "Cut here" marks. */
const CUT_STRIP = 4;
const PT_PER_MM = 72 / 25.4;
/** The width (mm) of one copy's text column: for two copies, half the room between the outer margins less half the gutter. */
export const copyWidth = (sheet, layout) =>
  layout === 'double' ? (sheet.width - 2 * sheet.marginX) / 2 - HALF_GUTTER : sheet.width - 2 * sheet.marginX;
/** The height (mm) of the "Copy 1 of 2" footer, under two copies. */
const FOOT = 6;

/** How many lines `text` wraps to in a column `widthPt` wide at `size` pt (bold, about 0.56 em a character). */
function linesOf(text, size, widthPt) {
  const chars = Math.max(1, Math.floor(widthPt / (size * 0.56)));
  return Math.max(1, Math.ceil(String(text ?? '').length / chars));
}

/** About how tall (pt) one copy of the lineup stands at the sizes `s`, wrapping long titles. */
function estimateHeight(lineup, layout, s, sheet) {
  const column = copyWidth(sheet, layout) * PT_PER_MM;
  // The text beside the number, the icon box and the minutes or key.
  const text = column - (1.55 * s.num + s.icon + 2 * 2.4 * PT_PER_MM + 46);
  const subText = text - (s.icon / 2 + 2.6 * PT_PER_MM + s.icon * 0.6 + 8 * PT_PER_MM);
  const role = s.role * 1.25;
  let h = (s.meta + 0.5) * 1.3 + 4 + linesOf(lineup.title, s.h1, column) * s.h1 * 1.12 + (s.meta * 1.25 + 3) + 24;
  if (lineup.sections.length === 0) h += s.sub * 1.3;
  for (const section of lineup.sections) {
    h += s.sec * PT_PER_MM + (s.role + 0.5) * 1.25 + 5;
    for (const entry of section.entries) {
      const items = entry.items;
      let row;
      if (items.length === 0) row = entry.writeIn ? (entry.name ? role : 0) + s.title * 1.2 : Math.max(s.sub * 1.17, s.icon);
      else if (items.length === 1) {
        const size = items[0].kind === 'song' ? s.title : s.sub;
        const named = entry.name && !same(entry.name, items[0].title);
        row = Math.max((named ? role : 0) + linesOf(items[0].title, size, text) * size * 1.17, s.icon, items[0].key ? 24 : 0);
      } else {
        row = linesOf(entry.name, s.role, text) * role + role + 4.5;
        for (const item of items) row += Math.max(linesOf(item.title, s.sub, subText) * s.sub * 1.17, s.icon * 0.6) + 2 * Math.max(1, s.pad * 0.6) + 2 + 2.6;
      }
      h += row + 2 * s.pad + 1;
    }
  }
  return h;
}

/** Each density, roomiest first. */
export const DENSITIES = ['roomy', 'normal', 'compact', 'dense', 'tight'];

/**
 * The type size the lineup prints at: the roomiest that fits one sheet, judged from the height of its rows at each size (long titles wrap),
 * with a little to spare. A short lineup prints roomy (larger type, more air) so a copy fills its column instead of leaving a void above
 * its footer. The estimate runs high for a short two-copy column, so there roomy is allowed 10% over; one tall copy is held a little under.
 * Both checked with printToPDF in Electron 33 on A4, Letter and Legal, 6–24 cards, with long wrapping titles and multi-song cards: no
 * roomy sheet ran onto a second page. A lineup too long even at the tightest prints tight over more pages. The preview, the paper and the
 * PDF agree.
 */
const ROOMY_ALLOWANCE = { double: 1.1, single: 0.96 };

export function fitDensity(lineup, layout, paper = 'A4') {
  const l = printLayoutOf(layout);
  const sheet = sheetOf(l, paper);
  const room = (sheet.fill - (copiesFor(l) > 1 ? 2 * CUT_STRIP + FOOT : 0)) * PT_PER_MM * 0.98;
  return DENSITIES.find((d) => estimateHeight(lineup, l, SIZES[l][d], sheet) <= room * (d === 'roomy' ? ROOMY_ALLOWANCE[l] : 1)) ?? 'tight';
}

function styles(layout, density, mode, paper, paged) {
  const page = sheetOf(layout, paper);
  const s = SIZES[layout][density];
  // Labels (part headings, slot names, the badge) are small capitals, unless the operator asked for lowercase.
  const labelCase = mode === 'lowercase' ? 'none' : 'uppercase';
  // One sheet: the @page margin is 0 and the sheet pads itself, exactly as on screen. A lineup that runs onto more pages is laid out again
  // `paged`: the margins move into @page, so every page keeps them and the PDF's page-number footer has room in the bottom one.
  const pageRule = paged
    ? `@page { size: ${pageSizeRule(layout, paper)}; margin: ${page.marginY}mm ${page.marginX}mm; }`
    : `@page { size: ${pageSizeRule(layout, paper)}; margin: 0; }`;
  const printSheet = paged
    ? `.sheet { width: auto; padding: 0; min-height: ${page.fill}mm; }\n  .cut-top { top: 0; } .cut-bottom { bottom: 0; } .sheet[data-copies="2"]::before { top: 0; bottom: 0; }`
    : `.sheet { width: auto; min-height: ${page.fill + 2 * page.marginY}mm; -webkit-box-decoration-break: clone; box-decoration-break: clone; }`;
  return `
${pageRule}
:root { color-scheme: light; --ink: #000000; --ink-2: #111827; --muted: #4b5563; --label: #374151; --rule: #9ca3af; --hair: #d1d5db; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; color: var(--ink); }
body {
  font-family: 'Segoe UI', 'Inter', 'Helvetica Neue', Arial, sans-serif;
  font-size: ${s.sub}pt; line-height: 1.22;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  -webkit-font-smoothing: antialiased;
}
.sheet {
  position: relative; display: grid; align-items: stretch; background: #ffffff;
  width: ${page.width}mm; min-height: ${page.height}mm; padding: ${page.marginY}mm ${page.marginX}mm;
}
.sheet[data-copies="2"] { grid-template-columns: 1fr 1fr; }
.sheet[data-copies="1"] { grid-template-columns: 1fr; }
@media print {
  /* The sheet fills the page, so each copy's footer sits at the foot of it. */
  ${printSheet}
}
.copy { min-width: 0; display: flex; flex-direction: column; }
/* Two copies leave a strip above and below for the "Cut here" marks, and ${HALF_GUTTER} mm either side of the cut line: the same as the
   outer margins, so both cut slips have equal left and right margins. */
.sheet[data-copies="2"] .copy { padding: ${CUT_STRIP}mm 0; }
.sheet[data-copies="2"] .copy:first-of-type { padding-right: ${HALF_GUTTER}mm; }
.sheet[data-copies="2"] .copy + .copy { padding-left: ${HALF_GUTTER}mm; }
/* The cut line is drawn over the exact middle of the sheet, not as a border on one copy, so both copies are the same width and wrap alike. */
.sheet[data-copies="2"]::before {
  content: ''; position: absolute; left: 50%; top: ${page.marginY}mm; bottom: ${page.marginY}mm; border-left: 1px dashed var(--rule);
}
.cut {
  position: absolute; left: 50%; transform: translateX(-50%); z-index: 1;
  background: #ffffff; padding: 0 1.5mm; font-size: 6.5pt; letter-spacing: 0.06em; color: var(--muted); white-space: nowrap;
}
.cut-top { top: ${page.marginY}mm; }
.cut-bottom { bottom: ${page.marginY}mm; }

.head { border-bottom: 1.5pt solid var(--ink); padding-bottom: 2.2mm; margin-bottom: 1.5mm; }
.letter { display: flex; align-items: center; justify-content: space-between; gap: 3mm; margin-bottom: 1.4mm; }
.parish { font-size: ${s.meta + 0.5}pt; font-weight: 700; letter-spacing: 0.05em; color: var(--ink-2); text-transform: ${labelCase}; min-width: 0; }
.badge {
  flex: none; margin-left: auto; border: 1px solid var(--ink); border-radius: 3px; padding: 0.6pt 4pt;
  font-size: ${Math.max(6, s.meta - 1.25)}pt; font-weight: 800; letter-spacing: 0.1em; text-transform: ${labelCase};
}
h1 { margin: 0; font-size: ${s.h1}pt; font-weight: 800; line-height: 1.12; color: var(--ink); overflow-wrap: anywhere; }
.meta { margin: 1mm 0 0; font-size: ${s.meta}pt; color: var(--muted); }
.meta .total { font-weight: 700; color: var(--ink-2); }
.empty { color: var(--muted); font-style: italic; }

.section { margin-top: ${s.sec}mm; }
.section-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 3mm;
  border-bottom: 1px solid var(--rule); padding-bottom: 0.8mm; margin-bottom: 0.6mm;
  break-after: avoid; page-break-after: avoid;
}
h2 { margin: 0; font-size: ${s.role + 0.5}pt; font-weight: 800; letter-spacing: 0.11em; color: var(--ink-2); text-transform: ${labelCase}; }
.mono { font-family: 'Cascadia Mono', Consolas, 'Courier New', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.section-head .mono { font-size: ${s.meta}pt; color: var(--muted); white-space: nowrap; }
ol { list-style: none; margin: 0; padding: 0; }

.row {
  display: grid; grid-template-columns: 1.55em ${s.icon}pt minmax(0, 1fr) auto; column-gap: 2.4mm; align-items: center;
  padding: ${s.pad}pt 0; border-bottom: 1px solid var(--hair);
  break-inside: avoid; page-break-inside: avoid;
}
.row:last-child { border-bottom: none; }
.num { font-size: ${s.num}pt; font-weight: 700; color: var(--ink-2); text-align: right; }
.icon {
  width: ${s.icon}pt; height: ${s.icon}pt; border: 1px solid #374151; border-radius: 4px;
  display: grid; place-items: center; background: #ffffff;
}
.icon svg { width: 62%; height: 62%; }
.body { min-width: 0; display: flex; flex-direction: column; }
/* Songs are solid bold black, the largest words on a row; slot names and title-only cards are normal weight, so a slot's name never
   reads as a song. */
.title, .song {
  font-weight: 800; color: #000000; overflow-wrap: anywhere; line-height: 1.15;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.title { font-size: ${s.title}pt; }
.song { font-size: ${s.sub}pt; }
.role { font-size: ${s.role}pt; font-weight: 400; letter-spacing: 0.06em; color: var(--label); text-transform: ${labelCase}; overflow-wrap: anywhere; }
.text { font-size: ${s.sub}pt; font-weight: 400; color: var(--ink-2); overflow-wrap: anywhere; line-height: 1.15; }
.under { font-size: ${s.role}pt; font-weight: 400; color: var(--label); overflow-wrap: anywhere; }
.count { font-size: ${s.role}pt; color: var(--muted); }
.writein { display: block; height: ${s.title * 1.2}pt; border-bottom: 1px solid var(--ink); margin-right: 2mm; }
.aside { display: flex; flex-direction: column; align-items: flex-end; gap: 0.6mm; }
.min { font-size: ${s.role}pt; color: var(--muted); white-space: nowrap; }
.key {
  border: 1px solid var(--ink-2); border-radius: 4px; padding: 0.6pt 4.5pt; white-space: nowrap;
  font-size: ${Math.max(6.5, Math.min(8.5, s.sub - 2))}pt; font-weight: 700; color: var(--ink); text-transform: none;
}
.key small { font-size: 0.82em; font-weight: 600; color: var(--muted); margin-right: 1.5pt; }

.subs {
  grid-column: 2 / -1; margin: 1mm 0 0.6mm ${s.icon / 2}pt; padding-left: 2.6mm;
  border-left: 1.5px solid var(--rule); display: flex; flex-direction: column; gap: 0.9mm;
}
.subcard {
  display: grid; grid-template-columns: 1em ${Math.round(s.icon * 0.6)}pt minmax(0, 1fr) auto; column-gap: 1.6mm; align-items: center;
  border: 1px solid var(--hair); border-radius: 4px; padding: ${Math.max(1, s.pad * 0.6)}pt 2mm;
  break-inside: avoid; page-break-inside: avoid;
}
.subcard .n { font-size: ${s.role + 0.5}pt; font-weight: 700; color: var(--muted); text-align: right; }
.subcard svg { width: ${Math.round(s.icon * 0.6)}pt; height: ${Math.round(s.icon * 0.6)}pt; }

.foot {
  margin-top: auto; padding-top: 2.5mm; display: flex; justify-content: space-between; gap: 3mm;
  font-size: ${Math.max(6, s.meta - 1)}pt; color: var(--muted);
}
`;
}

/** The key pill, only when a key was set; its case is kept as written (Bb, F#m). */
function keyPill(key, label) {
  const k = songKeyLabel(key);
  return k ? `<span class="key" data-song-key><small>${esc(label)}</small>${esc(k)}</span>` : '';
}

const same = (a, b) => String(a ?? '').trim().toLocaleLowerCase() === String(b ?? '').trim().toLocaleLowerCase();

function rowHtml(entry, t) {
  const num = `<span class="num mono">${esc(entry.number)}</span>`;
  const icon = `<span class="icon">${iconSvg(entry.kind)}</span>`;
  const minutes = entry.minutes ? `<span class="min mono">${esc(t('printMinutes', { n: entry.minutes }))}</span>` : '';
  const items = entry.items;

  if (items.length === 0 && !entry.writeIn) {
    // A card that is complete with nothing in it (a title slide): its name alone.
    return `<li class="row" data-kind="${esc(entry.kind)}">${num}${icon}<div class="body"><span class="text">${esc(entry.name)}</span></div><span class="aside">${minutes}</span></li>`;
  }

  if (items.length === 0) {
    // Nothing chosen yet: the slot's name and a line to write a song or prayer on by hand.
    const body = `<div class="body">${entry.name ? `<span class="role">${esc(entry.name)}</span>` : ''}<span class="writein" data-write-in></span></div>`;
    return `<li class="row" data-kind="${esc(entry.kind)}" data-empty>${num}${icon}${body}<span class="aside">${minutes}</span></li>`;
  }

  if (items.length === 1) {
    const [item] = items;
    const role = entry.name && !same(entry.name, item.title) ? entry.name : '';
    let body;
    if (item.kind === 'song') {
      // The song title is the largest word on the row; the slot's role sits above it.
      body = `${role ? `<span class="role">${esc(role)}</span>` : ''}<span class="title">${esc(item.title)}</span>`;
    } else {
      // A prayer's title or a reading's reference, with the slot's role under it.
      body = `<span class="text">${esc(item.title)}</span>${role ? `<span class="under">${esc(role)}</span>` : ''}`;
    }
    const aside = `<span class="aside">${keyPill(item.key, t('printKey'))}${minutes}</span>`;
    return `<li class="row" data-kind="${esc(item.kind)}">${num}<span class="icon">${iconSvg(item.kind)}</span><div class="body">${body}</div>${aside}</li>`;
  }

  // Several items on one card: the card's name and count, then each item as an indented sub-card in play order.
  // The card's name is a slot label (normal weight); each song under it is bold black, a prayer or reading normal weight.
  const head = `<div class="body"><span class="role segment">${esc(entry.name)}</span><span class="count">${esc(t('printItems', { n: items.length }))}</span></div>`;
  const subs = items
    .map(
      (item, i) =>
        `<li class="subcard" data-kind="${esc(item.kind)}"><span class="n mono">${i + 1}</span>${iconSvg(item.kind)}<span class="${item.kind === 'song' ? 'song' : 'text'}">${esc(item.title)}</span>${keyPill(item.key, t('printKey'))}</li>`,
    )
    .join('');
  return `<li class="row" data-kind="${esc(entry.kind)}" data-chained>${num}${icon}${head}<span class="aside">${minutes}</span><ol class="subs">${subs}</ol></li>`;
}

function copyHtml(lineup, { t, church, index, copies }) {
  const badge = t(lineup.type === 'pw' ? 'printBadgePw' : 'printBadgeMass');
  const meta = [lineup.subtitle ? esc(lineup.subtitle) : '', lineup.minutes ? `<span class="total">${esc(t('printTotal', { n: lineup.minutes }))}</span>` : '']
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');
  const head = `<header class="head"><div class="letter">${church ? `<span class="parish">${esc(church)}</span>` : ''}<span class="badge">${esc(badge)}</span></div><h1>${esc(lineup.title)}</h1>${meta ? `<p class="meta">${meta}</p>` : ''}</header>`;
  const body =
    lineup.sections.length === 0
      ? `<p class="empty">${esc(t('printEmpty'))}</p>`
      : lineup.sections
          .map(
            (section) =>
              `<section class="section">${section.heading || section.minutes ? `<div class="section-head"><h2>${esc(section.heading)}</h2>${section.minutes ? `<span class="mono">${esc(t('printMinutes', { n: section.minutes }))}</span>` : ''}</div>` : ''}<ol>${section.entries.map((e) => rowHtml(e, t)).join('')}</ol></section>`,
          )
          .join('');
  const foot = copies > 1 ? `<footer class="foot"><span>${esc(t('printCopyOf', { n: index + 1, total: copies }))}</span></footer>` : '';
  return `<article class="copy" data-copy="${index + 1}">${head}${body}${foot}</article>`;
}

/**
 * The lineup as a complete HTML document. `lineup` comes from massPrintLineup or pwPrintLineup (in its original case); `mode` is the
 * Planner's text case; `lang` names the labels; `church` is the parish name for the letterhead (blank leaves it out); `paper` is A4,
 * Letter or Legal, locked in by the @page rule (always portrait). `paged` lays out a lineup that runs past one page with its margins in
 * @page instead (see styles), for the PDF with page numbers.
 */
export function lineupDocument(lineup, { layout = 'double', mode = 'original', lang = 'en', church = '', paper = 'A4', paged = false } = {}) {
  const size = paperSizeOf(paper);
  const l = printLayoutOf(layout);
  const m = textCaseOf(mode);
  const language = PLANNER_LANGS.includes(lang) ? lang : 'en';
  const t = (key, vars) => plannerT(language, key, vars);
  const shown = casePrintLineup(lineup, m);
  const copies = copiesFor(l);
  const density = fitDensity(lineup, l, size);
  const sheet = Array.from({ length: copies }, (_, index) => copyHtml(shown, { t, church: String(church ?? '').trim(), index, copies })).join('');
  const cut = copies > 1 ? `<span class="cut cut-top">✂ ${esc(t('printCutHere'))}</span><span class="cut cut-bottom">✂ ${esc(t('printCutHere'))}</span>` : '';
  return `<!doctype html>
<html lang="${language === 'ceb' ? 'ceb' : language}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(lineup.title || t('printLineup'))}</title>
<style>${styles(l, density, m, size, paged === true)}</style>
</head>
<body class="density-${density}">
<main class="sheet" data-layout="${l}" data-paper="${size}" data-copies="${copies}">${cut}${sheet}</main>
</body>
</html>`;
}

// ── A print job sent from the window ─────────────────────────────────────────────────────────────────────────────────────────────────

const KINDS = new Set(['song', 'prayer', 'reading', 'other']);
const str = (v, max = 300) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const mins = (v) => (Number.isFinite(v) && v > 0 && v < 100000 ? Math.round(v) : null);
const kindOf = (v) => (KINDS.has(v) ? v : 'other');

/**
 * A print request from the window, checked and trimmed before the main process lays it out: a lineup of known shape and bounded size,
 * a known layout, text case and language, and a parish name. Throws when there is no lineup at all.
 */
export function checkPrintJob(input) {
  const raw = input?.lineup;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections)) throw new Error('There is no lineup to print.');
  const lineup = {
    type: raw.type === 'pw' ? 'pw' : 'mass',
    title: str(raw.title),
    subtitle: str(raw.subtitle),
    minutes: mins(raw.minutes),
    sections: raw.sections.slice(0, 100).map((section) => ({
      heading: str(section?.heading),
      minutes: mins(section?.minutes),
      entries: (Array.isArray(section?.entries) ? section.entries : []).slice(0, 300).map((entry) => ({
        number: str(entry?.number, 8),
        name: str(entry?.name),
        kind: kindOf(entry?.kind),
        minutes: mins(entry?.minutes),
        writeIn: entry?.writeIn === true,
        items: (Array.isArray(entry?.items) ? entry.items : []).slice(0, 60).map((item) => ({
          kind: kindOf(item?.kind),
          title: str(item?.title),
          key: item?.kind === 'song' ? songKeyLabel(str(item?.key, 12)) : null,
        })),
      })),
    })),
  };
  const layout = printLayoutOf(input.layout);
  const paper = paperSizeOf(input.paper);
  return {
    lineup,
    layout,
    mode: textCaseOf(input.mode),
    lang: PLANNER_LANGS.includes(input.lang) ? input.lang : 'en',
    church: str(input.church, 120).trim(),
    paper,
    /** Electron's print / printToPDF pageSize: the same paper the @page rule names. */
    pageSize: paper,
    /** Every layout prints portrait, on every paper. */
    landscape: false,
  };
}

/** The file name a saved PDF is offered under: "<Service-Title>-Lineup.pdf", safe on Windows. */
export function pdfFileName(title) {
  const base = String(title ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80);
  return base ? `${base}-Lineup.pdf` : 'Lineup.pdf';
}
