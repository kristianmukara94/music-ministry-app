// The welcome carousel, the pre-service countdown and the typography choices: how they are saved, migrated from a config saved before
// they existed, and timed. The projector and the settings preview both draw from these helpers. Run with: node --test shared/welcome-carousel.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COUNTDOWN_DEFAULTS,
  WELCOME_DEFAULTS,
  WELCOME_SLIDES_MAX,
  carouselPosition,
  countdownRemainingMs,
  formatCountdown,
  sanitizeWelcomeSettings,
} from './welcome-settings.js';
import { liveReducer, initialLiveState } from './live.js';
import { presentFrame } from './remote-view.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const slide = (dwell, extra = {}) => ({ id: `s${Math.random()}`, type: 'TEXT', text: 'x', title: '', imageUrl: null, dwell, ...extra });

test('a config saved before the carousel becomes one slide, keeping its message or picture, and its serif typeface', () => {
  const text = sanitizeWelcomeSettings({ welcomeType: 'TEXT', message: 'Maayong Buntag', textColor: '#FFFFFF' });
  assert.equal(text.slides.length, 1);
  assert.deepEqual({ type: text.slides[0].type, text: text.slides[0].text }, { type: 'TEXT', text: 'Maayong Buntag' });
  assert.equal(text.fontFamily, 'CLASSIC', 'an existing welcome screen keeps the look it had');

  const image = sanitizeWelcomeSettings({ welcomeType: 'IMAGE', imageUrl: 'apcc-media://media/4' });
  assert.deepEqual({ type: image.slides[0].type, imageUrl: image.slides[0].imageUrl }, { type: 'IMAGE', imageUrl: 'apcc-media://media/4' });
});

test('a new install starts with one text slide, Inter, no shadow, no scrim and the countdown off', () => {
  const fresh = sanitizeWelcomeSettings(undefined);
  assert.equal(fresh.slides.length, 1);
  assert.equal(fresh.fontFamily, 'INTER');
  assert.equal(fresh.textShadow, 'NONE');
  assert.equal(fresh.scrim, 0);
  assert.deepEqual(fresh.countdown, COUNTDOWN_DEFAULTS);
  assert.deepEqual(sanitizeWelcomeSettings(WELCOME_DEFAULTS), WELCOME_DEFAULTS, 'the defaults survive a save and reload');
});

test('slides keep only known kinds and fields, have unique ids, and are capped', () => {
  const out = sanitizeWelcomeSettings({
    slides: [
      { id: 'a', type: 'ANNOUNCEMENT', title: 'Fiesta', text: 'Sunday', dwell: 15, imageUrl: 'file://evil.png' },
      { id: 'a', type: 'IMAGE', imageUrl: 'apcc-media://media/9', dwell: 7 },
      { type: 'VIDEO' },
      null,
    ],
  }).slides;
  assert.equal(out.length, 2);
  assert.equal(out[0].imageUrl, null, 'only library media is allowed');
  assert.notEqual(out[0].id, out[1].id);
  assert.equal(out[1].dwell, 10, 'an unknown dwell falls back to 10 s');
  const many = sanitizeWelcomeSettings({ slides: Array.from({ length: 40 }, () => slide(5)) }).slides;
  assert.equal(many.length, WELCOME_SLIDES_MAX);
  assert.deepEqual(sanitizeWelcomeSettings({ slides: [] }).slides, [], 'an emptied queue stays empty');
});

test('the scrim is clamped to 0 to 80, and unknown fonts, shadows and countdown values fall back', () => {
  assert.equal(sanitizeWelcomeSettings({ scrim: 95 }).scrim, 80);
  assert.equal(sanitizeWelcomeSettings({ scrim: -4 }).scrim, 0);
  assert.equal(sanitizeWelcomeSettings({ fontFamily: 'Comic' }).fontFamily, 'CLASSIC');
  assert.equal(sanitizeWelcomeSettings({ textShadow: 'GLOW' }).textShadow, 'NONE');
  const c = sanitizeWelcomeSettings({ countdown: { enabled: true, mode: 'X', targetTime: '25:00', durationSec: 1, onZero: 'BOOM' } }).countdown;
  assert.deepEqual(
    { enabled: c.enabled, mode: c.mode, targetTime: c.targetTime, durationSec: c.durationSec, onZero: c.onZero },
    { enabled: true, mode: 'DURATION', targetTime: '08:00', durationSec: 10, onZero: 'HOLD' },
  );
});

test('timed slides take turns in order and wrap round', () => {
  const slides = [slide(5), slide(10), slide(15)];
  assert.deepEqual(carouselPosition(slides, 0, 0), { index: 0, remainingMs: 5000 });
  assert.equal(carouselPosition(slides, 0, 4999).index, 0);
  assert.equal(carouselPosition(slides, 0, 5000).index, 1);
  assert.equal(carouselPosition(slides, 0, 15000).index, 2);
  assert.equal(carouselPosition(slides, 0, 30000).index, 0, 'after a full turn it starts again');
  assert.equal(carouselPosition(slides, 0, 30000 * 1000 + 6000).index, 1, 'hours later it is still in step');
  assert.equal(carouselPosition(slides, 2, 15000).index, 0, 'a step from the operator starts the timing from that slide');
});

test('a Manual Step slide holds the carousel until the operator moves it on', () => {
  const slides = [slide(5), slide(0), slide(5)];
  assert.deepEqual(carouselPosition(slides, 0, 60000), { index: 1, remainingMs: null });
  assert.equal(carouselPosition(slides, 2, 4000).index, 2, 'after the step the next slide runs on its timer');
  assert.equal(carouselPosition(slides, 2, 6000).index, 0);
  assert.deepEqual(carouselPosition([slide(5)], 0, 99999), { index: 0, remainingMs: null }, 'a lone slide never moves');
  assert.deepEqual(carouselPosition([], 0, 0), { index: -1, remainingMs: null });
});

