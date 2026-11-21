// The text case switch (Aa / AA / aa): applyTextCase, the projector frames and lower thirds it reaches, line balancing measured on the cased
// text, the projector setting, and the controls in Go Live and the Planners. Synthetic data only. Run with: node --test shared/text-case.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TEXT_CASES, applyFrameTextCase, applyLowerThirdCase, applyTextCase, balanceProjectorLines, textCaseOf } from './text-fit.js';
import { PROJECTOR_SETTINGS_DEFAULTS, sanitizeProjectorSettings } from './projector-settings.js';
import { lyT } from './lyrics-i18n.js';
import { plannerT } from './planner-i18n.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('applyTextCase: original, uppercase and lowercase', () => {
  assert.deepEqual([...TEXT_CASES], ['original', 'uppercase', 'lowercase']);
  const text = 'Sample Song 1\nSample line, with Mixed Case';
  assert.equal(applyTextCase(text, 'original'), text);
  assert.equal(applyTextCase(text, 'uppercase'), 'SAMPLE SONG 1\nSAMPLE LINE, WITH MIXED CASE');
  assert.equal(applyTextCase(text, 'lowercase'), 'sample song 1\nsample line, with mixed case');
  assert.equal(applyTextCase(text, 'shouting'), text, 'an unknown mode is original');
  assert.equal(applyTextCase(null, 'uppercase'), '');
  assert.equal(applyTextCase('Sample Prayer\n\n', 'uppercase').split('\n').length, 3, 'line breaks and blank lines are kept');
  assert.equal(textCaseOf(undefined), 'original');
});

test('applyFrameTextCase reaches every text the congregation reads', () => {
  const text = { kind: 'text', title: 'Sample Prayer', headline: 'Sample Prayer', text: 'Sample line', bg: null };
  assert.deepEqual(applyFrameTextCase(text, 'uppercase'), { ...text, title: 'SAMPLE PRAYER', headline: 'SAMPLE PRAYER', text: 'SAMPLE LINE' });
  const lyrics = { kind: 'lyrics', title: 'Sample Song 1', label: 'Verse 1', text: 'Sample lyric line' };
  assert.equal(applyFrameTextCase(lyrics, 'uppercase').text, 'SAMPLE LYRIC LINE');
  const deck = { kind: 'deck', title: 'Sample Scripture', slides: [[{ role: 'reader', text: 'Sample Verse' }]], index: 0 };
  assert.equal(applyFrameTextCase(deck, 'lowercase').slides[0][0].text, 'sample verse');
  const psalm = { kind: 'psalm', title: 'Sample', response: 'Sample Response', pages: ['Sample Page'], index: 0 };
  const p = applyFrameTextCase(psalm, 'uppercase');
  assert.equal(p.response, 'SAMPLE RESPONSE');
  assert.deepEqual(p.pages, ['SAMPLE PAGE']);
  const pw = { kind: 'pw', segmentName: 'Sample Segment', type: 'song', index: 0, total: 1, slide: { kind: 'lyrics', label: 'V1', chip: 'V1', text: 'Sample lyric', hymnId: 1, hymnTitle: 'Sample Song 1', sectionId: '1' } };
  const cased = applyFrameTextCase(pw, 'uppercase');
  assert.equal(cased.slide.text, 'SAMPLE LYRIC');
  assert.equal(cased.slide.chip, 'V1', 'chips and ids are not touched');
  assert.equal(applyFrameTextCase({ ...pw, slide: { kind: 'title', label: 'Sample Segment', subtitle: 'Sample Song 1' } }, 'lowercase').slide.subtitle, 'sample song 1');
  const image = { kind: 'image', title: 'Sample', src: 'x' };
  assert.equal(applyFrameTextCase(image, 'uppercase'), image, 'a picture is unchanged');
  assert.equal(applyFrameTextCase(text, 'original'), text, 'original is the same frame, so nothing re-renders');
});

test('applyLowerThirdCase: the tag and both lines', () => {
  const band = { template: 'segment', tag: 'Sample Segment', line1: 'Sample Song 1', line2: 'Sample Composer' };
  assert.deepEqual(applyLowerThirdCase(band, 'uppercase'), { template: 'segment', tag: 'SAMPLE SEGMENT', line1: 'SAMPLE SONG 1', line2: 'SAMPLE COMPOSER' });
  assert.equal(applyLowerThirdCase(band, 'original'), band);
  assert.equal(applyLowerThirdCase(null, 'uppercase'), null);
});

test('line balancing measured after the case: UPPERCASE never leaves a line wider than the slide', () => {
  // A measure where capitals are wider than small letters, as in every slide face.
  const measure = (s) => [...s].reduce((w, ch) => w + (ch === ' ' ? 5 : ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? 14 : 9), 0);
  const line = 'Sample lyric line that runs past the edge of the slide';
  const room = 300;
  for (const mode of TEXT_CASES) {
    const shown = applyTextCase(line, mode);
    const lines = balanceProjectorLines(shown, room, measure).split('\n');
    assert.ok(lines.every((l) => measure(l) <= room), `${mode}: every balanced line fits`);
    assert.equal(lines.join(' '), shown, `${mode}: the words and their case are kept`);
  }
  // Balancing the as-typed text, then capitalising it, would overflow: the reason the case is applied first.
  const naive = balanceProjectorLines(line, room, measure).split('\n').map((l) => l.toUpperCase());
  assert.ok(naive.some((l) => measure(l) > room));
});

