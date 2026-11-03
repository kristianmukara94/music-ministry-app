import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { FileText, Music, Search } from 'lucide-react';
import { bridge } from '../live/bridge';
import { responseChoices } from './slotChoices';
import type { MassSlot } from '../../shared/mass-slots.js';
import type { HymnSummary } from '../lyrics/types';
import type { PlannerT } from './strings';
import type { SourceModule } from './types';

type Filter = 'slot' | 'mass' | 'all';
const SEARCH_DELAY_MS = 150;
const MAX_TEXT = 300;

/** What the picker hands back: the item for the slot. */
export interface PickedItem {
  module: SourceModule;
  sourceId: string;
  label: string;
}

interface Option extends PickedItem {
  key: string;
  group: 'songs' | 'other';
  icon: 'song' | 'text';
  sub: string;
}

interface Props {
  slot: MassSlot;
  lang: 'en' | 'tl' | 'ceb';
  t: PlannerT;
  onPick: (item: PickedItem) => void;
  onClose: () => void;
}

/**
 * The picker that opens under a Holy Mass slot: a search box and the songs that suit the slot, to put one in with a click or the keyboard.
 * The songs are the Holy Mass ones (the Mass scope and the General songs, which show everywhere), narrowed to the slot's own song category by
 * default; the chips widen it to every Holy Mass song, or to all songs. A slot that has a Mass Order text offers it, and anything typed can be
 * used as the slot's own text.
 *
 * A combobox: Down and Up move through the results, Enter picks the one marked, Escape or a click outside closes it.
 */
export function MassItemSelect({ slot, lang, t, onPick, onClose }: Props) {
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(slot.songCategory ? 'slot' : 'mass');
  const [songs, setSongs] = useState<HymnSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);

  // The songs for the search and the chip. The list stays up while a newer search is on its way, and an old answer never replaces a newer one.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      bridge.lyrics
        .listHymns({
          search: query,
          primaryCategory: filter === 'all' ? 'GENERAL' : 'MASS',
          songCategory: filter === 'slot' ? slot.songCategory : undefined,
        })
        .then((rows) => {
          if (cancelled) return;
          setSongs(rows);
          setLoaded(true);
        })
        .catch(() => !cancelled && setLoaded(true));
    }, query ? SEARCH_DELAY_MS : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, filter, slot.songCategory]);

  // A click outside closes the picker.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const options = useMemo<Option[]>(() => {
    const list: Option[] = songs.map((h) => ({
      key: `song-${h.id}`,
      group: 'songs',
      icon: 'song',
      module: 'lyrics',
      sourceId: String(h.id),
      label: h.title,
      sub: [h.composer, h.songCategory, h.language].filter(Boolean).join(' · '),
    }));
    // The slot's ready-made fills: its Mass Order text, and the opening words of its own text.
    for (const choice of responseChoices(slot, lang)) {
      list.push({ key: `${choice.module}-${choice.sourceId}`, group: 'other', icon: 'text', ...choice, sub: choice.module === 'mass_order' ? t('pickerMassOrder', { name: choice.label }) : t('pickerUseText', { text: choice.label }) });
    }
    const typed = query.trim().slice(0, MAX_TEXT);
    if (typed) list.push({ key: 'typed', group: 'other', icon: 'text', module: 'custom', sourceId: typed, label: typed, sub: t('pickerUseText', { text: typed }) });
    return list;
  }, [songs, slot, query, lang, t]);

  // The marked option follows the list: back to the first when the results change.
  useEffect(() => setActive(0), [query, filter, songs]);
  const activeId = options[active] ? `${listId}-${options[active].key}` : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const pick = (option: Option | undefined) => option && onPick({ module: option.module, sourceId: option.sourceId, label: option.label });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home' && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault();
      setActive(Math.max(0, options.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const chips: { id: Filter; text: string }[] = [
    ...(slot.songCategory ? [{ id: 'slot' as const, text: t('pickerFilterSlot') }] : []),
    { id: 'mass', text: t('pickerFilterMass') },
    { id: 'all', text: t('pickerFilterAll') },
  ];
  const songRows = options.filter((o) => o.group === 'songs');
  const otherRows = options.filter((o) => o.group === 'other');

  const row = (option: Option) => {
    const index = options.indexOf(option);
    const on = index === active;
    return (
      <li
        key={option.key}
        id={`${listId}-${option.key}`}
        role="option"
        aria-selected={on}
        onMouseMove={() => setActive(index)}
        // Mouse down would take focus from the search box before the click lands, so it is held back.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pick(option)}
        className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${on ? 'bg-accent/15 text-fg' : 'text-fg/90'}`}
      >
        {option.icon === 'song' ? <Music size={14} className="shrink-0 text-ok" aria-hidden /> : <FileText size={14} className="shrink-0 text-muted" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{option.label}</span>
          <span className="block truncate text-[11px] text-fg/60">{option.sub}</span>
        </span>
      </li>
    );
  };

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={t('pickerLabel', { slot: slot.name })}
      className="absolute top-full right-0 left-0 z-30 mt-1 flex max-h-96 flex-col overflow-hidden rounded-lg border border-line-strong bg-panel shadow-2xl shadow-black/50"
    >
      <div className="flex flex-col gap-2 border-b border-line p-2">
        <label className="relative">
          <span className="sr-only">{t('pickerSearch')}</span>
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('pickerSearch')}
            className="h-9 w-full rounded-md border border-fg/15 bg-panel-2 pr-3 pl-8 text-sm outline-none focus:border-accent"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <div role="radiogroup" aria-label={t('pickerSongs')} className="flex flex-wrap gap-1">
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                role="radio"
                aria-checked={filter === chip.id}
                onClick={() => setFilter(chip.id)}
                className={`h-7 rounded-full border px-2.5 text-[11px] font-bold transition ${
                  filter === chip.id ? 'border-accent bg-accent/20 text-accent' : 'border-fg/15 text-fg/70 hover:text-fg'
                }`}
              >
                {chip.text}
              </button>
            ))}
          </div>
          <span role="status" className="ml-auto text-[11px] text-muted tabular-nums">
            {loaded ? t('pickerCount', { n: songs.length }) : ''}
          </span>
          <button type="button" onClick={onClose} className="h-7 rounded-md px-2 text-[11px] font-bold text-muted hover:text-fg">
            {t('pickerClose')}
          </button>
        </div>
      </div>

      <ul id={listId} role="listbox" aria-label={t('pickerSongs')} className="min-h-0 flex-1 overflow-y-auto p-1">
        {songRows.map(row)}
        {loaded && songRows.length === 0 && (
          <li role="presentation" className="px-2 py-3 text-xs text-muted">
            {filter === 'slot' && slot.songCategory ? t('pickerNoneSlot', { category: slot.songCategory }) : t('pickerNone')}
          </li>
        )}
        {otherRows.length > 0 && (
          <li role="presentation" className="px-2 pt-2 pb-1 text-[10px] font-bold tracking-wider text-muted uppercase">
            {t('pickerOther')}
          </li>
        )}
        {otherRows.map(row)}
        {!query && otherRows.length === 0 && (
          <li role="presentation" className="px-2 py-2 text-[11px] text-muted">
            {t('pickerTypeHint')}
          </li>
        )}
      </ul>
    </div>
  );
}
