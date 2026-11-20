// The Print Lineup studio (src/planner/PrintLineup.tsx) and the Media Studio (src/media/MediaStudioModal.tsx) over the frameless window's
// drag region. Chromium hit-tests -webkit-app-region rectangles at window level, ignoring z-index, so the top bar's drag region (which
// grows past the caption strip when it wraps) swallowed the studio toolbar's hover and clicks on Windows. Only an explicit no-drag cancels
// it. The repo has no DOM test environment, so, like the other UI suites here, these check the components' source.
// Synthetic strings only: no real song titles or lyrics. Run with: node --test shared/print-lineup-dialog.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TITLE_BAR_HEIGHT } from './title-bar.js';
import { lineupDocument } from './print-lineup-html.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8').split(String.fromCharCode(13)).join('');
const PRINT = read('src/planner/PrintLineup.tsx');
const STUDIO = read('src/media/MediaStudioModal.tsx');
const REGION = read('src/components/appRegion.ts');
const CSS = read('src/styles.css');

/** The JSX of the first element carrying a data attribute, from its `<` to its own closing `>`. */
function tagWith(source, attr) {
  const at = source.indexOf(attr);
  assert.ok(at > 0, `${attr} is in the source`);
  // The tag starts at the nearest `<` that opens an element (`<button`, `<div`), not a `<` / `<=` inside a prop.
  let start = at;
  while (start > 0 && !(source[start] === '<' && /[A-Za-z]/.test(source[start + 1]))) start -= 1;
  // The tag ends at the first `>` outside a {…} expression (so `() =>` and `a > b` inside props do not end it).
  let depth = 0;
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`the tag carrying ${attr} is closed`);
}

/** The value of a top-level `const NAME =` class string. */
const classConst = (name) => PRINT.match(new RegExp(`const ${name} =\\s*\\n?\\s*[\`']([^\`']*)`))?.[1] ?? '';

test('the shared helper says no-drag / drag, and the clearance is the caption strip height', () => {
  assert.match(REGION, /export const NO_DRAG = \{ WebkitAppRegion: 'no-drag' \}/);
  assert.match(REGION, /export const DRAG = \{ WebkitAppRegion: 'drag' \}/);
  const clearance = Number(REGION.match(/export const TITLE_BAR_CLEARANCE = (\d+);/)?.[1]);
  assert.equal(clearance, TITLE_BAR_HEIGHT, 'the studios start exactly below the titleBarOverlay strip');
  assert.doesNotMatch(PRINT, /const TITLE_BAR_CLEARANCE = /, 'Print Lineup uses the shared clearance');
  assert.doesNotMatch(STUDIO, /const TITLE_BAR_CLEARANCE = /, 'Media Studio uses the shared clearance');
});

test('styles.css defines the no-drag / app-drag classes and makes every modal box and its controls no-drag', () => {
  assert.match(CSS, /@utility no-drag \{\s*-webkit-app-region: no-drag;\s*\}/);
  assert.match(CSS, /@utility app-drag \{\s*-webkit-app-region: drag;\s*\}/);
  const rule = CSS.match(/\[aria-modal="true"\],\s*\[aria-modal="true"\] :is\(([^)]*)\)\s*\{\s*-webkit-app-region: no-drag;/);
  assert.ok(rule, 'the [aria-modal] no-drag rule');
  for (const control of ['button', 'input', 'select', '[role="radio"]']) assert.ok(rule[1].includes(control), `${control} inside a modal is no-drag`);
});

test('Print Lineup: the dialog sits below the caption strip, above the top bar, and is no-drag', () => {
  const backdrop = tagWith(PRINT, 'data-print-lineup-backdrop');
  assert.match(backdrop, /fixed inset-0 z-\[200\]/, 'stacked above the top bar (z-20) and its popovers');
  const dialog = tagWith(PRINT, 'data-print-lineup-dialog');
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /className="no-drag pointer-events-auto /);
  assert.match(dialog, /style=\{\{ top: TITLE_BAR_CLEARANCE, \.\.\.NO_DRAG \}\}/);
  assert.doesNotMatch(dialog, /app-drag|\.\.\.DRAG\b|region:drag/);
});

test('Print Lineup: only the caption strip above the dialog is a window handle, and it ends where the dialog begins', () => {
  const caption = tagWith(PRINT, 'data-print-lineup-caption');
  assert.match(caption, /aria-hidden/);
  assert.match(caption, /className="app-drag absolute inset-x-0 top-0"/);
  assert.match(caption, /style=\{\{ height: TITLE_BAR_CLEARANCE, \.\.\.DRAG \}\}/);
  assert.equal((PRINT.match(/\.\.\.DRAG\b|app-drag/g) ?? []).length, 2, 'no other drag region in the studio');
  // The caption strip comes before the dialog in the document, so the dialog's no-drag wins wherever the two could touch.
  assert.ok(PRINT.indexOf('data-print-lineup-caption') < PRINT.indexOf('data-print-lineup-dialog'));
});

