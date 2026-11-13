import { ChevronsLeft, ChevronsRight, Megaphone, NotebookText, Pause, Play, Search, Trash2, X } from 'lucide-react';
import { GRID_COLUMNS, type GridColumns } from '../../shared/slide-selection.js';
import type { DeckPresetId } from '../../shared/deck-presets.js';
import type { AnnT } from '../announcements/strings';

/** The playback choices. They are remembered on this machine, so the deck opens the way the operator left it. */
export interface Playback {
  interval: number;
  loop: boolean;
  showCount: boolean;
}

/** The key the Announcements deck used, so the operator's choices carry over to the combined deck. */
const PLAYBACK_KEY = 'apccmma.announcements.playback';

/** Autoplay interval in seconds, kept between 1 and 30. */
export const clampInterval = (value: unknown) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(30, Math.max(1, n)) : 10;
};

export function loadPlayback(): Playback {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYBACK_KEY) ?? 'null');
    return { interval: clampInterval(raw?.interval), loop: raw?.loop === true, showCount: raw?.showCount === true };
  } catch {
    return { interval: 10, loop: false, showCount: false };
  }
}

export function savePlayback(playback: Playback) {
  try {
    localStorage.setItem(PLAYBACK_KEY, JSON.stringify(playback));
  } catch {
    /* storage unavailable: the choices last for this session */
  }
}

