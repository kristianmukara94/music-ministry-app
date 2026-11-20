// Media Studio: the non-destructive edit model, its CSS compiler, presets, trim rules, the background restyle action, the renderer wiring
// and the EN/TL/CEB labels. Fixtures are synthetic. Run with: node --test shared/media-editor.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MEDIA_EDIT_SETTINGS,
  MEDIA_GRADE_PRESETS,
  MEDIA_EDIT_RANGES,
  LOOK_KEYS,
  applyMediaPreset,
  buildMediaFilterCss,
  buildMediaOverlays,
  buildMediaTransformCss,
  cropForAspect,
  fadeOpacityAt,
  formatTimecode,
  hasActiveMediaEdits,
  matchingPreset,
  mediaTransformParts,
  normalizeMediaEditSettings,
  parseMediaEditSettings,
  resolveTrimWindow,
  serializeMediaEditSettings,
  trimPlaybackAction,
  usesNativeLoop,
} from './media-editor.js';
import { MEDIA_LANGS, MEDIA_STRINGS, mediaT } from './media-i18n.js';
import { initialLiveState, liveReducer } from './live.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const edit = (patch) => normalizeMediaEditSettings({ ...DEFAULT_MEDIA_EDIT_SETTINGS, ...patch });

// ---- The model ---------------------------------------------------------------------------------------------------------------------------

