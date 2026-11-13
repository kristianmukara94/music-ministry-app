import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { FileText, Music, PenLine, Search } from 'lucide-react';
import { bridge } from '../live/bridge';
import { allMassParts, massPartName } from '../liturgy/massOrder';
import { useMassOrderTexts } from '../liturgy/massOrderStore';
import { responseChoices } from './slotChoices';
import { autoSplitText } from '../utils/textOptimizer';
import type { MassSlot } from '../../shared/mass-slots.js';
import { textResponseFrame } from '../../shared/stage-plan-row.js';
import { slotLabel } from '../../shared/mass-language.js';
import type { HymnSummary } from '../lyrics/types';
import type { Note } from '../notes/types';
import type { PlannerT } from './strings';
import type { SourceModule } from './types';

type Tab = 'songs' | 'prayers' | 'custom';
type Filter = 'slot' | 'mass' | 'pw' | 'all';
const SEARCH_DELAY_MS = 150;
/** The longest typed text a plan row holds (the database's limit for a 'custom' item). */
const MAX_TEXT = 300;
/** The longest label a plan row keeps: a custom note is named by its first line. */
const MAX_LABEL = 120;

const PRIMARY: Record<Filter, 'MASS' | 'PRAISE_AND_WORSHIP' | 'GENERAL'> = { slot: 'MASS', mass: 'MASS', pw: 'PRAISE_AND_WORSHIP', all: 'GENERAL' };

/** What the picker hands back: the item for the slot. */
export interface PickedItem {
  module: SourceModule;
  sourceId: string;
  label: string;
}

interface Option extends PickedItem {
  key: string;
  group: 'songs' | 'slot' | 'massOrder' | 'notes';
  icon: 'song' | 'text';
  sub: string;
}

interface Props {
  slot: MassSlot;
  lang: 'en' | 'tl' | 'ceb';
  /** The plan's liturgical date: a reading slot offers that day's reading. */
  date?: string;
  t: PlannerT;
  onPick: (item: PickedItem) => void;
  onClose: () => void;
}

/** A custom note as a plan row: the whole text is its source, and its first line names it. */
export function customNoteItem(text: string): PickedItem | null {
  const body = text.trim().slice(0, MAX_TEXT);
  if (!body) return null;
  const first = body.split('\n').find((line) => line.trim())?.trim() ?? body;
  return { module: 'custom', sourceId: body, label: first.length > MAX_LABEL ? `${first.slice(0, MAX_LABEL - 1)}…` : first };
}

const matches = (query: string, ...fields: (string | null | undefined)[]) => {
  const q = query.trim().toLowerCase();
  return !q || fields.some((f) => f?.toLowerCase().includes(q));
};

/**
 * The picker that opens under a Holy Mass slot. Every slot offers the same three tabs, so any slot can take a song or a text:
 * - Songs: the songs that suit the slot (its own song category by default), widened by the chips to every Holy Mass song, the Praise &
 *   Worship songs, or all songs.
 * - Prayer Notes & Passages: the slot's ready-made texts first, then every Holy Mass Order part and the prayers saved in Notes & Prayers.
 *   Anything typed in the search can also be used as the slot's own text.
 * - Create Custom Note: a text box for a prayer, response or note written on the spot. A blank line starts a new slide, and long text is
 *   split to fit the screen when it is shown (see textResponseFrame in shared/stage-plan-row.js).
 *
 * The search tabs are a combobox: Down and Up move through the results, Enter picks the one marked, Escape or a click outside closes it.
 */
