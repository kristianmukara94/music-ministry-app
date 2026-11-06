// Auto-legibility maths: WCAG 2.1 and APCA contrast, zone measurement of a 64 x 64 frame, and the shade and shadow chosen from it.
// Run: node --test shared/contrast.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APCA_MIN_LC,
  LEGACY_SHADOW,
  SAMPLE_SIZE,
  SCRIM_MAX,
  SCRIM_MIN,
  WCAG_MIN_RATIO,
  analyzePixels,
  apcaContrast,
  apcaLuminance,
  legibilityPlan,
  mergeProfiles,
  parseHex,
  relativeLuminance,
  wcagRatio,
  zoneContrast,
} from './contrast.js';

const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected} ± ${tol}, got ${actual}`);
const hexLc = (text, bg) => {
  const t = parseHex(text);
  const b = parseHex(bg);
  return apcaContrast(apcaLuminance(t.r, t.g, t.b), apcaLuminance(b.r, b.g, b.b));
};
const hexRatio = (a, b) => {
  const x = parseHex(a);
  const y = parseHex(b);
  return wcagRatio(relativeLuminance(x.r, x.g, x.b), relativeLuminance(y.r, y.g, y.b));
};

/** A size x size RGBA frame, each pixel coloured by `paint(x, y)`. */
function frame(paint, size = SAMPLE_SIZE) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a = 255] = paint(x, y);
      data.set([r, g, b, a], (y * size + x) * 4);
    }
  }
  return data;
}
const solid = (v) => frame(() => [v, v, v]);

test('WCAG 2.1 relative luminance and contrast ratio match the published values', () => {
  assert.equal(relativeLuminance(255, 255, 255), 1);
  assert.equal(relativeLuminance(0, 0, 0), 0);
  near(relativeLuminance(255, 0, 0), 0.2126, 1e-9);
  near(relativeLuminance(0, 255, 0), 0.7152, 1e-9);
  near(relativeLuminance(0, 0, 255), 0.0722, 1e-9);
  near(hexRatio('#ffffff', '#000000'), 21, 1e-9);
  near(hexRatio('#777777', '#ffffff'), 4.48, 0.01, '#777 on white sits just under AA');
  near(hexRatio('#767676', '#ffffff'), 4.54, 0.01, '#767676 on white is the classic AA pass');
});

test('APCA-W3 0.0.98G-4g matches its reference test vectors', () => {
  near(hexLc('#888888', '#ffffff'), 63.06, 0.1);
  near(hexLc('#ffffff', '#888888'), -68.54, 0.1);
  near(hexLc('#000000', '#aaaaaa'), 58.15, 0.1);
  near(hexLc('#aaaaaa', '#000000'), -56.24, 0.1);
  near(hexLc('#000000', '#ffffff'), 106.04, 0.1);
  near(hexLc('#ffffff', '#000000'), -107.88, 0.1);
  assert.equal(hexLc('#777777', '#777777'), 0, 'the same colour has no contrast');
});

test('parseHex reads short and long forms and refuses anything else', () => {
  assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex('#ECC98A'), { r: 236, g: 201, b: 138 });
  assert.equal(parseHex('white'), null);
  assert.equal(parseHex(null), null);
});

test('each text zone is measured from its own band of the frame', () => {
  // White top quarter, black below: the top banner zone is bright, the stanza zone mixed, the lower third dark.
  const profile = analyzePixels(frame((_x, y) => (y < 16 ? [255, 255, 255] : [0, 0, 0])), SAMPLE_SIZE, SAMPLE_SIZE);
  assert.ok(profile.zones.top.wcag.mean > 0.6, 'top is mostly white');
  assert.equal(profile.zones.lower.wcag.p90, 0, 'lower third is black');
  assert.ok(profile.zones.center.wcag.p10 === 0 && profile.zones.center.wcag.p90 === 0, 'stanza zone starts below the white band edge for 90% of its pixels');
  assert.equal(profile.frames, 1);
});

test('the bright end of a zone is what light text is judged against', () => {
  // Mostly black with 20% white specks: the average is dark but the specks make white text hard to read.
  const speckled = analyzePixels(frame((x, y) => ((x + y * 3) % 5 === 0 ? [255, 255, 255] : [0, 0, 0])), SAMPLE_SIZE, SAMPLE_SIZE);
  const white = { r: 255, g: 255, b: 255 };
  assert.ok(speckled.zones.center.wcag.mean < 0.3);
  assert.ok(!zoneContrast(speckled.zones.center, white, 0).passes, 'judged on the specks, not the average');
  assert.ok(speckled.zones.center.wcag.std > 0.3, 'and it reads as busy');
});

test('transparent pixels count as black', () => {
  const profile = analyzePixels(frame(() => [255, 255, 255, 0]), SAMPLE_SIZE, SAMPLE_SIZE);
  assert.equal(profile.zones.center.wcag.p90, 0);
});

test('a dark background keeps the lightest shade and the usual shadow', () => {
  const plan = legibilityPlan(analyzePixels(solid(20), SAMPLE_SIZE, SAMPLE_SIZE), null);
  assert.deepEqual(plan.scrim, { top: SCRIM_MIN, center: SCRIM_MIN, lower: SCRIM_MIN });
  assert.deepEqual(plan.shadow, LEGACY_SHADOW);
  assert.equal(plan.boosted, false);
  assert.ok(plan.contrast.center.passes);
});

test('a bright background gets a darker shade, and text then passes both thresholds', () => {
  const plan = legibilityPlan(analyzePixels(solid(170), SAMPLE_SIZE, SAMPLE_SIZE), '#ffffff');
  assert.ok(plan.scrim.center > SCRIM_MIN && plan.scrim.center <= SCRIM_MAX);
  assert.ok(plan.contrast.center.passes);
  assert.ok(plan.contrast.center.ratio >= WCAG_MIN_RATIO && Math.abs(plan.contrast.center.lc) >= APCA_MIN_LC);
  assert.equal(plan.boosted, true);
  // The lightest shade that passes: one step lighter must fail.
  const lighter = zoneContrast(analyzePixels(solid(170), SAMPLE_SIZE, SAMPLE_SIZE).zones.center, { r: 255, g: 255, b: 255 }, plan.scrim.center - 0.05);
  assert.equal(lighter.passes, false);
});

test('white text over a white picture needs a strong shade, and passes under it', () => {
  const plan = legibilityPlan(analyzePixels(solid(255), SAMPLE_SIZE, SAMPLE_SIZE), '#ffffff');
  assert.ok(plan.scrim.center >= 0.5 && plan.scrim.center < SCRIM_MAX, `shade ${plan.scrim.center}`);
  assert.ok(plan.contrast.center.passes);
});

test('a busy picture gets a stronger shadow even when the shade fixes its contrast', () => {
  const stripes = analyzePixels(frame((x) => (x % 2 ? [255, 255, 255] : [0, 0, 0])), SAMPLE_SIZE, SAMPLE_SIZE);
  const plan = legibilityPlan(stripes, '#ffffff');
  assert.ok(plan.contrast.center.passes);
  assert.ok(plan.shadow.blurPx > LEGACY_SHADOW.blurPx);
});

test('when a 75% shade is still not enough, the shadow and outline make up the rest', () => {
  // Light grey text is still lighter than a shaded white picture, but cannot reach Lc 60 over it even under a 75% shade.
  const plan = legibilityPlan(analyzePixels(solid(255), SAMPLE_SIZE, SAMPLE_SIZE), '#b4b4b4');
  assert.equal(plan.scrim.center, SCRIM_MAX);
  assert.equal(plan.contrast.center.passes, false);
  assert.ok(plan.shadow.blurPx > LEGACY_SHADOW.blurPx);
  assert.ok(plan.shadow.strokeAlpha > 0);
  assert.ok(plan.shadow.alpha >= LEGACY_SHADOW.alpha && plan.shadow.alpha <= 1);
});

test('only the zone that needs it is shaded more', () => {
  // Bright sky across the top, dark below.
  const plan = legibilityPlan(analyzePixels(frame((_x, y) => (y < 14 ? [235, 235, 240] : [15, 15, 20])), SAMPLE_SIZE, SAMPLE_SIZE), '#ffffff');
  assert.ok(plan.scrim.top > plan.scrim.lower);
  assert.equal(plan.scrim.lower, SCRIM_MIN);
});

test('dark text is judged against the dark end of the picture', () => {
  const light = analyzePixels(solid(245), SAMPLE_SIZE, SAMPLE_SIZE);
  const plan = legibilityPlan(light, '#111111');
  assert.ok(plan.contrast.center.lc > 0, 'positive Lc: dark text on a light background');
  // A black shade would only make dark text harder to read, so it is not darkened past the lightest shade, and no black shadow is added.
  assert.deepEqual(plan.scrim, { top: SCRIM_MIN, center: SCRIM_MIN, lower: SCRIM_MIN });
  assert.deepEqual(plan.shadow, LEGACY_SHADOW);
  // With no shade at all, it passes easily.
  assert.ok(zoneContrast(light.zones.center, { r: 17, g: 17, b: 17 }, 0).passes);
});

test('a video keeps the worst of its sampled frames', () => {
  const dark = analyzePixels(solid(10), SAMPLE_SIZE, SAMPLE_SIZE);
  const bright = analyzePixels(solid(230), SAMPLE_SIZE, SAMPLE_SIZE);
  const merged = mergeProfiles([dark, bright]);
  assert.equal(merged.frames, 2);
  assert.equal(merged.zones.center.wcag.p90, bright.zones.center.wcag.p90);
  assert.equal(merged.zones.center.wcag.p10, dark.zones.center.wcag.p10);
  assert.equal(mergeProfiles([]), null);
});

test('measuring a 64 x 64 frame and choosing its look takes well under 2 ms', () => {
  const busy = frame((x, y) => [(x * 37 + y * 11) % 256, (x * 13 + y * 29) % 256, (x * 7 + y * 53) % 256]);
  for (let i = 0; i < 20; i++) legibilityPlan(analyzePixels(busy, SAMPLE_SIZE, SAMPLE_SIZE), null); // warm up the JIT
  const runs = 200;
  const start = performance.now();
  for (let i = 0; i < runs; i++) legibilityPlan(analyzePixels(busy, SAMPLE_SIZE, SAMPLE_SIZE), null);
  const perRun = (performance.now() - start) / runs;
  assert.ok(perRun < 2, `took ${perRun.toFixed(3)} ms per frame`);
});

test('auto-legibility is on by default, and its settings are kept only when valid', async () => {
  const { PROJECTOR_SETTINGS_DEFAULTS, sanitizeProjectorSettings } = await import('./projector-settings.js');
  assert.equal(PROJECTOR_SETTINGS_DEFAULTS.autoLegibility, true);
  assert.equal(PROJECTOR_SETTINGS_DEFAULTS.manualShade, 0.4);
  const saved = sanitizeProjectorSettings({ autoLegibility: false, manualShade: 0.62 });
  assert.equal(saved.autoLegibility, false);
  assert.equal(saved.manualShade, 0.6, 'rounded to the slider step');
  const junk = sanitizeProjectorSettings({ autoLegibility: 'yes', manualShade: 'dark' });
  assert.equal(junk.autoLegibility, true);
  assert.equal(junk.manualShade, 0.4);
  assert.equal(sanitizeProjectorSettings({ manualShade: 3 }).manualShade, 1);
  assert.deepEqual(Object.keys(sanitizeProjectorSettings({})).sort(), Object.keys(PROJECTOR_SETTINGS_DEFAULTS).sort(), 'every default is sanitised');
});