test('neutral settings are the documented defaults, and an unedited item has no active edits', () => {
  const d = DEFAULT_MEDIA_EDIT_SETTINGS;
  assert.equal(d.aspectRatio, '16:9');
  assert.equal(d.fitMode, 'cover');
  assert.deepEqual(d.crop, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(d.zoom, 1);
  assert.equal(d.saturation, 100);
  assert.equal(d.tintColor, '#000000');
  assert.equal(d.tintBlendMode, 'multiply');
  assert.equal(d.trimEnd, null);
  assert.equal(d.playbackSpeed, 1);
  assert.equal(d.volume, 0, 'motion backgrounds are muted by default');
  assert.equal(hasActiveMediaEdits(d), false);
  assert.equal(hasActiveMediaEdits(null), false);
  assert.equal(hasActiveMediaEdits({ edit: d }), false, 'also accepts a library item carrying `edit`');
  assert.equal(hasActiveMediaEdits({ edit: edit({ blur: 4 }) }), true);
});

test('a NULL, empty or broken column loads as the neutral look', () => {
  for (const raw of [null, undefined, '', '{not json', '[]', '42']) {
    assert.deepEqual(parseMediaEditSettings(raw), normalizeMediaEditSettings(null), String(raw));
  }
  assert.equal(serializeMediaEditSettings(DEFAULT_MEDIA_EDIT_SETTINGS), null, 'nothing changed: the column stays NULL');
  assert.equal(serializeMediaEditSettings({ aspectRatio: '1:1' }), null, 'the crop lock alone is not an edit');
  const stored = serializeMediaEditSettings({ brightness: 10 });
  assert.equal(JSON.parse(stored).brightness, 10);
  assert.deepEqual(parseMediaEditSettings(stored), edit({ brightness: 10 }), 'round trip');
});

test('numbers are clamped to their slider range and step, and junk falls back to neutral', () => {
  const s = normalizeMediaEditSettings({
    zoom: 9, panX: -80, rotate: 200, brightness: '12', contrast: 'loud', saturation: -5, blur: 30, vignette: 101,
    tintColor: 'purple', tintOpacity: 95, tintBlendMode: 'difference', playbackSpeed: 0.1, volume: 150, fadeInSec: 5, fitMode: 'stretch', aspectRatio: '21:9',
  });
  assert.equal(s.zoom, 3);
  assert.equal(s.panX, -50);
  assert.equal(s.rotate, 180);
  assert.equal(s.brightness, 12, 'numeric strings are read');
  assert.equal(s.contrast, 0, 'junk is neutral');
  assert.equal(s.saturation, 0);
  assert.equal(s.blur, 24);
  assert.equal(s.vignette, 100);
  assert.equal(s.tintColor, '#000000');
  assert.equal(s.tintOpacity, 80);
  assert.equal(s.tintBlendMode, 'multiply');
  assert.equal(s.playbackSpeed, 0.25);
  assert.equal(s.volume, 100);
  assert.equal(s.fadeInSec, 3);
  assert.equal(s.fitMode, 'cover');
  assert.equal(s.aspectRatio, '16:9');
  assert.equal(normalizeMediaEditSettings({ zoom: 1.234 }).zoom, 1.25, 'zoom snaps to 0.05');
  assert.equal(normalizeMediaEditSettings({ playbackSpeed: 1.33 }).playbackSpeed, 1.35, 'speed snaps to 0.05');
  for (const [key, r] of Object.entries(MEDIA_EDIT_RANGES)) {
    assert.ok(r.min <= DEFAULT_MEDIA_EDIT_SETTINGS[key] && DEFAULT_MEDIA_EDIT_SETTINGS[key] <= r.max, `${key} default is in range`);
  }
});

test('a crop stays inside the frame and never shrinks below the minimum', () => {
  const s = normalizeMediaEditSettings({ crop: { x: 0.9, y: -1, width: 0.5, height: 0.001 } });
  assert.equal(s.crop.width, 0.5);
  assert.equal(s.crop.x, 0.5, 'pulled back so the right edge is inside');
  assert.equal(s.crop.y, 0);
  assert.equal(s.crop.height, 0.05);
});

// ---- CSS compiler ------------------------------------------------------------------------------------------------------------------------

test('unedited settings compile to identity filter and transform', () => {
  assert.equal(buildMediaFilterCss(DEFAULT_MEDIA_EDIT_SETTINGS), 'none');
  assert.equal(buildMediaTransformCss(DEFAULT_MEDIA_EDIT_SETTINGS), 'none');
  assert.equal(buildMediaFilterCss(null), 'none');
  assert.deepEqual(buildMediaOverlays(DEFAULT_MEDIA_EDIT_SETTINGS), []);
  assert.equal(buildMediaFilterCss({ tintColor: '#ff0000' }), 'none', 'a tint at 0% draws nothing');
});

test('the filter chain is built in a fixed order with exact values', () => {
  const css = buildMediaFilterCss(edit({ brightness: -30, contrast: 20, saturation: 150, warmth: 25, hueRotate: -45, blur: 6 }));
  assert.equal(css, 'brightness(0.7) contrast(1.2) saturate(1.5) sepia(0.1) hue-rotate(-45deg) blur(6px)');
  assert.equal(buildMediaFilterCss(edit({ blur: 12 }), { scale: 0.5 }), 'blur(6px)', 'blur follows the drawn width');
  assert.equal(buildMediaFilterCss(edit({ warmth: -30 })), 'none', 'a cool shift is a wash layer, not sepia');
  assert.equal(buildMediaFilterCss(edit({ saturation: 0 })), 'saturate(0)');
});

test('overlays stack warmth, tint, then vignette', () => {
  const layers = buildMediaOverlays(edit({ warmth: -20, tintColor: '#5B2A86', tintOpacity: 40, tintBlendMode: 'overlay', vignette: 60 }));
  assert.deepEqual(layers.map((l) => l.kind), ['warmth', 'tint', 'vignette']);
  assert.equal(layers[0].blendMode, 'soft-light');
  assert.equal(layers[0].color, '#2e7dff', 'cool is blue');
  assert.deepEqual([layers[1].color, layers[1].opacity, layers[1].blendMode], ['#5b2a86', 0.4, 'overlay']);
  assert.match(layers[2].background, /^radial-gradient\(ellipse at center, rgba\(0,0,0,0\) 45%, rgba\(0,0,0,0\.51\) 100%\)$/);
  assert.equal(layers[2].inner, 45);
});

test('the transform scales a crop to fill the frame and moves its centre to the middle', () => {
  // The right half at full height: the crop is always shown whole, and its height already fills the frame, so it only moves left.
  const half = edit({ crop: { x: 0.5, y: 0, width: 0.5, height: 1 } });
  assert.deepEqual(mediaTransformParts(half), { translateX: -25, translateY: 0, scale: 1, rotate: 0, flipX: 1, flipY: 1 });
  const quarter = edit({ crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } });
  assert.equal(buildMediaTransformCss(quarter), 'translate(-50%, -50%) scale(2)');
  assert.equal(buildMediaTransformCss(edit({ zoom: 1.5, panX: 10, panY: -5 })), 'translate(10%, -5%) scale(1.5)');
  assert.equal(buildMediaTransformCss(edit({ rotate: 90, flipH: true })), 'rotate(90deg) scale(-1, 1)');
  // A flip keeps framing the same part of the picture: the crop centre is mirrored before it is moved.
  assert.equal(mediaTransformParts(edit({ crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, flipH: true })).translateX, 50);
});

