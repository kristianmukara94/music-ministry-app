// Live typography in Go Live: the text case (Aa / AA / aa) on every live surface, the 50%-250% text size, the per-song size up to 250%, and
// edge-to-edge (MAX). Synthetic strings only. Run with: node --test shared/live-typography.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initialLiveState, liveReducer } from './live.js';
import {
  EDGE_TO_EDGE,
  applyFrameTextCase,
  applyPwSlideTextCase,
  applyTextCase,
  balanceProjectorLines,
  edgeToEdgeBox,
  fitFontSize,
  plannerCaseReachesProjector,
} from './text-fit.js';
import { PROJECTOR_SETTINGS_DEFAULTS, SLIDE_FONT_SCALES, sanitizeProjectorSettings } from './projector-settings.js';
import { FONT_SCALE_MAX, clampFontScale, fontScaleColumns, stepFontScale } from './song-filing.js';
import { lyricsStanzaFrame } from './stage-plan-row.js';
import { GOLIVE_LANGS, goLiveT } from './golive-i18n.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);

// A stand-in for the browser's measure: capitals are wider than small letters, as they are in every slide font.
const glyph = (ch) => (ch === ' ' ? 0.28 : ch >= 'A' && ch <= 'Z' ? 0.72 : 0.5);
const measureAt = (px) => (text) => [...text].reduce((w, ch) => w + glyph(ch) * px, 0);

const SLIDE_W = 1920;
const SLIDE_H = 1080;
const STANZA = 'Sample Lyric Line one with several words to wrap\nSample Lyric Line two';

/**
 * The fit the projector runs, with the synthetic measure: the largest size from `ceilingPx` down at which the stanza, balanced for the box's
 * width, is no wider than the box and no taller than its share of the height.
 */
function fitStanza(text, { width, height, ceilingPx, leading, heightShare }) {
  let lines = [];
  const fits = (px) => {
    const measure = measureAt(px);
    lines = balanceProjectorLines(text, width, measure).split('\n');
    return lines.every((line) => measure(line) <= width + 0.5) && lines.length * px * leading <= height * heightShare;
  };
  const px = fitFontSize(ceilingPx, 10, fits);
  fits(px);
  return { px, lines };
}

const NORMAL_BOX = { width: SLIDE_W * 0.88, height: SLIDE_H * (1 - 0.08), ceilingPx: 96, leading: 1.2, heightShare: 0.9 };
const MAX_BOX = {
  width: SLIDE_W * (1 - (2 * EDGE_TO_EDGE.padXcqw) / 100),
  height: SLIDE_H * (1 - (2 * EDGE_TO_EDGE.padYcqh) / 100),
  ceilingPx: (SLIDE_W * EDGE_TO_EDGE.ceilingCqw) / 100,
  leading: EDGE_TO_EDGE.leading,
  heightShare: EDGE_TO_EDGE.heightShare,
};

// --- Text case ------------------------------------------------------------------------------------------------------------------------

test('UPPERCASE is applied before the lines are balanced, so the balanced lines fit at the width capitals take', () => {
  const measure = measureAt(40);
  const line = 'Sample Lyric Line with a few more sample words in it';
  // A slide exactly as wide as the line as typed: it fits on one line in its own case, but not in capitals.
  const width = Math.ceil(measure(line));
  const upper = applyTextCase(line, 'uppercase');
  assert.ok(measure(upper) > width);
  // The projector's order: case first, then balance.
  const right = balanceProjectorLines(upper, width, measure).split('\n');
  assert.ok(right.every((l) => measure(l) <= width), 'every line drawn in capitals fits');
  assert.equal(right.join(' '), upper, 'no word is lost or re-cased');
  // Balancing the as-typed text and then capitalising it leaves a line too wide for the slide: the reason for the order.
  const wrong = balanceProjectorLines(line, width, measure).split('\n').map((l) => applyTextCase(l, 'uppercase'));
  assert.ok(wrong.some((l) => measure(l) > width), 'balancing first would overflow in capitals');
});

