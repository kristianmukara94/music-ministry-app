// Booth-laptop layout fit: the top bar stays one 48px row from 1280px up, every sidebar link stays visible on a 768px-tall screen,
// the Service Console's four tiers fit a 1366x768 window, and the Action Center titles share one line. These are source-level checks;
// the pixel budget behind them was measured in the running app at 1280x720, 1366x768, 1440x820 and 1920x1080.
// Run with: node --test shared/operator-layout-fit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** The body of a top-level function, from its declaration to the next top-level closing brace. */
const body = (src, decl) => {
  const start = src.indexOf(decl);
  assert.ok(start >= 0, `${decl} exists`);
  return src.slice(start, src.indexOf('\n}\n', start));
};

test('short: is a height variant for 900px-or-shorter windows', () => {
  assert.match(read('src/styles.css'), /@custom-variant short \(@media \(max-height: 900px\)\);/);
});

// ── Top bar ────────────────────────────────────────────────────────────────

test('the top bar is one 48px flex-nowrap row and never measures itself into a second row', () => {
  const bar = read('src/operator/TopBar.tsx');
  const top = body(bar, 'export function TopBar()');
  assert.match(top, /<header className=\{`[^`]*\bh-12\b[^`]*\bflex-nowrap\b[^`]*`\}>/, 'a fixed 48px header that does not wrap');
  assert.doesNotMatch(bar, /\bflex-wrap\b/, 'no part of the bar wraps');
  assert.doesNotMatch(bar, /min-h-12|gap-y-/, 'no growing height or row gap');
  assert.doesNotMatch(bar, /\bstacked\b|ResizeObserver|useLayoutEffect/, 'the old two-row measuring is gone');
  // Narrower than 1280px the controls scroll sideways inside the bar rather than wrapping.
  assert.match(top, /flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto/);
  // Tighter chrome: no button keeps the old px-3 / px-3.5 padding.
  assert.doesNotMatch(bar, /\bpx-3(\.5)?\b/);
  assert.match(bar, /const CHROME = 'rounded-md border border-line-strong bg-panel-2 px-2\.5 py-1\.5/);
});

test('every state-changing control keeps its widest-label width lock', () => {
  const bar = read('src/operator/TopBar.tsx');
  for (const fn of ['function WelcomeControl()', 'export function GoLiveShortcut()', 'function LowerThirdControl()']) {
    assert.ok(body(bar, fn).split('<StableSlot ghosts={ghosts}>').length - 1 >= 2, `${fn} renders every state in its slot`);
  }
  assert.equal(body(bar, 'export function TopBar()').split('<StableSlot').length - 1, 3, 'Blackout, Pause Projector and Announcements');
  // A ghost carries the same compact label as the control it holds, so the lock follows the breakpoint.
  assert.match(bar, /<ControlButton key="run" icon=\{Pause\} label=\{t\('top\.pauseProjector'\)\} compact=\{t\('top\.pauseShort'\)\}/);
  assert.match(bar, /<ControlButton key="paused" icon=\{Play\} label=\{t\('top\.projectorPaused'\)\} compact=\{t\('top\.pausedShort'\)\}/);
  assert.match(bar, /<ControlButton key="off" icon=\{WelcomeIcon\} label=\{t\('top\.welcome'\)\} compact=\{t\('top\.welcomeShort'\)\}/);
  // The Remote and Projector pills hold LIVE and OFF in one cell.
  const pill = body(bar, 'function MasterSwitch(');
  assert.match(pill, /<span style=\{CELL\}>\{state\}<\/span>\s*<span style=\{CELL\} className="invisible" aria-hidden>/);
});

test('compact labels show below 1800px and the full label, still the accessible name, from 1800px up', () => {
  const bar = read('src/operator/TopBar.tsx');
  const label = body(bar, 'function Label(');
  assert.match(label, /<span className="hidden min-\[1800px\]:inline">\{full\}<\/span>/);
  assert.match(label, /<span className="min-\[1800px\]:hidden">\{compact\}<\/span>/);
  assert.match(body(bar, 'function ControlButton('), /aria-label=\{compact === undefined \? undefined : label\}/);
  assert.match(body(bar, 'function BackToMainButton('), /compact=\{t\('top\.backToMainLiveShort'\)\}/);
  const strings = read('src/i18n/strings.ts');
  assert.match(strings, /'top\.welcomeShort': 'Welcome',/);
  assert.match(strings, /'top\.backToMainLiveShort': 'Main Live',/);
  assert.doesNotMatch(strings, /'top\.welcomeNextShort'/, 'the unused compact stepper label is gone');
  // The Projector: skipped chip folds into one round button below 1920px, so the bar stays one row while it shows.
  assert.match(bar, /data-testid="projector-skipped-compact"/);
  assert.match(bar, /min-\[1920px\]:hidden/);
});

test('every top-bar button opts out of the window drag area, and only the header itself drags', () => {
  const bar = read('src/operator/TopBar.tsx');
  assert.equal(bar.split('${DRAG}').length - 1, 1, 'DRAG is applied once, on the header');
  // Capsule halves inherit no-drag from their capsule; every other button carries it on its own class.
  const capsules = [body(bar, 'function WelcomeCapsule('), body(bar, 'function LowerThirdCapsule(')];
  for (const capsule of capsules) assert.match(capsule, /className=\{`\$\{NO_DRAG\} flex h-9 shrink-0/);
  const outside = capsules.reduce((src, capsule) => src.replace(capsule, ''), bar);
  const buttons = outside.split('<button').slice(1).map((b) => b.slice(0, b.indexOf('>\n')));
  assert.ok(buttons.length >= 4);
  for (const b of buttons) assert.match(b, /\$\{NO_DRAG\}/, `no-drag on: <button${b.slice(0, 80)}`);
});

