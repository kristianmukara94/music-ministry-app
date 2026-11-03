import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ListMusic, Pencil, Play, Plus, Search, Send, Trash2 } from 'lucide-react';
import { clearSlot, moveToSlot, placeInSlot, additionalIn, MASS_SLOTS } from '../../shared/mass-slots.js';
import { SHOW_STAGED_UI, activeRowIndex, canStageRow, songRowActions, textRowActions } from '../../shared/stage-plan-row.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { setUi, useUi } from '../state/ui';
import { formatIsoDay } from '../state/region';
import { useRegion } from '../state/useRegion';
import { MASS_ORDER, allMassParts, findMassPart, massPartName } from '../liturgy/massOrder';
import { HolyMassOrderEditor } from '../liturgy/HolyMassOrderEditor';
import { useMassOrderTexts } from '../liturgy/massOrderStore';
import { isCustomId, isCustomized, withPartNames } from '../../shared/mass-order-text.js';
import { sundayCycle } from '../liturgy/lectionary';
import { formatRuns, formatSourceId, parsePassageInput, stripHits } from '../../shared/bible-ref.js';
import type { Translation } from '../bible/types';
import type { SongCategory } from '../lyrics/types';
import { GOSPEL_ACCLAMATION } from '../lectionary/types';
import { blockRows, moveInto, queueFromPlan, type DragSource } from './logic';
import { syncQueueIfLoaded } from './plan-api';
import { openQueueItem } from './routing';
import { HolyMassPlan } from './HolyMassPlanner';
import { MassTemplates } from './MassTemplates';
import type { PickedItem } from './MassItemSelect';
import { usePlannerT, type PlannerT } from './strings';
import { builtInItems, type NewPlanTemplate } from './templates';
import { NewPlanForm } from './NewPlanForm';
import { songCategoryOf, stepFor, type MassStep } from '../../shared/mass-flow.js';
import { overlayLyricsItems } from '../../shared/hymn-cache.js';
import { BLOCKS, type LibraryItem, type LiturgicalBlock, type PlanItem, type PlanSummary, type SourceModule } from './types';

const api = bridge.plans;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const TABS: { id: SourceModule; key: string }[] = [
  { id: 'lyrics', key: 'tab_lyrics' },
  { id: 'lectionary', key: 'tab_lectionary' },
  { id: 'announcements', key: 'tab_announcements' },
  { id: 'media', key: 'tab_media' },
  { id: 'bible', key: 'tab_bible' },
  { id: 'mass_order', key: 'tab_mass_order' },
  { id: 'custom', key: 'tab_custom' },
];


const MODULE_KEY: Record<SourceModule, string> = {
  lyrics: 'module_lyrics',
  lectionary: 'module_lectionary',
  announcements: 'module_announcements',
  media: 'module_media',
  mass_order: 'module_mass_order',
  bible: 'module_bible',
  custom: 'module_custom',
  notes: 'module_notes',
};

/** The tag on a library or plan row: one colour for each kind of item. */
const TAG = 'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase';
const MODULE_TONE: Record<string, string> = {
  lyrics: 'border-ok/40 bg-ok/10 text-ok',
  bible: 'border-info/40 bg-info/10 text-info',
  lectionary: 'border-danger/40 bg-danger/10 text-danger',
  announcements: 'border-warn/40 bg-warn/10 text-warn',
  media: 'border-ok/40 bg-ok/10 text-ok',
  mass_order: 'border-fg/30 bg-fg/10 text-fg/80',
  custom: 'border-fg/25 bg-fg/[0.08] text-fg/80',
};
const toneOf = (module: string) => MODULE_TONE[module] ?? MODULE_TONE.custom;

const isoOf = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** The coming Sunday (today if it is one): the Mass the operator usually plans. */
const upcomingSunday = () => {
  const today = new Date();
  return isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((7 - today.getDay()) % 7)));
};