test('an aspect-locked crop has the ratio in projector pixels and stays centred', () => {
  const sq = cropForAspect({ x: 0, y: 0, width: 1, height: 1 }, '1:1', 16 / 9);
  assert.equal(sq.height, 1);
  assert.equal(sq.width, 0.5625, 'a square is 9/16 of a 16:9 frame wide');
  assert.equal(sq.x, 0.21875);
  const wide = cropForAspect({ x: 0, y: 0, width: 1, height: 1 }, '16:9', 16 / 9);
  assert.deepEqual(wide, { x: 0, y: 0, width: 1, height: 1 });
  const tall = cropForAspect({ x: 0, y: 0, width: 1, height: 1 }, '9:16', 16 / 9);
  assert.ok(Math.abs(tall.width / tall.height - (9 / 16) / (16 / 9)) < 1e-4);
  assert.deepEqual(cropForAspect({ x: 0.1, y: 0.1, width: 0.3, height: 0.7 }, 'free'), { x: 0.1, y: 0.1, width: 0.3, height: 0.7 });
});

// ---- Presets -----------------------------------------------------------------------------------------------------------------------------

test('every preset applies valid, non-destructive settings', () => {
  assert.deepEqual(
    MEDIA_GRADE_PRESETS.map((p) => p.id),
    ['original', 'softLyric', 'worshipWarm', 'vibrantGlory', 'crispMono', 'adventPurple', 'ordinaryGreen', 'solemnityGold', 'pentecostFlame'],
  );
  const framed = edit({ crop: { x: 0.25, y: 0, width: 0.5, height: 0.5 }, zoom: 1.5, rotate: 10, trimStart: 2, trimEnd: 8, playbackSpeed: 0.75 });
  for (const preset of MEDIA_GRADE_PRESETS) {
    const out = applyMediaPreset(framed, preset.id);
    assert.deepEqual(out, normalizeMediaEditSettings(out), `${preset.id} is already normal`);
    for (const key of Object.keys(preset.settings)) assert.ok(LOOK_KEYS.includes(key), `${preset.id} only sets look fields (${key})`);
    // Framing and trim are the operator's; a preset never touches them.
    for (const key of ['crop', 'zoom', 'rotate', 'trimStart', 'trimEnd', 'playbackSpeed']) assert.deepEqual(out[key], framed[key], `${preset.id} keeps ${key}`);
    assert.equal(matchingPreset(out), preset.id, `${preset.id} is recognised as active`);
    assert.equal(hasActiveMediaEdits(applyMediaPreset(DEFAULT_MEDIA_EDIT_SETTINGS, preset.id)), preset.id !== 'original', `${preset.id} on an unedited item`);
  }
  const soft = applyMediaPreset(DEFAULT_MEDIA_EDIT_SETTINGS, 'softLyric');
  assert.ok(soft.blur > 0 && soft.vignette > 0 && soft.brightness === -30, 'subtle blur, vignette and a 30% dim');
  assert.equal(applyMediaPreset(applyMediaPreset(DEFAULT_MEDIA_EDIT_SETTINGS, 'adventPurple'), 'crispMono').tintOpacity, 0, 'presets replace, never stack');
  assert.deepEqual(applyMediaPreset(framed, 'no-such-preset'), framed);
});

// ---- Video trim --------------------------------------------------------------------------------------------------------------------------