test('Print Lineup: the toolbar and every control class are no-drag and take pointer events', () => {
  const toolbar = tagWith(PRINT, 'data-print-toolbar');
  assert.match(toolbar, /className="no-drag pointer-events-auto relative z-10 /);
  assert.match(toolbar, /style=\{NO_DRAG\}/);
  for (const name of ['TOOL', 'SEGMENTS', 'ZOOM_BUTTON']) assert.match(classConst(name), /^no-drag /, `${name} buttons are no-drag`);
  assert.match(PRINT, /const segment = \(on: boolean\) =>\s*`no-drag /, 'the segmented choices are no-drag');
  assert.match(tagWith(PRINT, 'data-zoom-level'), /className="no-drag /, 'the zoom percentage is no-drag');
  assert.doesNotMatch(PRINT, /pointer-events-none/, 'nothing in the studio turns its pointer events off');
});

test('Print Lineup: every toolbar control is a no-drag button wired to its handler', () => {
  const button = (attr) => tagWith(PRINT, attr);
  // Close, Print, Save PDF, Open PDF.
  assert.match(button('data-print-close'), /onClick=\{onClose\}/);
  assert.match(button('data-print-close'), /className=\{`\$\{TOOL\} /);
  assert.match(button('data-print-now'), /onClick=\{\(\) => void run\('print'\)\}/);
  assert.match(button('data-save-pdf'), /onClick=\{\(\) => void run\('pdf'\)\}/);
  assert.match(button('data-open-pdf'), /onClick=\{\(\) => void run\('open'\)\}/);
  for (const attr of ['data-print-now', 'data-save-pdf', 'data-open-pdf']) assert.match(button(attr), /className=\{`\$\{TOOL\} /, `${attr} is no-drag`);
  // Color / B&W, copies, paper size.
  assert.match(button('data-color-mode-option'), /onClick=\{\(\) => pickColorMode\(id\)\}/);
  assert.match(button('data-color-mode-option'), /className=\{segment\(colorMode === id\)\}/);
  assert.match(button('data-layout={id}'), /onClick=\{\(\) => pickLayout\(id\)\}/);
  assert.match(button('data-paper={id}'), /onClick=\{\(\) => pickPaper\(id\)\}/);
  // Fit, −, +, and the percentage that resets to 100%.
  assert.match(PRINT, /onClick=\{\(\) => setZoom\('fit'\)\} title=\{t\('printFitHint'\)\} className=\{`\$\{segment\(zoom === 'fit'\)\} /);
  const zoomOut = button("aria-label={t('printZoomOut')}");
  assert.match(zoomOut, /onClick=\{zoomOut\}/);
  assert.match(zoomOut, /className=\{`\$\{ZOOM_BUTTON\} /);
  const zoomIn = button("aria-label={t('printZoomIn')}");
  assert.match(zoomIn, /onClick=\{zoomIn\}/);
  assert.match(zoomIn, /className=\{ZOOM_BUTTON\}/);
  assert.match(button('data-zoom-level'), /onClick=\{\(\) => setZoom\(1\)\}/);
  // Aa / AA / aa: the shared switch, inside the no-drag dialog (and its buttons are no-drag via the [aria-modal] rule).
  assert.match(PRINT, /<TextCaseSwitch\s+size="md"\s+value=\{mode\}\s+onChange=\{setMode\}/);
  // None of them declares a drag region of its own.
  for (const attr of ['data-print-close', 'data-print-now', 'data-save-pdf', 'data-open-pdf', 'data-color-mode-option', 'data-zoom-level']) {
    assert.doesNotMatch(button(attr), /app-drag|DRAG\b|region:drag/, `${attr} is never a drag handle`);
  }
});

test('Print Lineup: Escape closes the studio and Ctrl+P prints', () => {
  const keys = PRINT.slice(PRINT.indexOf('const onKey = (e: KeyboardEvent)'), PRINT.indexOf("window.addEventListener('keydown', onKey, true)"));
  assert.match(keys, /if \(e\.key === 'Escape'\) \{\s*e\.preventDefault\(\);\s*onClose\(\);/);
  assert.match(keys, /e\.key\.toLowerCase\(\) === 'p'[\s\S]*void run\('print'\)/);
  assert.match(PRINT, /return \(\) => window\.removeEventListener\('keydown', onKey, true\);/, 'the key listener goes with the studio');
});

test('Media Studio: starts below the caption strip, no-drag dialog and header, Escape closes', () => {
  const dialog = STUDIO.slice(STUDIO.indexOf('data-media-studio-backdrop'), STUDIO.indexOf('data-media-studio\n'));
  assert.match(dialog, /className="no-drag absolute inset-x-0 bottom-0 /);
  assert.match(dialog, /style=\{\{ top: TITLE_BAR_CLEARANCE, \.\.\.NO_DRAG \}\}/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(tagWith(STUDIO, 'data-media-studio-caption'), /className="app-drag absolute inset-x-0 top-0" style=\{\{ height: TITLE_BAR_CLEARANCE, \.\.\.DRAG \}\}/);
  assert.match(STUDIO, /<header className="no-drag flex h-13 /);
  assert.match(STUDIO, /\} else if \(e\.key === 'Escape'\) \{\s*e\.preventDefault\(\);\s*requestClose\(\);/);
});

test('the studio paper still renders from synthetic data, in black and white', () => {
  const lineup = { type: 'mass', title: 'Sample Section', subtitle: '', minutes: null, sections: [] };
  const html = lineupDocument(lineup, { layout: 'double', mode: 'original', lang: 'en', church: 'Sample Parish', paper: 'A4', colorMode: 'bw' });
  assert.match(html, /Sample Parish/);
  assert.match(html, /Sample Section/);
});