/** Library rows for one tab, filtered by the search box. */
/** The library rows for one tab. Exported so the Go Live hub can search with the planner's own search. */
export async function loadLibrary(
  tab: SourceModule,
  query: string,
  date: string,
  lang: 'en' | 'tl' | 'ceb',
  t: PlannerT,
  translationId: string,
  songCategory?: string,
): Promise<LibraryItem[]> {
  const q = query.trim().toLowerCase();
  const match = (text: string) => !q || text.toLowerCase().includes(q);

  switch (tab) {
    case 'bible': {
      // A typed reference ("John 3:16-18") becomes one row. Any other text is searched word by word.
      const passage = parsePassageInput(query);
      if (passage) {
        const books = await bridge.bible.getBooks(translationId);
        const book = books.find((b) => b.name.toLowerCase() === passage.bookName.toLowerCase());
        if (!book) return [];
        const range = formatRuns([{ from: passage.from, to: passage.to }]);
        return [{
          module: 'bible',
          sourceId: formatSourceId(translationId, book.name, passage.chapter, range),
          label: `${book.name} ${passage.chapter}:${range} (${translationId})`,
          sub: t('bible_passage'),
        }];
      }
      if (!q) return [];
      const hits = await bridge.bible.search({ query: query.trim(), translationId, scope: 'all' });
      return hits.map((h): LibraryItem => ({
        module: 'bible',
        sourceId: formatSourceId(translationId, h.bookName, h.chapter, String(h.verse)),
        label: `${h.bookName} ${h.chapter}:${h.verse} (${translationId})`,
        sub: stripHits(h.snippet),
      }));
    }
    case 'lyrics': {
      const hymns = await bridge.lyrics.listHymns({ search: query, songCategory });
      return hymns.map((h): LibraryItem => ({
        module: 'lyrics',
        sourceId: String(h.id),
        label: h.title,
        sub: [h.composer, h.category, h.language].filter(Boolean).join(' · '),
      }));
    }
    case 'lectionary': {
      const day = await bridge.lectionary.getDay(date);
      // The Gospel Acclamation is entered for Praise & Worship only. Mass plans never list it.
      return day.readings
        .filter((r) => r.rawText && r.readingType !== GOSPEL_ACCLAMATION)
        .map((r): LibraryItem => ({
          module: 'lectionary',
          sourceId: `${date}|${r.readingType}`,
          label: r.readingType,
          sub: [day.seasonInfo, r.citation].filter(Boolean).join(' · '),
        }))
        .filter((item) => match(`${item.label} ${item.sub}`));
    }
    case 'announcements': {
      const slides = await bridge.announcements.slides(null);
      return slides
        .filter((s) => match(s.name))
        .map((s): LibraryItem => ({
          module: 'announcements',
          sourceId: String(s.id),
          label: s.name,
          sub: t(s.slideType === 'text' ? 'sub_text_slide' : 'sub_image_slide'),
        }));
    }
    case 'media': {
      const assets = await bridge.media.list();
      return assets
        .filter((m) => match(m.filename))
        .map((m): LibraryItem => ({
          module: 'media',
          sourceId: String(m.id),
          label: m.filename,
          sub: t(m.mediaType === 'video' ? 'sub_video' : 'sub_image'),
        }));
    }
    case 'mass_order':
      // The built-in parts, then the parish's own items, each under its title now (in English and in the language shown, for the search).
      return allMassParts()
        .filter((p) => match(`${massPartName(p, 'en')} ${massPartName(p, lang)}`))
        .map((p): LibraryItem => ({
          module: 'mass_order',
          sourceId: p.id,
          label: massPartName(p, lang),
          sub: t(p.custom ? 'moParishItem' : 'sub_mass_order'),
        }));
    // Notes are typed into the panel, not picked from a library.
    case 'custom':
      return [];
    // Prayers are pushed from the Notes & Prayers module, not picked from this library.
    case 'notes':
      return [];
  }
}