test('the projector frame, its title and the P&W footer are in the live case before any fit', () => {
  const lyrics = { kind: 'lyrics', title: 'Sample Song Title', label: 'Verse 1', text: 'Sample Lyric Line' };
  const cased = applyFrameTextCase(lyrics, 'uppercase');
  assert.equal(cased.text, 'SAMPLE LYRIC LINE');
  assert.equal(cased.title, 'SAMPLE SONG TITLE');
  const pw = { kind: 'pw', segmentName: 'Sample Segment', type: 'song', index: 0, total: 2, footer: 'Sample Song Title', slide: { kind: 'lyrics', label: 'V1', chip: 'V1', text: 'Sample Lyric Line', hymnId: 1, hymnTitle: 'Sample Song Title', sectionId: '1' } };
  const pwCased = applyFrameTextCase(pw, 'uppercase');
  assert.equal(pwCased.footer, 'SAMPLE SONG TITLE', 'the song title footer follows the case');
  assert.equal(pwCased.slide.text, 'SAMPLE LYRIC LINE');
  // The view applies it in FrameView, ahead of every slide component and its fit.
  const view = read('src/output/ProjectorView.tsx');
  const caseAt = view.indexOf('const frame = useMemo(() => applyFrameTextCase(given, textCase), [given, textCase]);');
  assert.ok(caseAt > 0 && caseAt < view.indexOf('case \'lyrics\':'), 'the frame is cased before any slide is drawn');
});

test('the P&W CURRENT SLIDE and NEXT SLIDE previews show the live case, as the projector does', () => {
  const current = { kind: 'lyrics', label: 'V1', chip: 'V1', text: 'Sample Lyric Line', hymnId: 1, hymnTitle: 'Sample Song Title', sectionId: '1' };
  const next = { kind: 'prayer', label: 'Sample Prayer', text: 'Sample Prayer line' };
  assert.equal(applyPwSlideTextCase(current, 'uppercase').text, 'SAMPLE LYRIC LINE');
  assert.equal(applyPwSlideTextCase(current, 'uppercase').hymnTitle, 'SAMPLE SONG TITLE');
  assert.equal(applyPwSlideTextCase(next, 'lowercase').text, 'sample prayer line');
  assert.equal(applyPwSlideTextCase(current, 'original'), current, 'as typed is the same slide, so nothing re-renders');
  assert.equal(applyPwSlideTextCase(null, 'uppercase'), null, 'a black step stays black');

  const preview = read('src/praise-worship/CurrentNextPreview.tsx');
  assert.match(preview, /const textCase = useLive\(\(s\) => textCaseOf\(s\.state\.settings\.textCase\)\);/, 'the previews read the live case');
  assert.match(preview, /applyPwSlideTextCase\(shown\.slide, textCase\)/, 'the slide is cased before PwSlideFace fits it');
  assert.match(preview, /segmentName=\{applyTextCase\(shown\.segmentName, textCase\)\}/);
  assert.match(preview, /footer=\{applyTextCase\(slideFooter\(slide, t\('prayTogether'\)\), textCase\) \|\| undefined\}/, 'the footer song title too');
  // The Holy Mass console's previews are FramePreview, which draws through FrameView and so through the same case.
  assert.match(read('src/output/ProjectorView.tsx'), /<FrameView frame=\{shown\} \/>/);
  assert.match(read('src/golive/MassLiveView.tsx'), /<FramePreview frame=\{frame\}/);
});

test('switching Aa / AA / aa mid-session changes the case at once and keeps the slide, its place and the background', () => {
  const slides = [[{ role: 'all', text: 'Sample Lyric Line one' }], [{ role: 'all', text: 'Sample Lyric Line two' }], [{ role: 'all', text: 'Sample Lyric Line three' }]];
  const before = run(
    initialLiveState(),
    { type: 'output/toggle', output: 'projector' },
    { type: 'projector/show', frame: { kind: 'deck', title: 'Sample Song Title', slides, index: 2 }, source: 'DIRECT_DECK' },
  );
  const live = before.projector.live;
  assert.equal(live.kind, 'deck');
  for (const mode of ['uppercase', 'lowercase', 'original']) {
    const after = run(before, { type: 'settings/projector', value: { textCase: mode } });
    assert.equal(after.settings.textCase, mode);
    assert.equal(after.projector.live, live, 'the same frame object stays on air: no reset, no transition');
    assert.equal(after.projector.live.index, 2, 'the current slide is kept');
    assert.equal(after.projector.background, before.projector.background, 'the background (and a playing video) is untouched');
    assert.equal(applyFrameTextCase(after.projector.live, mode).slides[2][0].text, applyTextCase('Sample Lyric Line three', mode));
  }
});

test('both Go Live bottom bars carry Aa | AA | aa, wired to the projector case', () => {
  const bar = read('src/praise-worship/SlideTypography.tsx');
  assert.match(bar, /<TextCaseSwitch/);
  assert.match(bar, /save\(\{ textCase: mode \}\)/, 'the same projector setting the Live Quick Controls set');
  // One component on both consoles, so they behave identically.
  assert.match(read('src/praise-worship/LiveView.tsx'), /<SlideTypography \/>/);
  assert.match(read('src/golive/MassLiveView.tsx'), /<SlideTypography \/>/);
});

