import { useEffect, useRef, type ReactNode } from 'react';
import { Music } from 'lucide-react';
import { useUi } from '../state/ui';
import { comboOf } from '../../shared/shortcuts.js';
import { chipForKey, hotkeyChips } from '../../shared/stage-chips.js';

const EYEBROW = 'text-[11px] font-semibold tracking-wider text-accent uppercase';

/** One jump chip: the short label on the chip, and `index`, the slide it jumps to. */
export interface StageChip {
  index: number;
  label: string;
  /** The slide's full name, read out by the chip's accessible label. */
  name: string;
  /** False for a chip that takes no number key: a song's title card, the black step. */
  hotkey?: boolean;
}

/** A row of chips. A song's chips share a row under its title; a row without a song has no heading. */
export interface StageChipGroup {
  key: string;
  label: string | null;
  chips: StageChip[];
}

export interface LiveStageCanvasProps {
  titleId: string;
  /** The line over the title: where the item sits in the service ("Now · 01 of 17 · Introductory Rites"). */
  eyebrow: string;
  title: string;
  /** The songs in the item, as pills under the title. The one on screen is lit. */
  songs?: { id: number; title: string }[];
  activeSongId?: number | null;
  /** Beside the title, on the right: the Praise & Worship segment timer. */
  aside?: ReactNode;
  /** Between the title and the preview: a warning about the item. */
  alert?: ReactNode;
  /** The slide on screen and the next one. Each console draws its own, so the preview matches its output exactly. */
  preview: ReactNode;
  jumpHeading: string;
  groups: StageChipGroup[];
  /** The slide on screen, by `StageChip.index`. */
  activeIndex: number;
  onSelect: (index: number) => void;
  onChipDoubleClick?: (index: number) => void;
  chipLabel: (chip: StageChip) => string;
  disabled?: boolean;
  /** Shown in place of the chips when there are none. */
  noChips?: ReactNode;
  /** After the chips: the lineup's hot edit. */
  children?: ReactNode;
}

/**
 * The middle of a live console: the item on screen with its songs, its preview, and Jump to section. The Holy Mass and the Praise & Worship
 * consoles both draw it, so the two read and work the same. A song's chips are its sections (V1, C1, B); a deck's are its slide numbers. Every
 * chip is always shown, so any section is one click away.
 *
 * The first nine chips with a number key wear it in their corner, and pressing it jumps there. C jumps to the first chorus and V to the next
 * verse. The keys give way to a text field, an open dialog, the command palette, and any saved shortcut on the same key.
 */
export function LiveStageCanvas({
  titleId,
  eyebrow,
  title,
  songs = [],
  activeSongId = null,
  aside,
  alert,
  preview,
  jumpHeading,
  groups,
  activeIndex,
  onSelect,
  onChipDoubleClick,
  chipLabel,
  disabled,
  noChips,
  children,
}: LiveStageCanvasProps) {
  const hasChips = groups.some((g) => g.chips.length > 0);
  const keyOf = new Map(hotkeyChips(groups).map((chip, i) => [chip.index, String(i + 1)]));
  useChipKeys({ groups, activeIndex, onSelect, disabled: Boolean(disabled) });
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className={EYEBROW}>{eyebrow}</p>
          <h2 id={titleId} className="mt-1 text-2xl leading-tight font-bold tracking-tight">{title}</h2>
          {songs.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {songs.map((song) => (
                <li
                  key={song.id}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    song.id === activeSongId ? 'border-accent/60 bg-accent/15 text-accent' : 'border-fg/15 bg-panel-2 text-fg/80'
                  }`}
                >
                  <Music size={11} aria-hidden /> {song.title}
                </li>
              ))}
            </ul>
          )}
        </div>
        {aside}
      </div>

      {alert}

      {preview}

      <div className="flex flex-col gap-2">
        <h3 className={EYEBROW}>{jumpHeading}</h3>
        {hasChips ? (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <div key={group.key} className="flex flex-col gap-1.5">
                {group.label && <span className="truncate text-xs font-semibold text-fg/70">{group.label}</span>}
                <ol className="flex flex-wrap gap-1.5">
                  {group.chips.map((chip) => {
                    const here = chip.index === activeIndex;
                    const key = keyOf.get(chip.index);
                    return (
                      <li key={chip.index} className="relative">
                        <button
                          type="button"
                          onClick={() => onSelect(chip.index)}
                          onDoubleClick={onChipDoubleClick ? () => onChipDoubleClick(chip.index) : undefined}
                          disabled={disabled}
                          aria-current={here ? 'step' : undefined}
                          aria-label={chipLabel(chip)}
                          aria-keyshortcuts={key}
                          className={`grid h-10 min-w-12 place-items-center rounded-full border px-3 font-mono text-sm font-bold transition disabled:cursor-not-allowed ${
                            here ? 'border-accent bg-accent/20 text-accent ring-2 ring-accent' : 'border-fg/15 bg-panel-2 text-fg/85 hover:border-accent hover:text-accent'
                          }`}
                        >
                          {chip.label}
                        </button>
                        {key && (
                          <span
                            aria-hidden
                            className={`pointer-events-none absolute -top-1.5 -right-1.5 grid size-[18px] place-items-center rounded-full border font-mono text-[10px] leading-none font-bold ${
                              here ? 'border-accent bg-accent text-on-accent' : 'border-fg/25 bg-panel text-fg/70'
                            }`}
                          >
                            {key}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        ) : (
          noChips
        )}
        {children}
      </div>
    </>
  );
}

/** Number keys 1 to 9, C and V jump to a chip, as a click on it does. */
function useChipKeys(props: { groups: StageChipGroup[]; activeIndex: number; onSelect: (index: number) => void; disabled: boolean }) {
  // Read through a ref, so the listener is added once and always sees the chips on screen now.
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { groups, activeIndex, onSelect, disabled } = latest.current;
      if (disabled || e.defaultPrevented || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const ui = useUi.getState();
      if (ui.paletteOpen || ui.capturingHotkey || document.querySelector('[aria-modal="true"]')) return;
      // A saved shortcut on the same key is the operator's choice, and wins.
      const combo = comboOf(e);
      if (combo && ui.shortcuts.some((s) => s.key === combo)) return;
      const target = chipForKey(groups, e.key, activeIndex);
      if (target == null) return;
      e.preventDefault();
      if (target !== activeIndex) onSelect(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