export function MassPlanner() {
  const t = usePlannerT();
  const lang = useUi((s) => s.lang);
  const region = useRegion();
  const [tab, setTab] = useState<SourceModule>('lyrics');
  const [query, setQuery] = useState('');
  const [readingDate, setReadingDate] = useState(upcomingSunday);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [bibleTranslation, setBibleTranslation] = useState('WEB');
  const [translations, setTranslations] = useState<Translation[]>([]);

  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  // Bumped when a song changes in Song Lyrics; the library search and the plan's song rows read the song again.
  const [lyricsRevision, setLyricsRevision] = useState(0);
  // The current title and deleted state of each song in the plan, from the library.
  const [hymnNow, setHymnNow] = useState<Record<number, { title?: string; deleted: boolean }>>({});
  const [creating, setCreating] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteBlock, setNoteBlock] = useState<LiturgicalBlock>('introductory');

  const [drop, setDrop] = useState<{ block: LiturgicalBlock; slot: number } | null>(null);
  // The step row being filled from the library or by typed text, and the text typed for it.
  const [choosing, setChoosing] = useState<number | null>(null);
  const [typedText, setTypedText] = useState('');
  // The song category the song list is filtered by while a song step is being filled. Empty means all songs.
  const [songFilter, setSongFilter] = useState('');
  const [songCategories, setSongCategories] = useState<SongCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The Holy Mass Order part whose words are being edited (`id: null` is a new parish item), and the parish's own words (so the library marks edited parts).
  const [editingPart, setEditingPart] = useState<{ id: string | null } | null>(null);
  const massOrderTexts = useMassOrderTexts((s) => s.overrides);
  const massOrderRevision = useMassOrderTexts((s) => s.revision);
  /** Plan rows with each Holy Mass Order part under its title now; a deleted parish item is marked missing. */
  const named = (list: PlanItem[]) => withPartNames(list, (id) => {
    const part = findMassPart(id);
    return part ? massPartName(part, lang) : null;
  });
  const dragRef = useRef<DragSource | null>(null);
  const fail = (err: unknown) => setError(errorText(err));

  /** Reloads the plan list and selects `prefer`, or the first plan when it is null. */
  const reloadPlans = (prefer: number | null) =>
    api.list().then((list) => {
      setPlans(list);
      setPlanId(prefer ?? list[0]?.id ?? null);
    }).catch(fail);

  useEffect(() => {
    // A plan the Go Live hub asked to open is taken once, here. Otherwise the first plan is shown, as before.
    const requested = useUi.getState().pendingMassPlanId;
    if (requested != null) setUi({ pendingMassPlanId: null });
    void reloadPlans(requested);
  }, []);

  useEffect(() => {
    setNotice(null);
    if (planId == null) {
      setItems([]);
      return;
    }
    api.get(planId).then((plan) => setItems(plan.items)).catch(fail);
  }, [planId]);

  useEffect(() => {
    bridge.bible.getTranslations().then(setTranslations).catch(() => undefined);
    bridge.lyrics.listSongCategories().then(setSongCategories).catch(() => undefined);
  }, []);

  // The library search is debounced so typing does not send a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadLibrary(tab, query, readingDate, lang, t, bibleTranslation, songFilter || undefined).then(setLibrary).catch(fail);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [tab, query, readingDate, lang, bibleTranslation, songFilter, lyricsRevision, massOrderRevision]);

  useEffect(() => bridge.lyrics.onChanged(() => setLyricsRevision((n) => n + 1)), []);

  // A song's title, and whether it was deleted, come from the library now, not from the title saved with the plan.
  useEffect(() => {
    const ids = [...new Set(items.filter((it) => it.module === 'lyrics').map((it) => Number(it.sourceId)))];
    let cancelled = false;
    Promise.all(
      ids.map(async (id) => {
        try {
          const hymn = await bridge.lyrics.getHymn(id);
          return [id, hymn ? { title: hymn.title, deleted: Boolean(hymn.deletedAt) } : { deleted: true }] as const;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (!cancelled) setHymnNow(Object.fromEntries(pairs.filter((p): p is NonNullable<typeof p> => p !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [items, lyricsRevision]);

  /** Saves the plan's items. On failure the stored plan is reloaded, so the screen never disagrees with the database. */
  const persist = async (next: PlanItem[]) => {
    if (planId == null) return;
    setItems(next);
    setError(null);
    setNotice(null);
    try {
      await api.save(planId, next);
      const stored = await api.get(planId);
      setItems(stored.items);
      syncQueueIfLoaded(planId, stored.items);
    } catch (err) {
      fail(err);
      const stored = await api.get(planId);
      setItems(stored.items);
      syncQueueIfLoaded(planId, stored.items);
    }
  };

  /** Puts a new source in place of a step's placeholder, and saves the plan through the same path as a drop. */
  const replaceAt = (index: number, next: PlanItem) => {
    setChoosing(null);
    setTypedText('');
    void persist(items.map((item, i) => (i === index ? next : item)));
  };

  /** Opens the choice for a step: songs come from the song list, readings from the Bible list. */
  const chooseStep = (index: number, step: MassStep) => {
    setChoosing(index);
    setTypedText('');
    setTab(step.kind === 'reading' ? 'bible' : 'lyrics');
    // A song step starts on its own song category. The operator can switch to all songs.
    setSongFilter(songCategoryOf(step) ?? '');
  };

  /** A library row picked for the step being filled. */
  const pickFromLibrary = (item: LibraryItem) => {
    if (choosing == null) return;
    replaceAt(choosing, { block: items[choosing].block, module: item.module, sourceId: item.sourceId, label: item.label });
  };

  const dropAt = (block: LiturgicalBlock, slot: number) => {
    const source = dragRef.current;
    dragRef.current = null;
    setDrop(null);
    if (!source) return;
    if (planId == null) {
      setError(t('createPlanFirst'));
      return;
    }
    // A row that fills a slot and is dropped among the additional items stops filling the slot, so the section's slot order holds.
    const base = source.kind === 'plan' ? items.map((it, i) => (i === source.index ? { ...it, slot: null } : it)) : items;
    void persist(moveInto(base, source, block, slot));
  };

  /** Puts an item in a Holy Mass slot, replacing what was there, and saves the plan through the same path as a drop. */
  const fillSlot = (slotId: string, item: PickedItem) => {
    if (planId == null) {
      setError(t('createPlanFirst'));
      return;
    }
    void persist(placeInSlot(items, slotId, item));
  };

  const emptySlot = (slotId: string) => void persist(clearSlot(items, slotId));

  /** A library item or a plan row dropped on a slot fills it. A plan row leaves its own place, which becomes empty (or an empty slot). */
  const dropOnSlot = (slotId: string) => {
    const source = dragRef.current;
    dragRef.current = null;
    setDrop(null);
    if (!source) return;
    if (planId == null) {
      setError(t('createPlanFirst'));
      return;
    }
    void persist(source.kind === 'library' ? placeInSlot(items, slotId, source.item) : moveToSlot(items, source.index, slotId));
  };

  /** Loads a template's items into the plan, replacing its own. */
  const applyTemplate = (next: PlanItem[], name: string, skipped: number) => {
    if (planId == null) return;
    setNotice(null);
    void persist(next).then(() => setNotice(skipped > 0 ? t('templateLoadedSkipped', { name, n: next.length, skipped }) : t('templateLoaded', { name, n: next.length })));
  };

  const removeAt = (index: number) => {
    if (index < 0 || index >= items.length) return;
    void persist(items.filter((_, i) => i !== index));
  };

  /** Swaps a row with its neighbour in the same block. Other blocks never move, so Mass order holds. */
  const nudge = (index: number, delta: -1 | 1) => {
    if (index < 0 || index >= items.length) return;
    // Slots keep their order, so only the additional items of a section move up and down.
    const members = additionalIn(items, items[index].block);
    const to = members[members.indexOf(index) + delta];
    if (to === undefined) return;
    const next = [...items];
    [next[index], next[to]] = [next[to], next[index]];
    void persist(next);
  };

  /** Adds an operator-only note at the end of its block. Notes are never sent to the projector. */
  const addNote = (e: FormEvent) => {
    e.preventDefault();
    const text = noteText.trim();
    if (!text) return;
    if (planId == null) {
      setError(t('createPlanFirst'));
      return;
    }
    setNoteText('');
    const slot = blockRows(items, noteBlock).length;
    void persist(moveInto(items, { kind: 'library', item: { module: 'custom', sourceId: text, label: text } }, noteBlock, slot));
  };

  /** After a row is staged: opens the floating preview panel, which shows the staged slide. No output is switched on, so no window opens. */
  const showStaged = () => setUi(SHOW_STAGED_UI);

  /** Stages one row in its module, loading the plan into the queue first so the cursor matches the row. */
  const stageRow = async (index: number) => {
    if (planId == null || index < 0 || index >= items.length) return;
    const queue = queueFromPlan(named(items));
    // Same plan: the reducer keeps the cursor. A different plan in the queue is replaced by this one.
    dispatch({ type: 'queue/set', items: queue, planId });
    setError(null);
    try {
      const row = items[index];
      // A plain-text response (I confess…, May the Lord accept…) has no module to open in, so it is staged as a text slide.
      const textActions = textRowActions(row, index, MASS_SLOTS.find((s: { id: string }) => s.id === row.slot)?.name ?? row.label);
      if (textActions) {
        for (const action of textActions) dispatch(action);
        showStaged();
      } else if (!canStageRow(row)) {
        // An operator note: it is never shown, so there is nothing to stage.
      } else if (row.module === 'lyrics') {
        // A song: its title and first stanza are read from the library and staged here, with the rest a click away. The planner is not left for the song deck.
        const actions = songRowActions(row, index, await bridge.lyrics.getHymn(Number(row.sourceId)));
        if (!actions) throw new Error(t('stale'));
        for (const action of actions) dispatch(action);
        showStaged();
      } else if (queue[index]) {
        // A reading, passage or Mass Order part is staged by its module (it answers true when it did), and the preview shows it as well.
        if (await openQueueItem(queue[index], index, { inPlace: true })) showStaged();
      }
    } catch (err) {
      fail(err);
    }
  };

  /** Loads the plan into the Service Queue and records which plan is active, so a restart can restore it. */
  const loadToQueue = () => {
    dispatch({ type: 'queue/set', items: queueFromPlan(named(items)), planId });
    setUi({ queueOpen: true });
    setNotice(t('loadedNotice', { n: items.length }));
  };

  /** Makes a plan from the New plan form. Standard Sunday stores nothing (its 17 slots are empty); Weekday fills its slots. */
  const createPlan = async ({ name, liturgicalDate, template }: { name: string; liturgicalDate: string; template: NewPlanTemplate }) => {
    setError(null);
    try {
      const created = await api.create({ name, liturgicalDate });
      const fills = builtInItems(template, lang);
      if (fills.length > 0) await api.save(created.id, fills);
      setCreating(false);
      await reloadPlans(created.id);
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const deletePlan = async () => {
    if (planId == null || !window.confirm(t('confirmDeletePlan'))) return;
    try {
      await api.deletePlan(planId);
      await reloadPlans(null);
    } catch (err) {
      fail(err);
    }
  };

  /**
   * One additional item's row: an item that fills no slot (a note, an announcement, a plan from before slots, a placeholder step). `extra` is its
   * place among the section's additional items; its place among all of the section's rows is what a drop and a move use.
   */
  const renderAdditional = (row: PlanItem, rows: PlanItem[], extra: number, blockId: LiturgicalBlock) => {
    const index = shown.indexOf(row);
    const slot = blockRows(shown, blockId).indexOf(row);
    const marked = drop?.block === blockId && drop.slot === slot;
    const step = row.module === 'custom' ? stepFor(row.sourceId) : null;
    return (
                        <Fragment key={`${index}:${row.module}:${row.sourceId}`}>
                        <li
                          draggable
                          onDragStart={() => {
                            dragRef.current = { kind: 'plan', index };
                          }}
                          onDragEnd={() => {
                            dragRef.current = null;
                            setDrop(null);
                          }}
                          onDragOver={(e) => {
                            if (!dragRef.current) return;
                            e.preventDefault();
                            setDrop({ block: blockId, slot });
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            dropAt(blockId, slot);
                          }}
                          className={`group flex items-center gap-3 rounded-lg border-t-2 px-2 py-2 transition ${marked ? 'border-accent' : 'border-transparent'} ${
                            row.stale ? 'bg-danger/5' : 'hover:bg-fg/[0.06]'
                          }`}
                        >
                          {row.stale && <AlertTriangle size={15} className="shrink-0 text-danger" aria-label={t('stale')} />}
                          <span className="w-5 shrink-0 text-center font-mono text-[11px] text-fg/40 tabular-nums">{extra + 1}</span>
                          {/* A placeholder step says what it is in its own name, so it has no type tag. */}
                          {!step && <span className={`${TAG} ${toneOf(row.module)}`}>{t(MODULE_KEY[row.module])}</span>}
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-sm font-semibold ${row.stale ? 'text-fg/50 line-through' : 'text-fg'}`}>{row.label}</span>
                            {row.stale && <span className="block text-[11px] text-danger">{row.deleted ? t('deletedHymnStatus') : t('stale')}</span>}
                            {step && <span className="block text-[11px] text-fg/60">{t('pendingStep')}</span>}
                          </span>
                          {row.stale && (
                            <span className="shrink-0 rounded bg-danger px-1.5 py-0.5 text-[10px] font-extrabold text-canvas uppercase">{t('staleBadge')}</span>
                          )}
                          {step && (
                            <button type="button" onClick={() => chooseStep(index, step)} className="h-8 shrink-0 rounded-md border border-fg/15 px-3 text-[11px] font-bold uppercase hover:bg-fg/10">
                              {t('choose')}
                            </button>
                          )}
                          <div className="flex shrink-0 items-center opacity-50 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => nudge(index, -1)}
                              disabled={rows[0] === row}
                              aria-label={t('moveUp')}
                              title={t('moveUp')}
                              className="grid size-7 place-items-center rounded text-muted hover:text-fg disabled:opacity-30"
                            >
                              <ArrowUp size={13} aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => nudge(index, 1)}
                              disabled={rows[rows.length - 1] === row}
                              aria-label={t('moveDown')}
                              title={t('moveDown')}
                              className="grid size-7 place-items-center rounded text-muted hover:text-fg disabled:opacity-30"
                            >
                              <ArrowDown size={13} aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => void stageRow(index)}
                              disabled={!canStageRow(row)}
                              aria-label={t('stage')}
                              aria-pressed={index === activeIndex}
                              title={t('stage')}
                              className={`grid size-7 place-items-center rounded hover:text-accent disabled:opacity-30 ${index === activeIndex ? 'bg-accent text-on-accent hover:text-on-accent' : 'text-muted'}`}
                            >
                              <Play size={13} aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeAt(index)}
                              aria-label={t('removeItem', { label: row.label })}
                              className="grid size-7 place-items-center rounded text-muted hover:text-danger"
                            >
                              <Trash2 size={13} aria-hidden />
                            </button>
                          </div>
                        </li>
                        {step && choosing === index && (
                          <li className="flex flex-col gap-2 rounded-md border border-fg/15 bg-panel-2 p-3 pl-10">
                            <p className="text-xs text-muted">{t(step.kind === 'reading' ? 'chooseReading' : 'chooseSong')}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                value={typedText}
                                onChange={(e) => setTypedText(e.target.value)}
                                maxLength={300}
                                placeholder={t('chooseText')}
                                aria-label={t('chooseText')}
                                className="h-9 min-w-0 flex-1 rounded-md border border-fg/15 bg-panel px-3 text-sm outline-none focus:border-accent"
                              />
                              <button
                                type="button"
                                disabled={!typedText.trim()}
                                onClick={() => replaceAt(index, { block: row.block, module: 'custom', sourceId: typedText.trim(), label: typedText.trim() })}
                                className="h-9 rounded-md border border-fg/15 px-3 text-xs font-bold uppercase hover:bg-fg/10 disabled:opacity-40"
                              >
                                {t('chooseTextAdd')}
                              </button>
                              {step.massOrderId && MASS_ORDER.some((p) => p.id === step.massOrderId) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const part = MASS_ORDER.find((p) => p.id === step.massOrderId);
                                    if (part) replaceAt(index, { block: row.block, module: 'mass_order', sourceId: part.id, label: massPartName(part, lang) });
                                  }}
                                  className="h-9 rounded-md border border-fg/15 px-3 text-xs font-bold uppercase hover:bg-fg/10"
                                >
                                  {t('chooseMassOrder')}
                                </button>
                              )}
                              <button type="button" onClick={() => { setChoosing(null); setTypedText(''); }} className="h-9 rounded-md px-3 text-xs font-bold uppercase text-muted hover:text-fg">
                                {t('chooseCancel')}
                              </button>
                            </div>
                          </li>
                        )}
                        </Fragment>
    );
  };

  // What the plan shows: the saved items with each song's current title and status laid over them. It has one entry for every saved item,
  // in the same order, so a position in this list is a position in `items`.
  const shown = named(overlayLyricsItems(items, hymnNow));
  // The row loaded into the Stage / Preview by its ▷ button: the queue's CURRENT row, when the queue holds this plan.
  const activeIndex = useLive((s) => activeRowIndex(s.state, planId));

  const currentPlan = plans.find((p) => p.id === planId) ?? null;
  const cycle = currentPlan ? sundayCycle(new Date(`${currentPlan.liturgicalDate}T12:00:00`)) : null;

  return (
    <div className="flex flex-1 flex-col">
      <header className="px-5 pt-5 pb-4">
        <div className="text-sm font-semibold tracking-wider text-accent uppercase">{t('eyebrow')}</div>
        <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">{t('title')}</h1>
        <p className="mt-1 text-sm text-fg/70">{t('subtitle')}</p>
      </header>

      {(error || notice) && (
        <div role={error ? 'alert' : 'status'} className={`mx-5 mb-4 rounded-lg border px-4 py-2 text-sm ${error ? 'border-danger/50 bg-danger/10 text-danger' : 'border-ok/50 bg-ok/10 text-ok'}`}>
          {error ?? notice}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 items-start gap-5 px-5 pb-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        {/* ── Left: library browser ── */}
        <section className="flex min-h-[480px] flex-col overflow-hidden rounded-[10px] border border-line bg-panel xl:sticky xl:top-5 xl:max-h-[calc(100vh-9rem)]">
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <div role="tablist" className="flex flex-wrap gap-1">
              {TABS.map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === tb.id}
                  onClick={() => setTab(tb.id)}
                  className={`rounded-md border px-2.5 py-1.5 text-[11px] font-semibold tracking-wide uppercase transition ${
                    tab === tb.id ? 'border-accent bg-accent text-on-accent' : 'border-fg/15 bg-panel-2 text-fg/75 hover:bg-fg/10 hover:text-fg'
                  }`}
                >
                  {t(tb.key)}
                </button>
              ))}
            </div>
            {tab !== 'custom' && (
              <label className="relative">
                <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('search')}
                  className="h-10 w-full rounded-md border border-fg/15 bg-panel-2 pr-3 pl-9 text-sm outline-none focus:border-accent"
                />
              </label>
            )}
            {tab === 'bible' && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <span className="eyebrow">{t('bible_translation')}</span>
                <select
                  value={bibleTranslation}
                  onChange={(e) => setBibleTranslation(e.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border border-fg/15 bg-panel-2 px-2 text-sm text-fg outline-none focus:border-accent"
                >
                  {translations.map((tr) => (
                    <option key={tr.id} value={tr.id}>{tr.name}</option>
                  ))}
                </select>
              </label>
            )}
            {tab === 'lectionary' && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="eyebrow">{t('date')}</span>
                <input
                  type="date"
                  value={readingDate}
                  onChange={(e) => setReadingDate(e.target.value)}
                  className="h-9 rounded-md border border-fg/15 bg-panel-2 px-2 text-sm text-fg outline-none focus:border-accent"
                />
              </div>
            )}
          </div>

          {tab === 'custom' && (
            <form onSubmit={addNote} className="flex flex-col gap-3 p-4">
              <p className="text-xs text-muted">{t('customHint')}</p>
              <input
                maxLength={300}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={t('customPlaceholder')}
                aria-label={t('addNote')}
                className="h-10 rounded-md border border-fg/15 bg-panel-2 px-3 text-sm outline-none focus:border-accent"
              />
              <label className="flex items-center gap-2 text-xs text-muted">
                <span className="eyebrow">{t('customBlock')}</span>
                <select
                  value={noteBlock}
                  onChange={(e) => setNoteBlock(e.target.value as LiturgicalBlock)}
                  className="h-9 min-w-0 flex-1 rounded-md border border-fg/15 bg-panel-2 px-2 text-sm text-fg outline-none focus:border-accent"
                >
                  {BLOCKS.map((b) => (
                    <option key={b.id} value={b.id}>{t(b.titleKey)}</option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={!noteText.trim()} className="h-10 rounded-md bg-accent px-4 text-xs font-extrabold uppercase text-on-accent disabled:opacity-40">
                {t('addNote')}
              </button>
            </form>
          )}

          {choosing != null && tab === 'lyrics' && (
            <label className="flex items-center gap-2 border-t border-line px-3 py-2">
              <span className="eyebrow shrink-0">{t('songFilterLabel')}</span>
              <select
                value={songFilter}
                onChange={(e) => setSongFilter(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border border-fg/15 bg-panel-2 px-2 text-sm outline-none focus:border-accent"
              >
                <option value="">{t('songFilterAll')}</option>
                {songCategories.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          {tab === 'mass_order' && (
            <div className="border-b border-line p-2">
              <button
                type="button"
                onClick={() => setEditingPart({ id: null })}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-accent/50 text-xs font-bold tracking-wide text-accent uppercase transition hover:bg-accent/10"
              >
                <Plus size={14} aria-hidden /> {t('moNew')}
              </button>
            </div>
          )}
          {tab !== 'custom' && <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            {library.length === 0 && <li className="p-4 text-sm text-fg/60">{t('nothingHere')}</li>}
            {library.map((item) => (
              <li
                key={`${item.module}:${item.sourceId}`}
                draggable
                onDragStart={() => {
                  dragRef.current = { kind: 'library', item: { module: item.module, sourceId: item.sourceId, label: item.label } };
                }}
                onDragEnd={() => {
                  dragRef.current = null;
                  setDrop(null);
                }}
                onClick={() => pickFromLibrary(item)}
                className="group flex cursor-grab items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-fg/[0.06]"
              >
                <span className={`${TAG} ${toneOf(item.module)}`}>{t(MODULE_KEY[item.module])}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-fg">{item.label}</div>
                  <div className="truncate text-[11px] text-fg/60">
                    {item.sub}
                    {item.module === 'mass_order' && !isCustomId(item.sourceId) && isCustomized(item.sourceId, lang, massOrderTexts) && <span className="ml-1.5 rounded bg-accent/15 px-1 text-[10px] font-semibold text-accent">{t('moCustomized')}</span>}
                  </div>
                </div>
                {item.module === 'mass_order' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      // Editing never adds the part to the plan.
                      e.stopPropagation();
                      setEditingPart({ id: item.sourceId });
                    }}
                    aria-label={t('moEdit', { part: item.label })}
                    title={t('moEdit', { part: item.label })}
                    className="grid size-7 shrink-0 place-items-center rounded-md border border-fg/15 text-fg/60 opacity-60 transition hover:border-accent hover:text-accent group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Pencil size={13} aria-hidden />
                  </button>
                )}
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md border border-fg/15 text-fg/60 opacity-60 transition group-hover:border-accent group-hover:text-accent group-hover:opacity-100">
                  <Plus size={14} />
                </span>
              </li>
            ))}
          </ul>}
          {tab !== 'custom' && <p className="border-t border-line p-3 text-[11px] text-fg/60">{t('dragHintLeft')}</p>}
        </section>

        {/* ── Right: the plan ── */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-panel p-3 shadow-lg shadow-black/20">
            <ListMusic size={16} aria-hidden className="text-accent" />
            {plans.length > 0 ? (
              <select
                value={planId ?? ''}
                onChange={(e) => setPlanId(Number(e.target.value))}
                aria-label={t('title')}
                className="h-10 min-w-0 flex-1 rounded-md border border-fg/15 bg-panel-2 px-2 text-sm text-fg outline-none focus:border-accent"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{formatIsoDay(p.liturgicalDate, region)} · {p.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-fg/60">{t('noPlans')}</span>
            )}
            <button type="button" onClick={() => setCreating((open) => !open)} className="h-10 rounded-md border border-fg/15 bg-panel-2 px-3 text-xs font-semibold tracking-wide uppercase text-fg/85 transition hover:bg-fg/10 hover:text-fg">
              {creating ? t('cancel') : t('newPlan')}
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setTemplatesOpen((open) => !open)}
                disabled={planId == null}
                aria-expanded={templatesOpen}
                aria-haspopup="dialog"
                className="h-10 rounded-md border border-fg/15 bg-panel-2 px-3 text-xs font-semibold tracking-wide uppercase text-fg/85 transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('templates')}
              </button>
              {templatesOpen && planId != null && (
                <MassTemplates t={t} lang={lang} items={items} onApply={applyTemplate} onError={setError} onNotice={setNotice} onClose={() => setTemplatesOpen(false)} />
              )}
            </div>
            {planId != null && (
              <button type="button" onClick={deletePlan} aria-label={t('deletePlan')} title={t('deletePlan')} className="grid size-10 place-items-center rounded-md border border-fg/15 bg-panel-2 text-fg/60 transition hover:border-danger/60 hover:text-danger">
                <Trash2 size={14} aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={loadToQueue}
              disabled={items.length === 0}
              className="ml-auto flex h-10 items-center gap-2 rounded-md border border-accent bg-accent px-4 text-xs font-extrabold tracking-wider uppercase text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={14} aria-hidden /> {t('loadQueue')}
            </button>
          </div>

          {currentPlan && cycle && (
            <p className="px-1 text-xs text-fg/60">{t('planLine', { name: currentPlan.name, cycle, n: items.length })}</p>
          )}

          {editingPart && <HolyMassOrderEditor key={editingPart.id ?? 'new'} partId={editingPart.id} lang={lang} t={t} onClose={() => setEditingPart(null)} onNotice={setNotice} />}
          {creating && <NewPlanForm t={t} initialDate={upcomingSunday()} onCreate={createPlan} />}

          {planId == null ? (
            <p className="rounded-[10px] border-2 border-dashed border-fg/20 p-8 text-center text-sm text-fg/60">{t('createFirst')}</p>
          ) : (
            <HolyMassPlan
              t={t}
              lang={lang}
              items={shown}
              onFill={fillSlot}
              onClear={emptySlot}
              onDropOnSlot={dropOnSlot}
              onDropInSection={dropAt}
              onStage={(index) => void stageRow(index)}
              activeIndex={activeIndex}
              dragRef={dragRef}
              drop={drop}
              setDrop={setDrop}
              renderAdditional={renderAdditional}
            />
          )}
        </section>
      </div>
    </div>
  );
}
