// The Go Live consoles' Jump to section chips: their labels when a stanza runs over several slides, and the keys that jump to them.
// Pure functions only, so the tests can run them without a window. The chips themselves are drawn by src/components/LiveStageCanvas.tsx.

/** How many chips carry a number key: 1 to 9. */
export const CHIP_HOTKEYS = 9;

/** A stanza split over several slides labels each page: "V1" over three slides is V1.1, V1.2, V1.3. A one-slide stanza keeps its label. */
export function subIndexChip(chip, part = 0, parts = 1) {
  return parts > 1 ? `${chip}.${part + 1}` : chip;
}

const CHORUS = /^C\d*(\.\d+)?$/;
const VERSE = /^V\d*(\.\d+)?$/;

/** True for a section's first slide: V1, V1.1. False for the pages after it: V1.2, V1.3. */
const opensSection = (label) => !/\.\d+$/.test(label) || /\.1$/.test(label);

/** The chips that carry a number key, in the order they are drawn: every chip except a title card or a black step, up to nine. */
export function hotkeyChips(groups) {
  return groups
    .flatMap((g) => g.chips)
    .filter((c) => c.hotkey !== false)
    .slice(0, CHIP_HOTKEYS);
}

/**
 * The slide a key jumps to, by its chip index, or null when the key jumps nowhere.
 * 1 to 9 are the chips with number keys. C is the first chorus, and V the next verse after the slide on screen, wrapping back to the first.
 * Both look in the song on screen first, so a card with two songs keeps to the one being sung.
 */
export function chipForKey(groups, key, activeIndex) {
  if (/^[1-9]$/.test(key)) return hotkeyChips(groups)[Number(key) - 1]?.index ?? null;
  const k = String(key).toUpperCase();
  if (k !== 'C' && k !== 'V') return null;
  const pattern = k === 'C' ? CHORUS : VERSE;
  const sections = (chips) => chips.filter((c) => c.hotkey !== false && pattern.test(c.label) && opensSection(c.label));
  const here = groups.find((g) => g.chips.some((c) => c.index === activeIndex));
  let list = here ? sections(here.chips) : [];
  if (list.length === 0) list = sections(groups.flatMap((g) => g.chips));
  if (list.length === 0) return null;
  if (k === 'C') return list[0].index;
  return (list.find((c) => c.index > activeIndex) ?? list[0]).index;
}