test('a countdown duration counts from when the welcome screen went up, and stops at zero', () => {
  const c = { ...COUNTDOWN_DEFAULTS, enabled: true, mode: 'DURATION', durationSec: 300 };
  assert.equal(countdownRemainingMs(c, 1000, 1000), 300000);
  assert.equal(formatCountdown(countdownRemainingMs(c, 1000, 1000)), '05:00');
  assert.equal(formatCountdown(countdownRemainingMs(c, 1000 + 299500, 1000)), '00:01', 'the last half second still reads 00:01');
  assert.equal(countdownRemainingMs(c, 1000 + 400000, 1000), 0);
  assert.equal(countdownRemainingMs({ ...c, enabled: false }, 0, 0), null, 'off shows nothing');
  assert.equal(formatCountdown(3725000), '1:02:05');
});

test('a target start time counts down to that time today', () => {
  const c = { ...COUNTDOWN_DEFAULTS, enabled: true, mode: 'TARGET', targetTime: '08:00' };
  const at = (h, m, s = 0) => new Date(2026, 10, 15, h, m, s).getTime();
  assert.equal(formatCountdown(countdownRemainingMs(c, at(7, 50), 0)), '10:00');
  assert.equal(countdownRemainingMs(c, at(8, 0), 0), 0);
  assert.equal(countdownRemainingMs(c, at(9, 30), 0), 0, 'a time already past reads zero');
});

test('stepping the live welcome frame moves its slide and keeps the countdown start', () => {
  let s = initialLiveState();
  s = liveReducer(s, { type: 'projector/show', frame: { kind: 'welcome', lang: 'en', shownAt: 100, slide: 0, slideAt: 100 }, source: 'DIRECT_DECK' });
  s = liveReducer(s, { type: 'projector/show', frame: { kind: 'welcome', lang: 'en', shownAt: 100, slide: 1, slideAt: 900 } });
  assert.equal(s.projector.live.kind, 'welcome');
  assert.equal(s.projector.live.slide, 1);
  assert.equal(s.projector.live.shownAt, 100);
});

test('the remote view reads the slide the operator stepped to', () => {
  const welcome = sanitizeWelcomeSettings({
    slides: [
      { id: 'a', type: 'TEXT', text: 'Welcome', dwell: 10 },
      { id: 'b', type: 'ANNOUNCEMENT', title: 'Fiesta', text: 'Sunday 9 AM', dwell: 0 },
    ],
  });
  assert.deepEqual(presentFrame({ kind: 'welcome', lang: 'en' }, welcome).lines, ['Welcome']);
  assert.deepEqual(presentFrame({ kind: 'welcome', lang: 'en', slide: 1 }, welcome).lines, ['Fiesta', 'Sunday 9 AM']);
});

test('the projector and the settings preview draw the same canvas, and the operator has a Next Welcome Slide control', () => {
  const settings = read('src/settings/WelcomeScreenSettings.tsx');
  assert.match(settings, /<WelcomeCanvas settings=\{settings\} anchor=\{anchor\}/);
  assert.match(read('src/output/WelcomeScreen.tsx'), /export function WelcomeFrame[\s\S]*<WelcomeCanvas settings=\{welcome\} anchor=/);
  assert.match(read('src/operator/TopBar.tsx'), /stepWelcomeSlide/);
});

test('the welcome stepper is labelled Next Welcome Slide and sits inside the Welcome Screen capsule, never as a loose button', () => {
  const strings = read('src/i18n/strings.ts');
  assert.match(strings, /'top\.welcomeNext': 'Next Welcome Slide'/);
  assert.doesNotMatch(strings, /'top\.welcomeNext': 'Next Slide'/, 'the old label read like the Holy Mass Next Slide');
  assert.match(strings, /'top\.tipWelcomeNext': 'Advance Welcome Screen slide \(does not advance Holy Mass queue\)'/);

  const bar = read('src/operator/TopBar.tsx');
  // The compound capsule holds both the Welcome Screen toggle and the stepper, and the stepper only appears with two or more slides.
  const capsule = bar.slice(bar.indexOf('data-testid="welcome-compound"'));
  assert.ok(bar.includes('data-testid="welcome-compound"'), 'the Welcome Screen capsule exists');
  const stepper = capsule.indexOf('onClick={stepWelcomeSlide}');
  assert.ok(stepper > 0 && stepper < capsule.indexOf('</div>'), 'the stepper is inside the capsule');
  assert.match(bar, /const stepper = position !== null && position\.count > 1;/);
  assert.match(capsule, /\{stepper && \(/);
  assert.match(bar, /position\.index \+ 1\}\/\$\{position\.count/, 'the stepper shows a slide counter');
  assert.match(capsule, /{counter}/, 'and the counter is drawn inside the capsule');
  // stepWelcomeSlide is wired nowhere else in the top bar.
  assert.equal(bar.split('stepWelcomeSlide}').length - 1, 1);
});

test('the welcome slide counter reads the same position the projector draws', async () => {
  const { carouselPosition } = await import('./welcome-settings.js');
  const slides = [
    { id: 'a', dwell: 10 },
    { id: 'b', dwell: 0 },
    { id: 'c', dwell: 5 },
  ];
  // After a manual step to slide 2 the counter must read 2, however long the operator waits on a Manual Step slide.
  assert.equal(carouselPosition(slides, 1, 60_000).index, 1);
  assert.equal(carouselPosition(slides, 0, 11_000).index, 1);
  assert.equal(carouselPosition(slides, 2, 4_000).remainingMs, 1_000);
});
