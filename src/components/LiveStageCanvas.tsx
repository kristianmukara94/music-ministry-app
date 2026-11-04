import type { ReactNode } from 'react';
import { Music } from 'lucide-react';

const EYEBROW = 'text-[11px] font-semibold tracking-wider text-accent uppercase';

/** One jump chip: the short label on the chip, and `index`, the slide it jumps to. */
export interface StageChip {
  index: number;
  label: string;
  /** The slide's full name, read out by the chip's accessible label. */
  name: string;
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
                    return (
                      <li key={chip.index}>
                        <button
                          type="button"
                          onClick={() => onSelect(chip.index)}
                          onDoubleClick={onChipDoubleClick ? () => onChipDoubleClick(chip.index) : undefined}
                          disabled={disabled}
                          aria-current={here ? 'step' : undefined}
                          aria-label={chipLabel(chip)}
                          className={`grid h-10 min-w-12 place-items-center rounded-full border px-3 font-mono text-sm font-bold transition disabled:cursor-not-allowed ${
                            here ? 'border-accent bg-accent text-on-accent' : 'border-fg/15 bg-panel-2 text-fg/85 hover:border-accent hover:text-accent'
                          }`}
                        >
                          {chip.label}
                        </button>
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