test('trim boundaries are kept in order and inside the clip', () => {
  assert.deepEqual(normalizeMediaEditSettings({ trimStart: -3, trimEnd: 'x' }).trimStart, 0);
  const swapped = normalizeMediaEditSettings({ trimStart: 5, trimEnd: 2 });
  assert.equal(swapped.trimEnd, 5.1, 'an out point before the in point moves just after it');
  const capped = normalizeMediaEditSettings({ trimStart: 50, trimEnd: 60 }, 20);
  assert.equal(capped.trimStart, 19.9, 'the in point stays inside a 20 s clip');
  assert.equal(capped.trimEnd, null, 'an out point at or past the end is the natural end');
  assert.deepEqual(resolveTrimWindow({ trimStart: 2, trimEnd: 8 }, 20), { start: 2, end: 8 });
  assert.deepEqual(resolveTrimWindow({ trimStart: 2 }, 20), { start: 2, end: 20 });
  assert.equal(resolveTrimWindow({}, undefined).end, Infinity);
});

test('a trimmed background seeks to the in point and loops at the out point', () => {
  const s = edit({ trimStart: 2, trimEnd: 8 });
  assert.equal(trimPlaybackAction(0, s, 20), 'seek-start', 'before the in point: go there');
  assert.equal(trimPlaybackAction(5, s, 20), 'none');
  assert.equal(trimPlaybackAction(7.97, s, 20, 'loop'), 'seek-start', 'just before the out point: loop back');
  assert.equal(trimPlaybackAction(8.5, s, 20, 'once'), 'end', 'play once ends at the out point');
  assert.equal(trimPlaybackAction(8.5, s, 20, 'hold'), 'end');
  assert.equal(trimPlaybackAction(19, edit({}), 20), 'none', 'untrimmed clips are left to the browser');
  assert.equal(usesNativeLoop(edit({})), true);
  assert.equal(usesNativeLoop(edit({ trimStart: 1 })), false);
  assert.equal(usesNativeLoop(edit({ fadeOutSec: 1 })), false);
  assert.equal(usesNativeLoop(edit({}), 'once'), false);
});

test('fades ramp opacity in after the in point and out before the out point', () => {
  const s = edit({ trimStart: 2, trimEnd: 10, fadeInSec: 1, fadeOutSec: 2 });
  assert.equal(fadeOpacityAt(2, s, 20), 0);
  assert.equal(fadeOpacityAt(2.5, s, 20), 0.5);
  assert.equal(fadeOpacityAt(5, s, 20), 1);
  assert.equal(fadeOpacityAt(9, s, 20), 0.5);
  assert.equal(fadeOpacityAt(10, s, 20), 0);
  assert.equal(fadeOpacityAt(5, edit({}), 20), 1);
});

test('timecodes read MM:SS.d', () => {
  assert.equal(formatTimecode(0), '00:00.0');
  assert.equal(formatTimecode(7.25), '00:07.2');
  assert.equal(formatTimecode(83.99), '01:23.9');
  assert.equal(formatTimecode(-1), '00:00.0');
});

// ---- Live state: a Studio save restyles the staged/live showing --------------------------------------------------------------------

test('background/restyle updates only frames of that file and keeps the showing', () => {
  const backdrop = { kind: 'media', mediaType: 'video', src: 'apcc-media://media/7', title: 'Sample Motion Backdrop', playback: 'once', cue: 42 };
  const other = { kind: 'media', mediaType: 'image', src: 'apcc-media://media/8', title: 'Sample Still Image' };
  let s = liveReducer(initialLiveState(), { type: 'background/stage', media: backdrop });
  s = liveReducer(s, { type: 'background/take' });
  s = liveReducer(s, { type: 'background/stage', media: other });
  const grade = edit({ blur: 8 });
  const next = liveReducer(s, { type: 'background/restyle', src: backdrop.src, edit: grade });
  assert.deepEqual(next.projector.background.live, { ...backdrop, edit: grade }, 'cue and playback kept, so the clip does not restart');
  assert.equal(next.projector.background.staged, s.projector.background.staged, 'another file is untouched');
  const cleared = liveReducer(next, { type: 'background/restyle', src: backdrop.src, edit: null });
  assert.equal('edit' in cleared.projector.background.live, false, 'reset removes the edit');
  assert.equal(liveReducer(s, { type: 'background/restyle', src: 'apcc-media://media/99', edit: grade }), s, 'nothing on screen: no change');
});

// ---- Renderer wiring (source checks) -------------------------------------------------------------------------------------------------