// ── Sidebar ────────────────────────────────────────────────────────────────

test('the sidebar is a full-height column whose navigation alone scrolls, and no link ends in a mid-word ellipsis', () => {
  const side = read('src/operator/Sidebar.tsx');
  assert.match(side, /className=\{`flex h-full min-h-0 shrink-0 flex-col/);
  assert.match(side, /<nav aria-label="Modules" className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">/);
  // Labels wrap onto a second compact line (Announcements & Whiteboard) instead of truncating.
  const labels = side.match(/<span data-testid="nav-label" className="[^"]*"/g) ?? [];
  assert.equal(labels.length, 2);
  for (const l of labels) {
    assert.match(l, /line-clamp-2/);
    assert.doesNotMatch(l, /\btruncate\b/);
  }
  // Every group still lists its links.
  for (const group of ['nav.group.liturgy', 'nav.group.worship', 'nav.group.management']) assert.ok(side.includes(`key: '${group}'`), group);
  assert.match(side, /\{ key: 'nav\.group\.worship', items: \['goLive', 'lyrics', 'media', 'announcements'\] \}/);
});

test('on a 768px-tall window the sidebar tightens so every link, Quick Actions, Output Status and the license footer fit', () => {
  const side = read('src/operator/Sidebar.tsx');
  // Navigation items and section labels.
  assert.match(side, /border-l-\[3px\] py-1\.5 text-\[15px\] leading-tight transition-colors duration-150 short:py-1/);
  assert.match(side, /mt-3 mb-1 flex items-center gap-2 px-3 short:mt-1\.5 short:mb-0\.5/);
  // Quick Actions fold into one toolbar row; the four full rows hide.
  assert.match(side, /<div className="hidden items-center gap-0\.5 px-2 short:flex" data-testid="quick-actions-compact">/);
  assert.match(side, /<div className=\{`flex flex-col gap-0\.5 \$\{collapsed \? '' : 'short:hidden'\}`\}>/);
  const compact = side.slice(side.indexOf('data-testid="quick-actions-compact"'), side.indexOf("short:hidden'}`}>"));
  for (const action of ["t('side.search')", "t('side.exportImport')", "t('side.fullscreen')", '<LangSwitch />']) assert.ok(compact.includes(action), action);
  // Output Status is one line of chips, labelled for screen readers, not a heading plus three rows.
  assert.ok(side.includes("aria-label={t('side.outputs')}"));
  assert.match(side, /className={`mt-1.5 flex gap-x-3 gap-y-1 short:mt-1 /);
  assert.match(side, /\{license\.statusText\}/);
  assert.match(side, /\{collapsed \? '©' : FOOTER_TEXT\}/);
});

// ── Service Console ────────────────────────────────────────────────────────

test('the Service Console tightens on short windows and the bottom row keeps room for the whole booth clock', () => {
  const dash = read('src/operator/Dashboard.tsx');
  assert.match(dash, /<div className="flex min-h-full flex-col gap-5 p-5 pb-6 short:gap-2 short:px-4 short:pt-1 short:pb-2">/);
  assert.match(dash, /<ConsoleHeader \/>\s*<PreServiceWidget \/>/);
  assert.match(dash, /min-\[1180px\]:flex-1 min-\[1180px\]:grid-cols-3 short:min-h-\[152px\]/, 'the bottom row fills what is left, never below the clock');
  for (const panel of ['<BoothClock />', '<KeyboardMap />', '<SystemHealthPanel />']) assert.ok(dash.includes(panel), panel);
  const clock = read('src/operator/BoothClock.tsx');
  assert.match(clock, /short:text-4xl short:xl:text-\[36px\]/);
  assert.match(clock, /text-lg font-medium short:hidden/, 'the Current Time caption steps aside on short windows');
  assert.match(read('src/operator/Panel.tsx'), /short:min-h-9 short:py-1\.5/);
  assert.match(read('src/operator/OperatorApp.tsx'), /pt-6 pr-16 short:pt-2/);
});

test('Action Center titles stay on one line and every card has the same title and description baselines', () => {
  const dash = read('src/operator/Dashboard.tsx');
  const center = body(dash, 'function ActionCenter()');
  const title = center.match(/<span data-testid="action-title" className="([^"]*)">\{t\(title\)\}<\/span>/);
  assert.ok(title, 'the card title');
  for (const cls of ['whitespace-nowrap', 'truncate', 'text-[15px]', 'leading-tight']) assert.ok(title[1].split(' ').includes(cls), cls);
  // The description always takes the same number of lines: two, or one on a short window.
  assert.match(center, /line-clamp-2 h-\[2lh\] text-xs leading-snug font-normal text-muted short:line-clamp-1 short:h-\[1lh\]/);
  // The arrow gives its width back to the title below the 2xl breakpoint.
  assert.match(center, /<ArrowRight size=\{18\} className="hidden shrink-0 [^"]*2xl:block"/);
  assert.match(center, /title=\{`\$\{t\(title\)\} — \$\{t\(desc\)\}`\}/, 'a translated title cut short is still readable as a tooltip');
});

test('the readiness pill puts the ready count first, then what still needs action', () => {
  const widget = read('src/operator/PreServiceWidget.tsx');
  assert.match(widget, /\{ready\}\/\{checks\.length\} \{t\('ready\.ready'\)\} · \{checks\.length - ready\}\{' '\}\n\s+\{checks\.length - ready === 1 \? t\('ready\.actionOne'\) : t\('ready\.actionMany'\)\}/);
  assert.doesNotMatch(widget, /\{t\('ready\.actionNeeded'\)\} · \{ready\}/, 'no longer "Action Needed · 3/4"');
  const strings = read('src/i18n/strings.ts');
  assert.match(strings, /'ready\.actionOne': 'Action',/);
  assert.match(strings, /'ready\.actionMany': 'Actions',/);
  // A synthetic tally reads as the badge would.
  const badge = (ready, total) => `${ready}/${total} Ready · ${total - ready} ${total - ready === 1 ? 'Action' : 'Actions'}`;
  assert.equal(badge(3, 4), '3/4 Ready · 1 Action');
  assert.equal(badge(1, 4), '1/4 Ready · 3 Actions');
});