/** A gold switch. Lit when on, dark stone when off. */
function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-2 text-xs font-bold tracking-wider text-fg/80 uppercase">
      <span className={`relative h-5 w-9 rounded-full border transition ${on ? 'border-accent bg-accent' : 'border-fg/20 bg-panel-2'}`}>
        <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${on ? 'left-[18px] bg-panel' : 'left-0.5 bg-fg/60'}`} aria-hidden />
      </span>
      {label}
    </button>
  );
}

/**
 * The deck's control bar. Top row: the autoplay stepper (first, play/pause, next), the presentation presets (announcement loop, sermon /
 * manual deck), the interval, the Loop and Show-count switches, the slide
 * counter and Clear projector. Bottom row: the search over every slide shown and the thumbnail density.
 */
export function DeckControlBar({
  tr,
  playing,
  playback,
  onPlayback,
  current,
  total,
  onFirst,
  onNext,
  onTogglePlay,
  onClear,
  query,
  onQuery,
  searchPlaceholder,
  columns,
  onColumns,
  preset,
  onPreset,
}: {
  tr: AnnT;
  playing: boolean;
  playback: Playback;
  onPlayback: (playback: Playback) => void;
  /** The preset the deck's settings match, lit in the bar, or null when they were set some other way. */
  preset: DeckPresetId | null;
  onPreset: (preset: DeckPresetId) => void;
  /** The staged slide's place in the list shown (1-based), or 0 for none. */
  current: number;
  total: number;
  onFirst: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onClear: () => void;
  query: string;
  onQuery: (query: string) => void;
  searchPlaceholder: string;
  columns: GridColumns;
  onColumns: (columns: GridColumns) => void;
}) {
  const disabled = total === 0;
  const tile =
    'grid size-9 place-items-center rounded-lg border border-accent/30 bg-panel-2 text-fg/90 transition-colors hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
  const timerLabel = playing ? tr('pauseAutoplay') : tr('startAutoplay');
  const numberField =
    'w-14 rounded-md border border-accent/40 bg-panel-2 px-2 py-1 text-right font-mono text-xs font-bold text-fg focus:border-accent focus:outline-none';

  return (
    <div className="flex shrink-0 flex-col gap-3 border-y border-line px-6 py-3">
      <div role="toolbar" aria-label={tr('playback')} className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onFirst} disabled={disabled} aria-label={tr('firstSlide')} title={tr('firstSlide')} className={tile}>
            <ChevronsLeft size={16} aria-hidden />
          </button>
          <button type="button" onClick={onTogglePlay} disabled={disabled && !playing} aria-label={timerLabel} title={timerLabel} className={tile}>
            {playing ? <Pause size={15} aria-hidden /> : <Play size={14} aria-hidden />}
          </button>
          <button type="button" onClick={onNext} disabled={disabled} aria-label={tr('nextSlide')} title={tr('nextSlide')} className={tile}>
            <ChevronsRight size={16} aria-hidden />
          </button>
        </div>

        <div role="group" aria-label={tr('presetMode')} className="flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-fg/15 bg-panel-2 p-1">
          {(
            [
              { id: 'loop', icon: Megaphone, label: tr('presetLoop'), hint: tr('presetLoopHint') },
              { id: 'sermon', icon: NotebookText, label: tr('presetSermon'), hint: tr('presetSermonHint') },
            ] as const
          ).map(({ id, icon: Icon, label, hint }) => (
            <button
              key={id}
              type="button"
              onClick={() => onPreset(id)}
              aria-pressed={preset === id}
              title={hint}
              className={`flex h-full items-center gap-1.5 rounded-md px-2.5 text-[11px] font-bold tracking-wider uppercase transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
                preset === id ? 'bg-accent text-on-accent shadow shadow-black/40' : 'text-fg/70 hover:bg-fg/10 hover:text-fg'
              }`}
            >
              <Icon size={13} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold tracking-wider text-muted uppercase">{tr('autoplay')}</span>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={playback.interval}
            onChange={(e) => onPlayback({ ...playback, interval: clampInterval(e.target.value) })}
            aria-label={tr('autoplayInterval')}
            className="h-1.5 w-28 cursor-pointer rounded-lg bg-fg/10 accent-accent"
          />
          <span className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={30}
              value={playback.interval}
              onChange={(e) => {
                if (e.target.value !== '') onPlayback({ ...playback, interval: clampInterval(e.target.value) });
              }}
              // Typing here must not trigger the deck's keys (arrows, space, Enter).
              onKeyDown={(e) => e.stopPropagation()}
              aria-label={tr('autoplayInterval')}
              className={numberField}
            />
            <span className="text-xs font-bold text-muted">{tr('secondsUnit')}</span>
          </span>
        </div>

        <Switch label={tr('loopDeck')} on={playback.loop} onChange={(loop) => onPlayback({ ...playback, loop })} />
        <Switch label={tr('showCount')} on={playback.showCount} onChange={(showCount) => onPlayback({ ...playback, showCount })} />

        <output aria-live="polite" className="rounded-full border border-accent/30 bg-panel-2/90 px-3 py-1 font-mono text-xs font-semibold tabular-nums text-accent">
          {current > 0 ? tr('pageOf', { n: current, total }) : tr('noSlideSelected')}
        </output>

        <button
          type="button"
          onClick={onClear}
          className="ml-auto flex h-9 items-center gap-2 rounded-lg border border-danger/50 bg-panel-2/80 px-3.5 text-xs font-bold tracking-wider text-danger uppercase transition-colors hover:border-danger hover:bg-danger/10 focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none"
        >
          <Trash2 size={14} aria-hidden /> {tr('clearProjector')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && query && (e.stopPropagation(), onQuery(''))}
            placeholder={searchPlaceholder}
            aria-label="Search slides"
            className="h-10 w-full rounded-lg border border-fg/15 bg-panel-2 pr-9 pl-9 text-sm text-fg outline-none placeholder:text-faint focus:border-accent"
          />
          {query && (
            <button type="button" onClick={() => onQuery('')} aria-label="Clear search" className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-faint hover:text-fg">
              <X size={14} aria-hidden />
            </button>
          )}
        </div>
        <div role="group" aria-label="Thumbnail size" className="flex h-10 shrink-0 items-center gap-0.5 rounded-lg border border-fg/15 bg-panel-2 p-1">
          {GRID_COLUMNS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onColumns(n)}
              aria-pressed={columns === n}
              title={`${n} slides across`}
              className={`h-full rounded-md px-2.5 text-xs font-bold tabular-nums transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
                columns === n ? 'bg-accent text-on-accent shadow shadow-black/40' : 'text-muted hover:bg-fg/10 hover:text-fg'
              }`}
            >
              {n} col
            </button>
          ))}
        </div>
        <p className="w-full text-xs text-faint xl:w-auto">{tr('keyHint')}</p>
      </div>
    </div>
  );
}
