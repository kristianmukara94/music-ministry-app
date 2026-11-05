// The Holy Mass cards without type tags, with quick-select chips on the empty ones. Run with: node --test shared/mass-quick-select.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MASS_SLOTS } from './mass-slots.js';
import { slotDefaultTitle } from './mass-language.js';
import { plannerT } from './planner-i18n.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('a slot card has no type tag: the slot name is its heading and the item stands alone', () => {
  const plan = read('src/planner/HolyMassPlanner.tsx');
  assert.doesNotMatch(plan, /moduleLabel|TONE\b|const TAG\b/, 'no module label or tag colours on the cards');
  assert.doesNotMatch(plan, /kindSong|kindNote|t\('module_/);
  // The placeholder rows of an older plan keep no "Song" or "Text" tag either.
  assert.match(read('src/planner/MassPlanner.tsx'), /\{!step && <span className=\{`\$\{TAG\} \$\{toneOf\(row\.module\)\}`\}>/);
  assert.doesNotMatch(read('src/planner/MassPlanner.tsx'), /KIND_KEY/);
});

test('an empty card offers chips: the slot\'s own songs, its Mass Order text and its ready-made words, each one click to fill', () => {
  const plan = read('src/planner/HolyMassPlanner.tsx');
  assert.match(plan, /\.\.\.responseChoices\(slot, lang, date\)\.map/);
  assert.match(plan, /\.\.\.\(suggestions\[slot\.id\] \?\? \[\]\)\.map/);
  assert.match(plan, /onClick=\{\(\) => onFill\(slot\.id, choice\)\}/);
  assert.match(plan, /role="group" aria-label=\{t\('quickSelect'/);
  assert.match(plan, /const suggestions = useSlotSuggestions\(MASS_SLOTS\);/);
});

test('the songs on a card are the Holy Mass songs filed under that slot\'s own song category, a few of them, one request per category', () => {
  const hook = read('src/planner/useSlotSuggestions.ts');
  assert.match(hook, /listHymns\(\{ primaryCategory: 'MASS', songCategory: category \}\)/);
  assert.match(hook, /export const CHIPS_PER_SLOT = 3;/);
  assert.match(hook, /new Set\(slots\.map\(\(s\) => s\.songCategory\)/, 'a category shared by two slots is asked for once');
  assert.match(hook, /bridge\.lyrics\.onChanged/, 'a song changed in Song Lyrics refreshes the chips');
});

test('the picker lists the same ready-made fills as the chips', () => {
  const pick = read('src/planner/MassItemSelect.tsx');
  assert.match(pick, /const own = responseChoices\(slot, lang, date\);\s+for \(const choice of own\)/);
  assert.match(pick, /songCategory: filter === 'slot' \? slot\.songCategory : undefined,/, 'and its songs are still filtered to the slot');
});

test('Lord, Have Mercy offers the Kyrie, the Offertory slot is filtered to the gifts hymns, and spoken slots offer their opening words', () => {
  const slot = (id) => MASS_SLOTS.find((s) => s.id === id);
  assert.equal(slot('kyrie').songCategory, 'Kyrie');
  assert.equal(slot('kyrie').massOrderId, 'kyrie');
  assert.equal(slot('offertory').songCategory, 'Preparation of the Gifts');
  for (const id of ['prayer-faithful', 'accept-sacrifice', 'doxology', 'not-worthy']) {
    assert.ok(slot(id).presets?.length > 0, `${id} has words to offer`);
    assert.equal(slot(id).kind, 'text');
  }
  // I Confess offers its default title in the Mass language instead (see shared/mass-language.js).
  assert.equal(slotDefaultTitle(slot('confess'), 'EN'), 'I Confess to Almighty God');
  assert.equal(slotDefaultTitle(slot('confess'), 'TL'), 'Inaamin ko sa Makapangyarihang Diyos');
  // Only the spoken slots have them: a hymn slot offers songs.
  assert.ok(MASS_SLOTS.filter((s) => s.kind === 'song').every((s) => !s.presets));
});

test('the chips are named for screen readers in English and Tagalog', () => {
  assert.equal(plannerT('en', 'quickAdd', { item: 'Kyrie', slot: 'Lord, Have Mercy' }), 'Add Kyrie to Lord, Have Mercy');
  assert.notEqual(plannerT('tl', 'quickAdd', { item: 'A', slot: 'B' }), plannerT('en', 'quickAdd', { item: 'A', slot: 'B' }));
});
