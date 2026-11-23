// The compact LIVE button in the Planner libraries: songs, prayers and scripture in both the Praise & Worship Library and the Holy Mass
// Planner library, the GO LIVE NOW label shortened to LIVE, and room for the song title. Synthetic data only.
// Run with: node --test shared/library-live-button.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pwT } from './pw-i18n.js';
import { plannerT } from './planner-i18n.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const button = read('src/components/LiveButton.tsx');
const card = read('src/praise-worship/SongSearchResultCard.tsx');
const results = read('src/praise-worship/LibrarySearchContainer.tsx');
const library = read('src/praise-worship/Library.tsx');
const mass = read('src/planner/MassPlanner.tsx');
const routing = read('src/planner/routing.ts');

test('the LIVE button reads LIVE with a lightning bolt; its tooltip and name say Go Live Now', () => {
  assert.match(button, /import \{ Radio, Zap \} from 'lucide-react';/);
  assert.match(button, /aria-label=\{`\$\{labels\.hint\}: \$\{title\}`\}/);
  assert.match(button, /title=\{armed \? labels\.confirm : `\$\{labels\.hint\} \(Shift \+ click\)`\}/);
  assert.match(button, /: labels\.live\}/);
  assert.match(button, /e\.stopPropagation\(\);/, 'a LIVE press never ticks, adds or picks the row');
  for (const lang of ['en', 'tl', 'ceb']) {
    assert.equal(pwT(lang, 'liveShort'), 'LIVE');
    assert.equal(plannerT(lang, 'libLive'), 'LIVE');
  }
  assert.equal(pwT('en', 'goLiveNow'), 'Go Live Now');
  assert.equal(plannerT('en', 'libLiveHint'), 'Go Live Now');
  assert.notEqual(plannerT('tl', 'libLiveHint'), 'Go Live Now');
  assert.notEqual(plannerT('ceb', 'libLiveHint'), 'Go Live Now');
  assert.notEqual(pwT('ceb', 'goLiveNow'), 'Go Live Now');
});

test('P&W Library: songs show LIVE (not GO LIVE NOW) in compact actions, and the title gets the room', () => {
  assert.doesNotMatch(card, /labels\.goLive\}\s*<\/button>/, 'the long label is no longer the button text');
  assert.match(card, /<LiveButton\s+title=\{row\.title\}\s+labels=\{\{ live: labels\.liveShort, hint: labels\.goLive/);
  assert.match(results, /goLive: t\('goLiveNow'\), liveShort: t\('liveShort'\)/);
  // The actions sit in one shrink-0 group; the title block is flex-1 min-w-0 with a floor, and wraps to two lines.
  assert.match(card, /<div data-row-actions className="ml-auto flex shrink-0 items-center gap-1">/);
  assert.match(card, /className="flex min-h-11 min-w-0 flex-\[1_1_9rem\] flex-col/);
  assert.match(card, /<span data-row-title className="line-clamp-2 w-full break-words font-semibold leading-snug">\{row\.title\}<\/span>/);
  assert.doesNotMatch(card, /size-11/, 'Show Lyrics and Edit Song are compact');
  assert.match(card, /const ICON_BTN =\n  'grid size-8 shrink-0/);
  assert.match(library, /className=\{`grid size-8 shrink-0 place-items-center rounded-md border transition/, 'the Tag button is compact too');
});

test('P&W Library: Prayers and Scripture rows have LIVE too, shown directly without adding to the lineup', () => {
  assert.match(library, /goLive: async \(\) => void goLiveNote\(p\),/);
  assert.match(library, /goLive: \(\) => liveScripture\(o\.id, o\.label\),/);
  assert.match(library, /goLiveLibraryItem\(\{ module: 'lectionary', sourceId: `\$\{session\.liturgicalDate\}\|\$\{id\}` \}\)/);
  assert.match(library, /goLiveFrame\(segment\.name, \{ kind: 'pw', slide: \{ kind: 'title'/);
  assert.match(card, /\{!quick && direct && \(\n\s*<LiveButton/);
  assert.match(results, /hymnId == null && row\.goLive\n\s*\? \{ armed: direct\.armed === row\.key/);
});

test('Holy Mass Planner library: LIVE on Songs, Prayers (Notes & Prayers) and Scripture (Lectionary, Bible)', () => {
  assert.match(mass, /const LIVE_MODULES: readonly SourceModule\[\] = \['lyrics', 'notes', 'lectionary', 'bible'\];/);
  assert.match(mass, /\{LIVE_MODULES\.includes\(item\.module\) && \(\n\s*<LiveButton/);
  assert.match(mass, /labels=\{\{ live: t\('libLive'\), hint: t\('libLiveHint'\), confirm: t\('libLiveConfirm'\) \}\}/);
  assert.match(mass, /const result = await goLiveLibraryItem\(item\);/);
  assert.match(mass, /<div data-row-actions className="ml-auto flex shrink-0 items-center gap-1">/);
  assert.match(mass, /<div className="min-w-0 flex-\[1_1_8rem\]">\n\s*<div data-row-title className="line-clamp-2 break-words/);
});

test('goLiveLibraryItem: a direct show for each kind, never the plan or the queue cursor', () => {
  const body = routing.slice(routing.indexOf('export async function goLiveLibraryItem'));
  assert.match(body, /goLiveNowActions\(\{ hymn, band: quickLiveBand\(hymn\), bandStageOnly: true \}\)/, 'a song goes out as GO LIVE NOW does');
  assert.match(body, /if \(note\.display === 'operator'\) return 'operator';/, 'a private note never reaches the projector');
  assert.match(body, /return goLiveNote\(note, source\?\.slides\);/);
  assert.match(body, /takePrayer\(note, 'DIRECT_DECK', 0, slides\);/);
  assert.match(body, /dispatch\(\{ type: 'projector\/stage', frame \}\);\s+dispatch\(\{ type: 'projector\/take', source: 'DIRECT_DECK' \}\);\s+openQuickLivePreview\(before, \{ title, frames: \[frame\] \}\);/, 'the title card is taken, so the popup finds it');
  assert.equal((body.match(/dispatch\(\{ type: 'projector\/take', source: 'DIRECT_DECK' \}\);/g) ?? []).length, 3, 'readings, passages and the title card');
  assert.doesNotMatch(body, /queue\/cursor|plans\.save/);
});

test('a LIVE press during a running Holy Mass or P&W slide asks for a second press', () => {
  const hook = read('src/planner/useArmedLive.ts');
  assert.match(hook, /if \(!immediate && armed !== key && goLiveNowCutsRun\(useLive\.getState\(\)\.state\.projector\)\) \{/);
  assert.match(mass, /const live = useArmedLive\(/);
  assert.match(results, /const direct = useArmedLive\(runDirect\);/);
});