test('a Planner pick reaches the projector only while nothing is on air', () => {
  for (const kind of [undefined, null, 'idle', 'black', 'blackout', 'welcome']) assert.equal(plannerCaseReachesProjector(kind), true, String(kind));
  for (const kind of ['lyrics', 'deck', 'text', 'pw', 'psalm', 'image']) assert.equal(plannerCaseReachesProjector(kind), false, kind);
  const planner = read('src/planner/textCase.ts');
  assert.match(planner, /plannerCaseReachesProjector\(state\.projector\.live\.kind\)/);
  assert.match(planner, /bridge\.projector\.save\(\{ textCase: next \}\)/);
  assert.match(read('src/planner/MassPlanner.tsx'), /const setTextCase = pickPlannerTextCase;/);
  assert.match(read('src/praise-worship/PlanView.tsx'), /const setTextCase = pickPlannerTextCase;/);
  // The print studio keeps the Planner's case to itself.
  assert.doesNotMatch(read('src/planner/PrintLineup.tsx'), /pickPlannerTextCase/);
});

// --- Font size and MAX ------------------------------------------------------------------------------------------------------------------

test('the live text size goes from 50% to 250% and is not clamped at 150%', () => {
  assert.equal(SLIDE_FONT_SCALES[0], 0.5);
  assert.equal(SLIDE_FONT_SCALES.at(-1), 2.5);
  for (const scale of [1.6, 2, 2.5]) assert.equal(sanitizeProjectorSettings({ slideFontScale: scale }).slideFontScale, scale);
  const s = run(initialLiveState(), { type: 'settings/projector', value: { slideFontScale: 2.5 } });
  assert.equal(s.settings.slideFontScale, 2.5, 'the live state carries 250%');
});

test('a song can be set up to 250% of the theme size, and the projector frame carries it', () => {
  assert.equal(FONT_SCALE_MAX, 2.5);
  assert.equal(clampFontScale(2.5), 2.5);
  assert.equal(clampFontScale(2), 2);
  assert.equal(stepFontScale(1.5, 1), 1.6, 'A+ goes past 150%');
  const hymn = { id: 7, title: 'Sample Song Title', fontScale: 2.5, stanzas: [{ stanzaType: 'Verse 1', lyricsText: 'Sample Lyric Line' }] };
  assert.equal(lyricsStanzaFrame(hymn, 0).fontScale, 2.5);
  assert.deepEqual(fontScaleColumns(2.5), { fontScale: 1.5, fontScaleWide: 2.5 }, 'the original column keeps within its 150% constraint');
  assert.deepEqual(fontScaleColumns(1.2), { fontScale: 1.2, fontScaleWide: null });
});

test('edge-to-edge is a saved projector setting, off by default, and toggling it keeps the slide on air', () => {
  assert.equal(PROJECTOR_SETTINGS_DEFAULTS.edgeToEdge, false);
  assert.equal(sanitizeProjectorSettings({ edgeToEdge: true }).edgeToEdge, true);
  assert.equal(sanitizeProjectorSettings({ edgeToEdge: 'yes' }).edgeToEdge, false);
  const on = run(
    initialLiveState(),
    { type: 'output/toggle', output: 'projector' },
    { type: 'projector/show', frame: { kind: 'lyrics', title: 'Sample Song Title', label: 'Verse 1', text: 'Sample Lyric Line' }, source: 'DIRECT_DECK' },
  );
  const after = run(on, { type: 'settings/projector', value: { edgeToEdge: true } });
  assert.equal(after.settings.edgeToEdge, true);
  assert.equal(after.projector.live, on.projector.live, 'the same slide stays on air');
  assert.equal(after.projector.background, on.projector.background);
});

test('MAX keeps only a thin edge clearance, and room for the footer, label and lower third only when they are shown', () => {
  assert.ok(EDGE_TO_EDGE.padXcqw < 6 && EDGE_TO_EDGE.padYcqh < 4, 'thinner than the normal 6% / 4% inset');
  assert.deepEqual(edgeToEdgeBox(), { left: 1.5, right: 1.5, top: 1.5, bottom: 1.5 });
  assert.equal(edgeToEdgeBox({ footer: true }).bottom, EDGE_TO_EDGE.footerClearCqw);
  assert.equal(edgeToEdgeBox({ header: true }).top, EDGE_TO_EDGE.headerClearCqw);
  assert.equal(edgeToEdgeBox({ footer: true, lowerThird: true }).bottom, Math.max(EDGE_TO_EDGE.footerClearCqw, EDGE_TO_EDGE.lowerThirdClearCqw));
  assert.equal(EDGE_TO_EDGE.leading, 1.12);
});