export function MassItemSelect({ slot, lang, date, t, onPick, onClose }: Props) {
  const slotName = slotLabel(slot, lang);
  const listId = useId();
  const tabsId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>(slot.kind === 'song' ? 'songs' : 'prayers');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(slot.songCategory ? 'slot' : 'mass');
  const [songs, setSongs] = useState<HymnSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  // A note from Auto-Format: the text was too long to split within the slot's limit. Cleared by the next change to the text.
  const [formatNote, setFormatNote] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  // The parish's own Mass Order parts and titles, so a text edited in the Mass Order shows here at once.
  useMassOrderTexts();

  // The songs for the search and the chip. The list stays up while a newer search is on its way, and an old answer never replaces a newer one.
  useEffect(() => {
    if (tab !== 'songs') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      bridge.lyrics
        .listHymns({
          search: query,
          primaryCategory: PRIMARY[filter],
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
  }, [tab, query, filter, slot.songCategory]);

  // The prayers saved in Notes & Prayers. Operator-only notes are private and never go to the screen, so they are not offered.
  useEffect(() => {
    let cancelled = false;
    bridge.notes
      .list()
      .then((rows) => !cancelled && setNotes(rows.filter((n) => n.display !== 'operator')))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // A click outside closes the picker.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const options = useMemo<Option[]>(() => {
    if (tab === 'songs') {
      return songs.map((h) => ({
        key: `song-${h.id}`,
        group: 'songs',
        icon: 'song',
        module: 'lyrics',
        sourceId: String(h.id),
        label: h.title,
        sub: [h.composer, h.songCategory, h.language].filter(Boolean).join(' · '),
      }));
    }
    if (tab !== 'prayers') return [];
    const list: Option[] = [];
    // The slot's ready-made fills: its Mass Order text, and the opening words of its own text.
    const own = responseChoices(slot, lang, date);
    for (const choice of own) {
      if (!matches(query, choice.label)) continue;
      list.push({ key: `slot-${choice.module}-${choice.sourceId}`, group: 'slot', icon: 'text', ...choice, sub: choice.module === 'mass_order' ? t('pickerMassOrder', { name: choice.label }) : t('pickerUseText', { text: choice.label }) });
    }
    const typed = customNoteItem(query);
    if (typed) list.push({ key: 'typed', group: 'slot', icon: 'text', ...typed, sub: t('pickerUseText', { text: typed.sourceId }) });
    for (const part of allMassParts()) {
      if (own.some((c) => c.module === 'mass_order' && c.sourceId === part.id)) continue;
      const label = massPartName(part, lang);
      if (!matches(query, label, part.id)) continue;
      list.push({ key: `mo-${part.id}`, group: 'massOrder', icon: 'text', module: 'mass_order', sourceId: part.id, label, sub: t('pickerMassOrder', { name: label }) });
    }
    for (const note of notes) {
      if (!matches(query, note.title, note.category)) continue;
      list.push({
        key: `note-${note.id}`,
        group: 'notes',
        icon: 'text',
        module: 'notes',
        sourceId: String(note.id),
        label: note.title,
        sub: t(note.display === 'lower' ? 'pickerPrayerLower' : 'pickerPrayerNote', { category: note.category }),
      });
    }
    return list;
  }, [tab, songs, notes, slot, query, lang, date, t]);

  // The marked option follows the list: back to the first when the results change.
  useEffect(() => setActive(0), [tab, query, filter, songs]);
  const activeId = options[active] ? `${listId}-${options[active].key}` : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const pick = (option: PickedItem | null | undefined) => option && onPick({ module: option.module, sourceId: option.sourceId, label: option.label });

  const closeOnEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return false;
    e.preventDefault();
    e.stopPropagation();
    onClose();
    return true;
  };

  const onKey = (e: KeyboardEvent) => {
    if (closeOnEscape(e)) return;
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
    }
  };

  // Left and Right move between the tabs, as a tab list does.
  const TABS: { id: Tab; text: string; icon: typeof Music }[] = [
    { id: 'songs', text: t('pickerTabSongs'), icon: Music },
    { id: 'prayers', text: t('pickerTabPrayers'), icon: FileText },
    { id: 'custom', text: t('pickerTabCustom'), icon: PenLine },
  ];
  const onTabKey = (e: KeyboardEvent) => {
    if (closeOnEscape(e)) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const at = TABS.findIndex((x) => x.id === tab);
    const next = TABS[(at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.id);
    document.getElementById(`${tabsId}-${next.id}`)?.focus();
  };

  const chips: { id: Filter; text: string }[] = [
    ...(slot.songCategory ? [{ id: 'slot' as const, text: t('pickerFilterSlot') }] : []),
    { id: 'mass', text: t('pickerFilterMass') },
    { id: 'pw', text: t('pickerFilterPw') },
    { id: 'all', text: t('pickerFilterAll') },
  ];

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
          <span className="block truncate text-[11px] text-muted">{option.sub}</span>
        </span>
      </li>
    );
  };

  const heading = (key: string, text: string) => (
    <li key={`heading-${key}`} role="presentation" className="px-2 pt-2 pb-1 text-[10px] font-bold tracking-wider text-muted uppercase first:pt-1">
      {text}
    </li>
  );
  const group = (id: Option['group'], title: string) => {
    const rows = options.filter((o) => o.group === id);
    return rows.length > 0 ? [heading(id, title), ...rows.map(row)] : null;
  };

  const custom = customNoteItem(draft);
  // The slides the note will show, counted the way the projector stages it, and what Auto-Format would make of it.
  const slideCount = useMemo(() => {
    if (!custom) return 0;
    const frame = textResponseFrame(slotName, custom.sourceId);
    return frame.kind === 'deck' ? frame.slides.length : 1;
  }, [custom?.sourceId, slotName]);
  const formatted = useMemo(() => autoSplitText(draft), [draft]);
  const canFormat = custom !== null && formatted.formattedText !== draft.trim();
  const autoFormat = () => {
    // The split adds a line break at each cut, so text near the limit may not fit the plan row any more: it is left as it was.
    if (formatted.formattedText.length > MAX_TEXT) {
      setFormatNote(t('pickerCustomTooLong', { n: formatted.formattedText.length - MAX_TEXT }));
      return;
    }
    setDraft(formatted.formattedText);
  };

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={t('pickerLabel', { slot: slotName })}
      className="absolute top-full right-0 left-0 z-30 mt-1 flex max-h-[28rem] flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-2xl shadow-black/50"
    >
      <div className="flex items-center gap-1 border-b border-line px-2 pt-2">
        <div role="tablist" aria-label={t('pickerTabsLabel')} className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {TABS.map(({ id, text, icon: Icon }) => (
            <button
              key={id}
              id={`${tabsId}-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`${tabsId}-panel`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={onTabKey}
              className={`-mb-px inline-flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-2.5 text-[11px] font-bold whitespace-nowrap transition ${
                tab === id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              <Icon size={13} aria-hidden /> {text}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="h-7 shrink-0 rounded-md px-2 text-[11px] font-bold text-muted hover:text-fg">
          {t('pickerClose')}
        </button>
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {tab === 'custom' ? (
          <form
            className="flex flex-col gap-2 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              pick(custom);
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-fg/70">{t('pickerCustomLabel', { slot: slotName })}</span>
              <textarea
                autoFocus
                rows={5}
                maxLength={MAX_TEXT}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setFormatNote(null);
                }}
                onKeyDown={(e) => {
                  if (closeOnEscape(e)) return;
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    pick(custom);
                  }
                }}
                placeholder={t('pickerCustomPlaceholder')}
                className="w-full resize-y rounded-md border border-fg/15 bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </label>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[11px] text-muted">{t('pickerCustomHint')}</p>
              <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">{t('pickerCustomCount', { n: draft.length, max: MAX_TEXT })}</span>
            </div>
            {formatNote && (
              <p role="alert" className="text-[11px] text-warn">
                {formatNote}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!canFormat}
                onClick={autoFormat}
                title={canFormat ? t('pickerCustomFormatTip') : t('pickerCustomFitsAlready')}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-accent/60 px-3 text-[11px] font-bold tracking-wide text-accent uppercase transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('pickerCustomFormat')}
              </button>
              <span role="status" className="min-w-0 flex-1 font-mono text-[11px] text-muted tabular-nums">
                {custom ? t('pickerCustomSlides', { n: slideCount }) : ''}
              </span>
              <button
                type="submit"
                disabled={!custom}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[11px] font-bold tracking-wide text-on-accent uppercase transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('pickerCustomAttach')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex flex-col gap-2 border-b border-line p-2">
              <label className="relative">
                <span className="sr-only">{tab === 'songs' ? t('pickerSearch') : t('pickerSearchPrayers')}</span>
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
                  placeholder={tab === 'songs' ? t('pickerSearch') : t('pickerSearchPrayers')}
                  className="h-9 w-full rounded-md border border-fg/15 bg-panel-2 pr-3 pl-8 text-sm outline-none focus:border-accent"
                />
              </label>
              {tab === 'songs' && (
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
                </div>
              )}
            </div>

            <ul id={listId} role="listbox" aria-label={tab === 'songs' ? t('pickerSongs') : t('pickerTabPrayers')} className="min-h-0 flex-1 overflow-y-auto p-1">
              {tab === 'songs' ? (
                <>
                  {options.map(row)}
                  {loaded && options.length === 0 && (
                    <li role="presentation" className="px-2 py-3 text-xs text-muted">
                      {filter === 'slot' && slot.songCategory ? t('pickerNoneSlot', { category: slot.songCategory }) : t('pickerNone')}
                    </li>
                  )}
                </>
              ) : (
                <>
                  {group('slot', t('pickerGroupSlot'))}
                  {group('massOrder', t('pickerGroupMassOrder'))}
                  {group('notes', t('pickerGroupNotes'))}
                  {options.length === 0 && (
                    <li role="presentation" className="px-2 py-3 text-xs text-muted">
                      {t('pickerPrayersNone')}
                    </li>
                  )}
                  {!query && (
                    <li role="presentation" className="px-2 py-2 text-[11px] text-muted">
                      {t('pickerTypeHint')}
                    </li>
                  )}
                </>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
