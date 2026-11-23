// Plan Appearance: the plan's own default look for every slide of a Holy Mass or Praise & Worship plan. Precedence (per-slide override, then the
// plan, then the Global Appearance), the shape that is saved, the background layer, which plan a slide belongs to, the live state, the TV, and
// Title Safe containment at every plan size and font. Synthetic strings only. Run with: node --test shared/plan-appearance.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PLAN_APPEARANCE_DEFAULT,
  PLAN_FONTS,
  PLAN_FONT_SIZES,
  applyPlanAppearance,
  clampDim,
  loadedPlanAppearance,
  parsePlanAppearance,
  planAppearanceBadge,
  planAppearanceFor,
  planBackgroundOf,
  planBackgroundShown,
  planLookSignature,
  planSettingsOverlay,
  planTextLook,
  portablePlanAppearance,
  sanitizePlanAppearance,
  serializePlanAppearance,
  stepPlanFontSize,
  withPlanAppearance,
} from './plan-appearance.js';
import { resolveSlideLook, withoutPlanSlideLooks, planSlideLookCount, massLookKey, pwLookKey } from './slide-look.js';
import { initialLiveState, liveReducer } from './live.js';
import { PROJECTOR_SETTINGS_DEFAULTS } from './projector-settings.js';
import { EDGE_TO_EDGE, layoutLyricLines } from './text-fit.js';
import { secondaryViewSnapshot } from './remote-view.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const SETTINGS = { ...PROJECTOR_SETTINGS_DEFAULTS, slideFont: 'sans', slideFontScale: 1.2, textCase: 'original', slideAlign: null, edgeToEdge: false };
const CUSTOM = sanitizePlanAppearance({
  enabled: true,
  background: { type: 'motion', color: '#2e1a47', mediaPath: 'apcc-media://media/42', dimOpacity: 0.35 },
  typography: { fontFamily: 'playfair', fontSizeScale: 1.25, fontWeight: 'semibold', textCase: 'upper', textAlign: 'left', textColor: '#ecc98a', textShadow: false },
});
const SONG = { kind: 'lyrics', title: 'Sample Plan Title', label: 'VERSE 1', text: 'Sample Song Line\nSample Song Line Two' };
const PRAYER = { kind: 'text', title: 'Sample Plan Title', headline: 'Sample Prayer', text: 'Sample Prayer Line', bg: null };
const PW = { kind: 'pw', slide: { kind: 'lyrics', label: 'VERSE 1', chip: 'V1', text: 'Sample Song Line', hymnId: 1, hymnTitle: 'Sample Song', sectionId: 'v1' }, segmentName: 'Sample Segment', type: 'song', index: 0, total: 1 };