test('MAX draws an UPPERCASE stanza larger than the normal layout, and its balanced lines stay inside the slide', () => {
  const upper = applyTextCase(STANZA, 'uppercase');
  const normal = fitStanza(upper, NORMAL_BOX);
  const max = fitStanza(upper, MAX_BOX);
  assert.ok(max.px > normal.px * 1.5, `MAX is much larger (${max.px}px vs ${normal.px}px)`);
  const measure = measureAt(max.px);
  assert.ok(max.lines.every((l) => measure(l) <= MAX_BOX.width + 0.5), 'no line is wider than the slide');
  assert.ok(max.lines.length * max.px * MAX_BOX.leading <= MAX_BOX.height * MAX_BOX.heightShare, 'the stanza is not taller than the slide');
  assert.equal(max.lines.join(' ').replace(/\s+/g, ' '), upper.replace(/\n/g, ' '), 'every word is shown, in order, in capitals');
});

test('MAX makes a short chorus very large and still fits a six-line stanza whole', () => {
  const chorus = fitStanza(applyTextCase('Sample Lyric Line', 'uppercase'), MAX_BOX);
  const stanza = Array.from({ length: 6 }, (_, i) => `Sample Lyric Line ${i + 1} with more words`).join('\n');
  const long = fitStanza(applyTextCase(stanza, 'uppercase'), MAX_BOX);
  assert.ok(chorus.px > long.px, 'the short chorus is drawn larger');
  assert.ok(long.lines.length * long.px * MAX_BOX.leading <= MAX_BOX.height * MAX_BOX.heightShare, 'the six lines fit, unclipped');
});

test('the projector and the P&W face draw MAX from the same layout', () => {
  const view = read('src/output/ProjectorView.tsx');
  assert.match(view, /const naturalSize = edgeToEdge \? `\$\{EDGE_TO_EDGE\.ceilingCqw\}cqw` :/, 'the fit starts above any stanza, so it ends at the largest that fits');
  assert.match(view, /\$\{edgeToEdge \? 'w-full max-w-none' : 'max-w-\[88cqw\]'\}/);
  assert.match(view, /const bottom = bandOn \? EDGE_TO_EDGE\.lowerThirdClearCqh : EDGE_TO_EDGE\.padYcqh;/, 'the bottom is kept clear while a lower third is on');
  const face = read('src/praise-worship/PwSlideFace.tsx');
  assert.match(face, /box=\{edgeToEdgeBox\(\{ header: !hideTitle, footer: Boolean\(footer \|\| position\), lowerThird: bandOn \}\)\}/);
  assert.match(face, /heightShare: EDGE_TO_EDGE\.heightShare/);
});

test('the Go Live bar steps 50%-250%, resets from the readout, and has the MAX pill in gold', () => {
  const bar = read('src/praise-worship/SlideTypography.tsx');
  assert.match(bar, /disabled=\{index >= SLIDE_FONT_SCALES\.length - 1\}/, 'A+ stays enabled up to the last step, 250%');
  assert.match(bar, /title=\{t\('typoReset'\)\}\s+onClick=\{\(\) => save\(\{ slideFontScale: 1 \}\)\}/, 'the readout resets to 100%');
  assert.match(bar, /onClick=\{\(\) => save\(\{ edgeToEdge: !edgeToEdge \}\)\}/);
  assert.match(bar, /const PILL_ON = 'border-gold bg-gold\/20 text-gold';/);
});

test('the new Go Live labels are in English, Tagalog and Cebuano', () => {
  assert.deepEqual([...GOLIVE_LANGS], ['en', 'tl', 'ceb']);
  const keys = ['typoTextCase', 'typoTextCaseOriginal', 'typoTextCaseUpper', 'typoTextCaseLower', 'typoSmaller', 'typoLarger', 'typoReset', 'typoEdgeToEdge', 'typoEdgeToEdgeHint'];
  const source = read('shared/golive-i18n.js');
  for (const key of keys) {
    assert.equal((source.match(new RegExp(`^    ${key}: '`, 'gm')) ?? []).length, 3, `${key} in all three languages`);
    for (const lang of GOLIVE_LANGS) assert.ok(goLiveT(lang, key).trim().length > 0 && goLiveT(lang, key) !== key, `${lang}.${key}`);
  }
  assert.equal(goLiveT('en', 'typoReset'), 'Reset font size to 100%');
  assert.equal(goLiveT('en', 'typoEdgeToEdge'), 'MAX');
});