test('every background surface draws through the shared EditedMediaRenderer', () => {
  const projector = read('src/output/ProjectorView.tsx');
  const layer = projector.slice(projector.indexOf('function BackgroundLayer('), projector.indexOf('const ENTER_ANIMATION'));
  assert.match(layer, /<EditedMediaRenderer/);
  assert.match(layer, /edit=\{media\.edit \?\? null\}/);
  assert.match(projector, /audible=\{!mirror && !embedded\}/, 'only the congregation projector plays sound');
  const view = read('src/media/MediaView.tsx');
  assert.match(view, /<EditedMediaRenderer[\s\S]*?edit=\{edit\}/, 'the stage preview');
  assert.match(view, /<MediaStudioModal /);
  const renderer = read('src/media/EditedMediaRenderer.tsx');
  assert.match(renderer, /buildMediaFilterCss/);
  assert.match(renderer, /buildMediaTransformCss/);
  assert.match(renderer, /trimPlaybackAction/);
  assert.match(renderer, /resolveTrimWindow\(edit, video\.duration\)/, 'seeks to the in point on load');
  for (const file of ['src/planner/routing.ts', 'src/rosary/RosaryDeck.tsx']) {
    assert.match(read(file), /assetFrame\(asset\)/, `${file} stages frames that carry the edits`);
  }
  const studio = read('src/media/MediaStudioModal.tsx');
  assert.match(studio, /createPortal\(/, 'the Studio is portalled to <body>');
  for (const call of ['saveEditSettings', 'saveEditedCopy', 'updateThumbnail']) assert.match(studio, new RegExp(`api\\.${call}\\(`));
});

// ---- Studio layout (source checks) ----------------------------------------------------------------------------------------------------

const has = (text, needle, message) => assert.ok(text.includes(needle), message ?? `expected: ${needle}`);
const lacks = (text, needle, message) => assert.ok(!text.includes(needle), message ?? `unexpected: ${needle}`);
const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

test('the Studio clears the 48px title bar and keeps Close in an unshrinking header group', () => {
  const studio = read('src/media/MediaStudioModal.tsx');
  has(studio, "import { DRAG, NO_DRAG, TITLE_BAR_CLEARANCE } from '../components/appRegion';");
  has(read('src/components/appRegion.ts'), 'export const TITLE_BAR_CLEARANCE = 48;');
  const dialog = between(studio, 'role="dialog"', '{/* Header');
  has(dialog, 'style={{ top: TITLE_BAR_CLEARANCE, ...NO_DRAG }}', 'the dialog starts below the title bar and is never a window drag handle');
  lacks(dialog, 'inset-0', 'the dialog itself is not pinned to the window top');
  const header = between(studio, '<header', '</header>');
  has(header, 'className="no-drag flex h-13 flex-none items-center gap-3 border-b border-line-strong bg-surface px-5"');
  assert.match(header, /max-w-\[260px\][^"]*truncate/, 'a long file name cannot push Close out of view');
  has(header, 'data-studio-info');
  has(header, "data-studio-status={dirty ? 'unsaved' : 'edited'}");
  has(header, 'history.undoSteps');
  has(header, 'history.redoSteps');
  const close = between(header, 'onClick={requestClose}', 'data-studio-close');
  has(close, 'flex-none', 'Close never shrinks');
});

test('the preview is centred on a padded stage with the inspection toggles in a toolbar under it', () => {
  const studio = read('src/media/MediaStudioModal.tsx');
  has(studio, 'flex min-w-0 flex-1 flex-col bg-[#12100e]');
  has(studio, 'flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6" data-studio-stage');
  has(studio, 'const STAGE_PADDING = 24;');
  const toolbar = between(studio, 'data-studio-canvas-toolbar', '{/* Inspector */}');
  for (const key of ['ruleOfThirds', 'safeZone', 'beforeAfter', 'holdCompareShort']) has(toolbar, `t('${key}')`, `${key} is in the canvas toolbar`);
  has(toolbar, 'data-studio-readout');
  const header = between(studio, '<header', '</header>');
  for (const key of ['safeZone', 'beforeAfter', 'holdCompare']) lacks(header, `t('${key}')`, `${key} left the header`);
});

test('stills get three inspector tabs and videos four, with no disabled Trim tab', () => {
  const studio = read('src/media/MediaStudioModal.tsx');
  has(studio, "...(isVideo ? [{ id: 'trim' as const, label: t('tabTrim') }] : [])");
  has(studio, "tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'");
  lacks(studio, 'disabled={x.disabled}');
  lacks(studio, "t('trimVideoOnly')");
});

test('sliders show a readout, reset on a double-click of the label row, and mark a changed value; the active preset has a check', () => {
  const studio = read('src/media/MediaStudioModal.tsx');
  const slider = between(studio, 'function EditSlider(', 'const TOOL =');
  has(slider, 'onDoubleClick={reset} title={resetHint}', 'the label row resets');
  assert.match(slider, /text-right font-mono[^"]*tabular-nums/);
  has(slider, 'data-changed={changed || undefined}');
  const presets = between(studio, 'function PresetsTab(', 'function TrimTab(');
  has(presets, 'active === p.id && (');
  has(presets, 'data-preset-check');
});

test('the media info pill reads size and file type', () => {
  const studio = read('src/media/MediaStudioModal.tsx');
  has(studio, '`${size.w}×${size.h} · ${kind}`');
  has(studio, "mediaInfo(naturalSize, asset.filename, isVideo ? t('typeVideo') : t('typeImage'))");
});

// ---- Labels ------------------------------------------------------------------------------------------------------------------------------

const STUDIO_KEYS = [
  'editMedia', 'editInStudio', 'studioTitle', 'edited', 'tabTransform', 'tabColor', 'tabPresets', 'tabTrim', 'aspectRatio', 'aspectFree',
  'fitMode', 'fitCover', 'fitContain', 'fitFill', 'zoom', 'panX', 'panY', 'rotate', 'rotate90', 'flipH', 'flipV', 'cropFrame', 'ruleOfThirds',
  'resetCrop', 'brightness', 'contrast', 'saturation', 'warmth', 'hue', 'backdropBlur', 'vignette', 'tintColor', 'tintOpacity', 'blendMode',
  'blendNormal', 'blendMultiply', 'blendScreen', 'blendOverlay', 'sliderResetHint', 'safeZone', 'beforeAfter', 'holdCompare', 'original',
  'undo', 'redo', 'resetAll', 'cancel', 'saveAsCopy', 'saveAsCopyVideoHint', 'applySave', 'saving', 'editsSaved', 'copySaved', 'play', 'pause',
  'stepBack', 'stepForward', 'setIn', 'setOut', 'clearTrim', 'playbackSpeed', 'loopPreview', 'setThumbnail', 'thumbnailSet', 'volume',
  'fadeIn', 'fadeOut', 'trimVideoOnly', 'discardConfirm', 'sampleLyric', 'editedSpeed',
  'close', 'unsavedChanges', 'canvasTools', 'holdCompareShort', 'presetActive', 'resetToDefault',
  ...MEDIA_GRADE_PRESETS.map((p) => p.labelKey),
];

test('every Media Studio label exists in English, Tagalog and Cebuano', () => {
  assert.deepEqual([...MEDIA_LANGS], ['en', 'tl', 'ceb']);
  for (const lang of MEDIA_LANGS) {
    for (const key of STUDIO_KEYS) {
      const text = MEDIA_STRINGS[lang][key];
      assert.equal(typeof text, 'string', `${lang}.${key}`);
      assert.ok(text.trim().length > 0, `${lang}.${key} is not empty`);
    }
  }
  assert.equal(mediaT('en', 'applySave'), 'Apply & Save');
  assert.equal(mediaT('en', 'saveAsCopy'), 'Save as New Copy');
  assert.equal(mediaT('en', 'sampleLyric'), 'Sample Lyric Line');
  assert.equal(mediaT('en', 'copySaved', { name: 'Sample Still Image' }), 'Saved "Sample Still Image" as a new copy.');
  // Placeholders survive translation.
  for (const lang of MEDIA_LANGS) {
    for (const [key, text] of Object.entries(MEDIA_STRINGS.en)) {
      const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      assert.deepEqual(names(MEDIA_STRINGS[lang][key] ?? ''), names(text), `${lang}.${key} placeholders`);
    }
  }
});

test('the whole media string table is complete in every language', () => {
  const en = Object.keys(MEDIA_STRINGS.en).sort();
  for (const lang of MEDIA_LANGS) assert.deepEqual(Object.keys(MEDIA_STRINGS[lang]).sort(), en, lang);
});