/** A live state with a Holy Mass plan (7) in the queue and a Praise & Worship plan (9) loaded, each with its own look. */
function loadedState({ mass = CUSTOM, pw = CUSTOM } = {}) {
  let s = initialLiveState();
  s = liveReducer(s, { type: 'queue/set', items: [], planId: 7 });
  s = liveReducer(s, { type: 'pw/load', sessionId: 9 });
  if (mass) s = liveReducer(s, { type: 'planLook/set', kind: 'mass', planId: 7, appearance: mass });
  if (pw) s = liveReducer(s, { type: 'planLook/set', kind: 'pw', planId: 9, appearance: pw });
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The saved shape

test('a plan with nothing saved follows the Global Appearance, and saves as NULL', () => {
  assert.deepEqual(parsePlanAppearance(null), sanitizePlanAppearance(PLAN_APPEARANCE_DEFAULT));
  assert.equal(parsePlanAppearance('').enabled, false);
  assert.equal(parsePlanAppearance('{not json').enabled, false, 'a damaged column reads as the default');
  assert.equal(serializePlanAppearance(PLAN_APPEARANCE_DEFAULT), null);
  assert.equal(serializePlanAppearance({ enabled: false }), null);
});

test('sanitizing keeps only known keys with valid values', () => {
  const a = sanitizePlanAppearance({
    enabled: 'yes',
    junk: 1,
    background: { type: 'video', color: 'red', mediaPath: 'C:/Users/sample.mp4', dimOpacity: 3 },
    typography: { fontFamily: 'Comic', fontSizeScale: 1.3, fontWeight: 'heavy', textCase: 'lower', textAlign: 'justify', textColor: '#abc', textShadow: 'no' },
  });
  assert.equal(a.enabled, false, 'only true turns the plan look on');
  assert.deepEqual(a.background, { type: 'color', color: '#000000', dimOpacity: 0.8 }, 'an unknown type, colour and a file path outside the library are dropped; the dim stops at 80%');
  assert.deepEqual(a.typography, { textColor: '#AABBCC' });
  assert.equal(clampDim(-1), 0);
  assert.equal(clampDim(0.333), 0.35);
});

test('a picture or motion clip is kept by its Media Library address, and its id is read from it', () => {
  assert.equal(CUSTOM.background.mediaId, '42');
  assert.equal(CUSTOM.background.mediaPath, 'apcc-media://media/42');
  const round = parsePlanAppearance(serializePlanAppearance(CUSTOM));
  assert.deepEqual(round, CUSTOM, 'what is saved reads back the same');
  assert.equal(sanitizePlanAppearance({ background: { type: 'image', mediaId: '5' } }).background.mediaId, undefined, 'an id with no address is not trusted');
});

test('the size pills step from 85% to MAX; unset steps from 100%', () => {
  assert.deepEqual([...PLAN_FONT_SIZES], [0.85, 1, 1.15, 1.25, 1.5, 2, 'max']);
  assert.equal(stepPlanFontSize(undefined, 1), 1.15);
  assert.equal(stepPlanFontSize(undefined, -1), 0.85);
  assert.equal(stepPlanFontSize(2, 1), 'max');
  assert.equal(stepPlanFontSize('max', 1), 'max');
  assert.equal(stepPlanFontSize(0.85, -1), 0.85);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Precedence

test('precedence: a per-slide override wins over the plan, and the plan wins over the Global Appearance', () => {
  const global = resolveSlideLook(SETTINGS, null);
  assert.equal(global.fontScale, 1.2);
  assert.equal(global.textCase, 'original');
  assert.equal(global.align, null);

  const plan = resolveSlideLook(SETTINGS, null, null, CUSTOM);
  assert.equal(plan.fontScale, 1.25, 'the plan size');
  assert.equal(plan.textCase, 'uppercase', 'the plan case');
  assert.equal(plan.align, 'left', 'the plan alignment');
  assert.equal(plan.hasOverride, false);

  const slide = resolveSlideLook(SETTINGS, { textCase: 'lowercase', align: 'right', fontScale: 2 }, null, CUSTOM);
  assert.equal(slide.textCase, 'lowercase', 'the slide’s own case');
  assert.equal(slide.align, 'right', 'the slide’s own alignment');
  assert.equal(slide.fontScale, 2, 'the slide’s own size');
  assert.equal(slide.hasOverride, true);
});

test('Use Global Default: a plan look that is off changes nothing, and keeps the settings object itself', () => {
  const off = { ...CUSTOM, enabled: false };
  assert.equal(applyPlanAppearance(SETTINGS, off), SETTINGS);
  assert.deepEqual(planSettingsOverlay(off), {});
  assert.equal(planBackgroundOf(off), null);
  assert.deepEqual(planTextLook(off), { weight: null, color: null, shadow: null });
  assert.deepEqual(resolveSlideLook(SETTINGS, null, null, off), resolveSlideLook(SETTINGS, null));
});

test('a plan sets only the type it chooses; the rest follows the Global Appearance', () => {
  const fontOnly = sanitizePlanAppearance({ enabled: true, typography: { fontFamily: 'serif' } });
  const merged = applyPlanAppearance(SETTINGS, fontOnly);
  assert.equal(merged.slideFont, 'serif');
  assert.equal(merged.slideFontScale, 1.2, 'the global size');
  assert.equal(merged.textCase, 'original', 'the global case');
  assert.equal(applyPlanAppearance(SETTINGS, fontOnly), merged, 'the same merged object each time, so selectors keep their identity');
});

test('MAX is edge-to-edge; a size pill turns edge-to-edge off', () => {
  const max = planSettingsOverlay(sanitizePlanAppearance({ enabled: true, typography: { fontSizeScale: 'max' } }));
  assert.deepEqual(max, { edgeToEdge: true });
  const pill = planSettingsOverlay(sanitizePlanAppearance({ enabled: true, typography: { fontSizeScale: 0.85 } }));
  assert.deepEqual(pill, { slideFontScale: 0.85, edgeToEdge: false });
  assert.equal(resolveSlideLook({ ...SETTINGS, edgeToEdge: true }, null, null, sanitizePlanAppearance({ enabled: true, typography: { fontSizeScale: 0.85 } })).maxFit, false);
  assert.equal(resolveSlideLook(SETTINGS, { maxFit: true }, null, sanitizePlanAppearance({ enabled: true, typography: { fontSizeScale: 0.85 } })).maxFit, true, 'a slide’s own MAX still wins');
});

test('weight, colour and drop shadow come from the plan, and key the slide so its fit runs again', () => {
  assert.deepEqual(planTextLook(CUSTOM), { weight: 600, color: '#ECC98A', shadow: false });
  assert.equal(planLookSignature(null), 'global');
  assert.notEqual(planLookSignature(CUSTOM), planLookSignature(sanitizePlanAppearance({ ...CUSTOM, typography: { ...CUSTOM.typography, fontWeight: 'bold' } })));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Background

test('Color, Image and Motion backgrounds resolve with their dim; a picture not picked falls back to the colour', () => {
  assert.deepEqual(planBackgroundOf(sanitizePlanAppearance({ enabled: true, background: { type: 'color', color: '#0F2A4A', dimOpacity: 0.2 } })), {
    type: 'color',
    color: '#0F2A4A',
    media: null,
    dim: 0.2,
  });
  const image = planBackgroundOf(sanitizePlanAppearance({ enabled: true, background: { type: 'image', mediaPath: 'apcc-media://media/3', dimOpacity: 0.5 } }));
  assert.deepEqual(image.media, { kind: 'image', src: 'apcc-media://media/3', fit: 'cover', loop: true });
  assert.equal(image.dim, 0.5);
  const motion = planBackgroundOf(CUSTOM);
  assert.equal(motion.type, 'motion');
  assert.equal(motion.media.kind, 'video', 'a motion clip plays as a looping video');
  assert.equal(motion.media.loop, true);
  const unpicked = planBackgroundOf(sanitizePlanAppearance({ enabled: true, background: { type: 'image', color: '#1A1A1A' } }));
  assert.equal(unpicked.type, 'color');
  assert.equal(unpicked.media, null);
});

test('the plan background gives way to a slide’s own backdrop, a song’s own colour and a live Media Library background', () => {
  assert.ok(planBackgroundShown({ frame: SONG, appearance: CUSTOM }));
  assert.ok(planBackgroundShown({ frame: PW, appearance: CUSTOM }));
  assert.equal(planBackgroundShown({ frame: PW, appearance: CUSTOM, ownBackdrop: 'burgundy' }), null, 'This Slide backdrop');
  assert.equal(planBackgroundShown({ frame: { ...SONG, style: { bgColor: '#112233' } }, appearance: CUSTOM }), null, 'the song’s own style');
  assert.equal(planBackgroundShown({ frame: SONG, appearance: CUSTOM, libraryBackground: true }), null, 'a Media Library background on a Holy Mass slide');
  assert.ok(planBackgroundShown({ frame: PW, appearance: CUSTOM, libraryBackground: true }), 'a P&W slide covers a library background, as before');
  assert.equal(planBackgroundShown({ frame: PW, appearance: CUSTOM, libraryBackground: true, backgroundEverywhere: true }), null, 'unless it is shown everywhere');
  assert.equal(planBackgroundShown({ frame: { kind: 'image', src: 'apcc-media://slide/1', title: 'Sample' }, appearance: CUSTOM }), null, 'a picture keeps its own design');
  assert.equal(planBackgroundShown({ frame: { kind: 'welcome', lang: 'en' }, appearance: CUSTOM }), null, 'and so does the Welcome screen');
});

test('the Planner badge shows Global Default or the custom colour and picture', () => {
  assert.deepEqual(planAppearanceBadge(null), { custom: false, color: null, thumb: null, motion: false });
  assert.deepEqual(planAppearanceBadge(CUSTOM), { custom: true, color: '#2E1A47', thumb: 'apcc-media://media/42', motion: true });
});

test('a picture this laptop does not have falls back to the colour (an import from another laptop)', () => {
  const kept = portablePlanAppearance(CUSTOM, (id) => id === '42');
  assert.equal(kept.background.type, 'motion');
  const gone = portablePlanAppearance(CUSTOM, () => false);
  assert.deepEqual(gone.background, { type: 'color', color: '#2E1A47', dimOpacity: 0.35 });
  assert.deepEqual(gone.typography, CUSTOM.typography, 'the type is kept');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Which plan a slide belongs to, and the live state

test('a P&W slide takes the P&W plan’s look; a Holy Mass slide the Holy Mass plan’s', () => {
  const pwLook = sanitizePlanAppearance({ ...CUSTOM, typography: { fontFamily: 'serif' } });
  const s = loadedState({ pw: pwLook });
  assert.equal(planAppearanceFor(s, PW).typography.fontFamily, 'serif');
  assert.equal(planAppearanceFor(s, SONG).typography.fontFamily, 'playfair');
  assert.equal(planAppearanceFor(s, PRAYER).typography.fontFamily, 'playfair');
  assert.equal(planAppearanceFor(s, { ...PW, massSong: { hymnId: 1 } }).typography.fontFamily, 'playfair', 'a Holy Mass song’s title card');
  const pwOnAir = { ...s, projector: { ...s.projector, source: 'PW_SESSION' } };
  assert.equal(planAppearanceFor(pwOnAir, SONG).typography.fontFamily, 'serif', 'a library item during the P&W session keeps the session look');
  assert.equal(planAppearanceFor(s, { kind: 'whiteboard', slide: { title: 'Sample', content: '', design: {} } }), null);
});

test('only a plan that is loaded draws its look; a plan look that is off draws the Global Appearance', () => {
  let s = initialLiveState();
  s = liveReducer(s, { type: 'queue/set', items: [], planId: 7 });
  const ignored = liveReducer(s, { type: 'planLook/set', kind: 'mass', planId: 8, appearance: CUSTOM });
  assert.equal(ignored, s, 'a plan not in the queue is ignored');
  assert.equal(liveReducer(s, { type: 'planLook/set', kind: 'pw', planId: 9, appearance: CUSTOM }), s, 'no P&W plan loaded');
  const set = liveReducer(s, { type: 'planLook/set', kind: 'mass', planId: 7, appearance: CUSTOM });
  assert.deepEqual(set.planLooks.mass, { planId: 7, appearance: CUSTOM });
  assert.equal(liveReducer(set, { type: 'planLook/set', kind: 'mass', planId: 7, appearance: CUSTOM }), set, 'the same look again changes nothing');
  const off = liveReducer(set, { type: 'planLook/set', kind: 'mass', planId: 7, appearance: { ...CUSTOM, enabled: false } });
  assert.equal(loadedPlanAppearance(off, 'mass'), null);
  assert.equal(planAppearanceFor(off, SONG), null);
});

test('loading another plan drops the old plan’s look until the new one is read; reloading the same plan keeps it', () => {
  const s = loadedState();
  const same = liveReducer(s, { type: 'queue/set', items: [], planId: 7 });
  assert.deepEqual(same.planLooks.mass?.planId, 7);
  const other = liveReducer(s, { type: 'queue/set', items: [], planId: 8 });
  assert.equal(other.planLooks.mass, null);
  assert.ok(other.planLooks.pw, 'the P&W plan keeps its look');
  const nextPw = liveReducer(s, { type: 'pw/load', sessionId: 10 });
  assert.equal(nextPw.planLooks.pw, null);
  const ended = liveReducer(s, { type: 'pw/end' });
  assert.equal(ended.planLooks.pw, null);
});

test('withPlanAppearance puts the plan’s type into the settings every output reads', () => {
  const s = loadedState();
  const look = planAppearanceFor(s, SONG);
  const merged = withPlanAppearance(s, look);
  assert.equal(merged.settings.slideFont, 'playfair');
  assert.equal(merged.settings.slideFontScale, 1.25);
  assert.equal(merged.settings.textCase, 'uppercase');
  assert.equal(withPlanAppearance(s, look), merged, 'one merged state per state and look');
  assert.equal(withPlanAppearance(s, null), s);
});

test('Apply to All Slides: the plan’s on-air slide overrides are dropped, other plans’ are kept', () => {
  const looks = {
    [massLookKey(7, 0, 0)]: { textCase: 'uppercase' },
    [massLookKey(7, 2, 1)]: { fontScale: 2 },
    [massLookKey(8, 0, 0)]: { align: 'left' },
    [pwLookKey('seg-1', 0)]: { backdrop: 'burgundy' },
  };
  assert.equal(planSlideLookCount(looks, 'mass', 7), 2);
  assert.deepEqual(Object.keys(withoutPlanSlideLooks(looks, 'mass', 7)), [massLookKey(8, 0, 0), pwLookKey('seg-1', 0)]);
  assert.deepEqual(Object.keys(withoutPlanSlideLooks(looks, 'pw', 9)), [massLookKey(7, 0, 0), massLookKey(7, 2, 1), massLookKey(8, 0, 0)]);
  assert.equal(withoutPlanSlideLooks(looks, 'mass', 99), looks, 'nothing to drop gives the same object');

  let s = loadedState();
  s = liveReducer(s, { type: 'slideLook/set', key: massLookKey(7, 0, 0), look: { textCase: 'lowercase' } });
  s = liveReducer(s, { type: 'slideLook/set', key: pwLookKey('seg-1', 0), look: { align: 'right' } });
  const mass = liveReducer(s, { type: 'slideLook/clearPlan', kind: 'mass', planId: 7 });
  assert.deepEqual(Object.keys(mass.slideLooks), [pwLookKey('seg-1', 0)]);
  assert.equal(liveReducer(s, { type: 'slideLook/clearPlan', kind: 'pw', planId: 99 }), s, 'a P&W plan not loaded has none on air');
  const pw = liveReducer(s, { type: 'slideLook/clearPlan', kind: 'pw', planId: 9 });
  assert.deepEqual(Object.keys(pw.slideLooks), [massLookKey(7, 0, 0)]);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Remote View / Smart TV

test('the TV draws the plan’s background, font and size', () => {
  const s0 = loadedState();
  const shown = liveReducer(liveReducer(s0, { type: 'output/set', output: 'projector', on: true }), { type: 'projector/show', frame: PW, source: 'PW_SESSION' });
  assert.equal(shown.projector.live, PW);
  // The TV mirrors the projector (dual mode) once its own live switch is on.
  const s = { ...shown, display: { ...shown.display, mode: 'dual', targets: { ...shown.display.targets, secondary: { ...shown.display.targets.secondary, live: true } } } };
  const tv = secondaryViewSnapshot(s, 1).frame;
  assert.equal(tv.kind, 'slide');
  assert.equal(tv.color, '#2E1A47');
  assert.equal(tv.mediaId, '42');
  assert.equal(tv.mediaKind, 'video');
  assert.equal(tv.shade, true, 'the dim reaches the TV as its shade');
  assert.equal(tv.font, 'playfair');
  assert.equal(tv.fontScale, 1.25);
  const global = secondaryViewSnapshot({ ...s, planLooks: { mass: null, pw: null } }, 1).frame;
  assert.equal(global.mediaId, null, 'with no plan look, the Live slide background (none here)');
  assert.equal(global.font, PROJECTOR_SETTINGS_DEFAULTS.slideFont);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Title Safe containment

/** A synthetic measure: each font draws a letter at its own width, so a wider serif takes more room than a narrow sans. */
const WIDTH_PER_PX = { sans: 0.5, roboto: 0.5, montserrat: 0.58, serif: 0.6, playfair: 0.56, display: 0.72, bodoni: 0.55, mono: 0.62 };
const STANZA = ['Sample Song Line for the plan look', 'Sample Song Line Two goes a little longer than the first', 'Sample Song Line Three', 'Sample Song Line Four'].join('\n');

test('at every plan size and font, a stanza fits inside Title Safe (90%) without adding a slide', () => {
  // The 1920 × 1080 slide less 5% at each edge, and the label row above the words.
  const safe = { width: 1920 * 0.9, height: 1080 * 0.9 - 60 };
  for (const font of PLAN_FONTS) {
    const perPx = WIDTH_PER_PX[font] ?? 0.62;
    for (const size of PLAN_FONT_SIZES) {
      const appearance = sanitizePlanAppearance({ enabled: true, typography: { fontFamily: font, fontSizeScale: size, fontWeight: 'bold' } });
      const settings = applyPlanAppearance(SETTINGS, appearance);
      // MAX starts from the edge-to-edge ceiling; a pill from the slide's normal 96px times the plan size.
      const ceilingPx = settings.edgeToEdge ? (EDGE_TO_EDGE.ceilingCqw / 100) * 1920 : 96 * settings.slideFontScale;
      const out = layoutLyricLines(STANZA, {
        ...safe,
        ceilingPx,
        readablePx: 24,
        leading: 1.2,
        // Bold is about 6% wider than regular.
        measure: (text, px) => text.length * px * perPx * 1.06,
      });
      const widest = Math.max(...out.lines.map((l) => l.length * out.px * perPx * 1.06));
      assert.ok(widest <= safe.width + 0.5, `${font} at ${size}: no line runs past the sides`);
      assert.ok(out.lines.length * out.px * 1.2 <= safe.height + 0.5, `${font} at ${size}: the stanza ends above the bottom of Title Safe`);
      assert.equal(out.lines.join(' ').replace(/\s+/g, ' '), STANZA.replace(/\n/g, ' '), `${font} at ${size}: every word is kept, on one slide`);
    }
  }
});

test('MAX keeps Title Safe at the top and the bottom', () => {
  assert.ok(EDGE_TO_EDGE.padYcqh >= 5, 'a Holy Mass stanza keeps 5% clear top and bottom');
  assert.ok(EDGE_TO_EDGE.safeYcqw >= 56.25 * 0.05, 'a P&W page keeps 5% of its height clear');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Every surface draws through the same path

test('every surface draws a plan’s slides through FrameView or the P&W face, with the plan look', () => {
  const projector = read('src/output/ProjectorView.tsx');
  assert.match(projector, /<PlanLook\.Provider value=\{appearance\}>\s*<PlanTextLook appearance=\{appearance\}>\s*<FrameViewBody/, 'FrameView (projector, Stage Mirror, Output Preview, Holy Mass Go Live)');
  assert.match(projector, /<PlanBackgroundLayer background=\{planBackground \?\? keptPlanBackground\} visible=\{planVisible\} \/>/, 'the congregation projector and the mirror');
  assert.match(projector, /\{planBackground && <PlanBackgroundLayer background=\{planBackground\} \/>\}/, 'the preview monitors');
  const pw = read('src/praise-worship/CurrentNextPreview.tsx');
  assert.match(pw, /const settings = applyPlanAppearance\(useLive\(\(s\) => s\.state\.settings\), appearance\);/, 'P&W Go Live monitors');
  assert.match(pw, /<PlanTextLook appearance=\{appearance\}>/);
  assert.match(read('src/output/outputState.ts'), /return select\(withPlanAppearance\(audience \? onAir\(state\) : state, plan\)\);/);
  assert.match(read('src/output/PlanLook.tsx'), /<PlanKeyed key=\{planLookSignature\(appearance\)\}>/, 'a new weight, colour or shadow fits the words again');
  // The font and size reach the fits through the settings they already depend on.
  assert.match(projector, /deps: \[shown, style, slideFont, label, fontScale, bandOn\]/);
});

test('the plan’s weight, colour and shadow reach only the words', () => {
  const css = read('src/styles.css');
  assert.match(css, /\.apcc-plan-text\[data-plan-weight\] \[data-slide-words\],/);
  assert.match(css, /font-weight: var\(--apcc-plan-weight\) !important;/);
  assert.match(css, /color: var\(--apcc-plan-text-color\) !important;/);
  assert.match(css, /\.apcc-plan-text\[data-plan-flat\] \[data-slide-words\] \* \{\n  text-shadow: none !important;/);
});

test('the Plan Appearance drawer scrolls with a touchpad: no-drag everywhere, bounded flex column, wide scrollbar, focused body', () => {
  const ui = read('src/planner/PlanAppearance.tsx');
  const css = read('src/styles.css');
  // NO_DRAG on the root, backdrop, dialog, header, nav, scroll body and footer (7+), so Windows never swallows two-finger pan/wheel.
  assert.ok((ui.match(/NO_DRAG/g) ?? []).length >= 9, 'NO_DRAG is applied across the whole drawer');
  assert.match(ui, /<header [^>]*style=\{NO_DRAG\}/);
  assert.match(ui, /<footer [^>]*style=\{NO_DRAG\}/);
  assert.match(ui, /style=\{\{ \.\.\.NO_DRAG, touchAction: 'pan-y' \}\}\n\s+className="plan-appearance-scroll min-h-0 flex-1 [^"]*overflow-y-auto overscroll-contain/, 'scroll body');
  assert.match(ui, /flex max-h-screen [^"]*flex-col overflow-hidden/, 'viewport-bounded shell');
  assert.match(ui, /type="range"[\s\S]{0,300}touchAction: 'pan-y'/, 'the dim slider leaves vertical pans to the scroller');
  assert.match(ui, /bodyRef\.current \?\? dialogRef\.current\)\?\.focus\(\{ preventScroll: true \}\)/, 'keyboard scrolling works on open');
  assert.match(css, /\.plan-appearance-scroll::-webkit-scrollbar \{\n  width: 12px;/);
  assert.match(css, /\.plan-appearance-scroll::-webkit-scrollbar-thumb:hover/);
});

test('the Plan Appearance drawer has quick-jump pills and a collapsible compact preview', () => {
  const ui = read('src/planner/PlanAppearance.tsx');
  for (const key of ['background', 'size', 'color']) assert.ok(ui.includes(`data-jump="${key}"`) || ui.includes(`jump="${key}"`), `jump target ${key}`);
  assert.match(ui, /data-jump-pill=\{key\} onClick=\{\(\) => jumpTo\(key\)\}/);
  assert.match(ui, /body\.scrollTo\(\{ top: Math\.max\(0, top\), behavior: calm \? 'auto' : 'smooth' \}\)/);
  assert.match(ui, /useState\(true\)/, 'preview shown by default');
  assert.match(ui, /data-preview-toggle aria-pressed=\{!showPreview\}/);
  assert.match(ui, /\{showPreview && \(/);
  assert.match(ui, /'calc\(34vh \* 16 \/ 9\)'/, 'compact height cap');
  // Existing controls survive.
  for (const hook of ['appearance_dim', 'appearance_font_size', 'appearance_font_family', 'appearance_text_color', 'appearance_shadow', 'appearance_overwrite']) assert.ok(ui.includes(hook), hook);
  const strings = read('shared/planner-i18n.js');
  for (const key of ['appearance_hide_preview', 'appearance_show_preview', 'appearance_jump_background', 'appearance_jump_size', 'appearance_jump_color']) assert.ok(strings.includes(`${key}:`), key);
});

test('the Planner offers Plan Appearance on both kinds of plan, with no-drag controls', () => {
  const view = read('src/planner/PlannerView.tsx');
  assert.match(view, /<PlanAppearanceButton key=\{`\$\{active\.kind\}:\$\{active\.id\}`\} kind=\{active\.kind\} planId=\{active\.id\} planName=\{activeName\} \/>/);
  const ui = read('src/planner/PlanAppearance.tsx');
  assert.match(ui, /style=\{\{ \.\.\.NO_DRAG, top: TITLE_BAR_CLEARANCE \}\}/, 'the drawer clears the title bar and is no-drag');
  assert.match(ui, /<PlanLookOverride\.Provider value=\{preview\}>/, 'the live preview draws the draft through the projector’s renderer');
  for (const label of ['Sample Song Line', 'Sample Prayer Line', 'Sample Plan Title', 'Sample Segment']) assert.ok(ui.includes(label), `synthetic sample: ${label}`);
});

test('the Plan Appearance preview floats (sticky, compact) once the body scrolls, without blocking touchpad scrolling', () => {
  const ui = read('src/planner/PlanAppearance.tsx');
  assert.match(ui, /onScroll=\{onBodyScroll\}/, 'the scroll body reports its scroll position');
  assert.match(ui, /bodyRef\.current\?\.scrollTop/);
  assert.match(ui, /const DOCK_ON = 24;/);
  assert.match(ui, /top > DOCK_ON/);
  assert.match(ui, /const docked = scrolled && floatOn;/);
  assert.match(ui, /'sticky top-0 z-20 /, 'docked preview is sticky at the top of the scroll area');
  assert.match(ui, /backdrop-blur/);
  assert.match(ui, /border-accent/);
  assert.match(ui, /shadow-lg/);
  assert.match(ui, /DOCK_PREVIEW_HEIGHT = 145/, 'compact height');
  assert.match(ui, /aspect-video/, '16:9 is kept');
  assert.match(ui, /marginBottom: docked && spacer \? spacer : undefined/, 'layout below keeps its place: no jump');
  assert.match(ui, /data-preview-pin/, 'float/dock pin toggle');
  assert.match(ui, /data-preview-toggle/, 'hide toggle stays on the floating header');
  assert.match(ui, /setSample\(s\)/, 'song/prayer pills stay on the floating header');
  // The floating card stays no-drag and pans vertically, as does the scroll body.
  assert.match(ui, /style=\{\{ \.\.\.NO_DRAG, touchAction: 'pan-y', marginBottom/);
  assert.match(ui, /data-plan-scroll[\s\S]*?style=\{\{ \.\.\.NO_DRAG, touchAction: 'pan-y' \}\}/);
  const strings = read('shared/planner-i18n.js');
  for (const key of ['appearance_preview_pin', 'appearance_preview_unpin']) assert.ok(strings.includes(`${key}:`), key);
});