test('the projector case is a saved setting, original by default', () => {
  assert.equal(PROJECTOR_SETTINGS_DEFAULTS.textCase, 'original');
  assert.equal(sanitizeProjectorSettings({ textCase: 'uppercase' }).textCase, 'uppercase');
  assert.equal(sanitizeProjectorSettings({ textCase: 'lowercase' }).textCase, 'lowercase');
  assert.equal(sanitizeProjectorSettings({ textCase: 'Title' }).textCase, 'original');
  assert.equal(sanitizeProjectorSettings({}).textCase, 'original');
});

test('the projector, mirror, previews and lower thirds draw the cased text before fitting and balancing', () => {
  const projector = read('src/output/ProjectorView.tsx');
  // FrameView draws every surface (projector, mirror, preview, thumbnails); the case is its first step, before any fit or balance hook.
  const frameView = projector.slice(projector.indexOf('function FrameViewBody('));
  assert.match(frameView, /^function FrameViewBody\(\{ frame: given[\s\S]*?const frame = useMemo\(\(\) => frameWithAlign\(applyFrameTextCase\(given, textCase\), align\), \[given, textCase, align\]\);/);
  assert.match(projector, /const useTextCase = \(\) => useOutput\(\(s\) => textCaseOf\(s\.settings\.textCase\)\);/);
  const lower = read('src/output/LowerThirdView.tsx');
  assert.match(lower, /const value = useMemo\(\(\) => applyLowerThirdCase\(given, textCase\), \[given, textCase\]\);/);
});

test('Live Quick Controls: Aa / AA / aa beside Balance lines and the text size, also in the P&W Go Live bar', () => {
  const controls = read('src/lyrics/LiveQuickControls.tsx');
  assert.match(controls, /<TextCaseControl t=\{t\} \/>\n\s*<BalanceLinesSwitch t=\{t\} \/>\n\s*<FontSizeStepper t=\{t\} \/>/);
  assert.match(controls, /bridge\.projector\.save\(\{ textCase: next \}\)/);
  assert.match(read('src/praise-worship/GoLiveTakeover.tsx'), /<LiveQuickControls /);
  const sw = read('src/components/TextCaseSwitch.tsx');
  assert.match(sw, /original: 'Aa', uppercase: 'AA', lowercase: 'aa'/);
  assert.match(sw, /role="radiogroup"/);
});

test('Planners: a text case selector in both toolbars, applied to the lineup and the lyrics drawers', () => {
  const mass = read('src/planner/MassPlanner.tsx');
  assert.match(mass, /<TextCaseSwitch\s+size="md"\s+value=\{textCase\}\s+onChange=\{setTextCase\}/);
  assert.match(mass, /<div className=\{caseClass\}>\n\s*<HolyMassPlan/);
  assert.match(mass, /<div className=\{`basis-full \$\{caseClass\}`\}>\n\s*<PlannerSongDrawer/);
  const pw = read('src/praise-worship/PlanView.tsx');
  assert.match(pw, /<TextCaseSwitch\s+size="md"\s+value=\{textCase\}\s+onChange=\{setTextCase\}/);
  assert.match(read('src/praise-worship/LineupRail.tsx'), /className=\{`flex min-w-0 flex-col rounded-\[10px\] border border-line bg-panel p-4 \$\{textCaseClass\(textCase\)\}`\}/);
  assert.match(read('src/praise-worship/LibrarySearchContainer.tsx'), /<div className=\{`basis-full \$\{caseClass\}`\}>\n\s*<SongLyricsPreview/);
  const store = read('src/planner/textCase.ts');
  assert.match(store, /mode === 'uppercase' \? 'uppercase' : mode === 'lowercase' \? 'lowercase' : ''/);
});

test('the text case labels are in English, Tagalog and Cebuano', () => {
  for (const key of ['textCase', 'textCaseOriginal', 'textCaseUpper', 'textCaseLower']) {
    for (const lang of ['en', 'tl', 'ceb']) {
      assert.notEqual(lyT(lang, key), key, `lyrics ${lang} ${key}`);
      assert.notEqual(plannerT(lang, key), key, `planner ${lang} ${key}`);
    }
    assert.notEqual(plannerT('tl', key), plannerT('en', key), `${key} is translated to Tagalog`);
    assert.notEqual(plannerT('ceb', key), plannerT('en', key), `${key} is translated to Cebuano`);
  }
  assert.equal(plannerT('en', 'textCaseUpper'), 'UPPERCASE');
  assert.equal(plannerT('en', 'textCaseLower'), 'lowercase');
});
