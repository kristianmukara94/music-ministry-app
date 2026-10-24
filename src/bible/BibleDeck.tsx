import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, Scissors, Search, X } from 'lucide-react';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import type { Frame, PassageMark } from '../../shared/live.js';
import { formatRuns, formatSourceId, parseCitation, resolveBookCode, runsOf } from '../../shared/bible-ref.js';
import { BACKGROUND_COLORS, parseTextStyle, sanitizeTextStyle, type TextStyle } from '../../shared/text-style.js';
import { ColorField, StyleToolbar } from '../announcements/StyleControls';
import { SlidePreview } from '../announcements/TextSlideModal';
import { appendToPlan, addToQueue } from '../planner/plan-api';
import { BLOCKS, type LiturgicalBlock, type PlanItem, type PlanSummary } from '../planner/types';
import { usePlannerT } from '../planner/strings';
import { scriptureSlides } from './projection';
import { AddNoteOverlayModal } from './AddNoteOverlayModal';
import { useBibleT } from './strings';
import type { BibleBook, ChapterInfo, SearchHit, Testament, Translation, Verse } from './types';

const api = bridge.bible;
/**
 * The verse list text size on the operator screen only, in pixels. It is a viewing comfort setting: it never changes the
 * projected text, which has its own size. Kept between the limits, and remembered on this machine.
 */
const OPERATOR_LIST_FONT_MIN = 14;
const OPERATOR_LIST_FONT_MAX = 24;
const OPERATOR_LIST_FONT_DEFAULT = 18;
const OPERATOR_LIST_FONT_KEY = 'apcc_bible_operator_font_size';

const clampOperatorListFont = (n: number) => Math.min(OPERATOR_LIST_FONT_MAX, Math.max(OPERATOR_LIST_FONT_MIN, Math.round(n)));

function loadOperatorListFontSize(): number {
  try {
    const saved = Number(localStorage.getItem(OPERATOR_LIST_FONT_KEY));
    return Number.isFinite(saved) && saved >= OPERATOR_LIST_FONT_MIN && saved <= OPERATOR_LIST_FONT_MAX ? Math.round(saved) : OPERATOR_LIST_FONT_DEFAULT;
  } catch {
    return OPERATOR_LIST_FONT_DEFAULT;
  }
}

function saveOperatorListFontSize(size: number) {
  try {
    localStorage.setItem(OPERATOR_LIST_FONT_KEY, String(size));
  } catch {
    /* storage unavailable: the size lasts for this session */
  }
}
const STYLE_KEY = 'apccmma.bible.style';

type Scope = 'all' | 'ot' | 'nt' | 'book';
type DeckFrame = Extract<Frame, { kind: 'deck' }>;
/** The verse on the projector. It keeps the book and chapter it was sent from, so browsing does not change it. */
interface Projection {
  translationId: string;
  bookNumber: number;
  bookName: string;
  chapter: number;
  verse: Verse;
}

/** A reference typed in the search box, waiting for its chapter to load before its verses are selected. */
interface PendingRange {
  key: string;
  from: number;
  to: number;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The text style, remembered on this machine only. A failed read or write keeps the default. */
function loadStyle(): TextStyle {
  try {
    return parseTextStyle(localStorage.getItem(STYLE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveStyle(style: TextStyle) {
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(style));
  } catch {
    /* storage unavailable: the style still applies for this session */
  }
}

/** LIVE is filled gold, as in the Announcements deck. */
function LiveBadge({ children }: { children: string }) {
  return (
    <span className="ml-2 inline-flex items-center rounded border border-amber-500/50 bg-amber-500/20 px-1.5 py-0.5 align-middle text-[10px] font-extrabold uppercase text-amber-300">
      {children}
    </span>
  );
}

/** Low-profile pill for every action. Primary actions take the gold gradient. */
const PILL =
  'flex h-9 shrink-0 items-center gap-2 rounded-full border border-fg/10 bg-fg/[0.03] px-4 text-[11px] font-bold uppercase tracking-[0.12em] text-fg/80 transition hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40';
/** Square icon-only control for the text-size buttons. Kept apart from PILL so no horizontal padding applies. */
const ICON =
  'grid size-9 shrink-0 place-items-center rounded-full border border-fg/10 bg-fg/[0.03] text-fg/80 transition hover:border-accent/30 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40';
const PRIMARY =
  'border-accent bg-gradient-to-r from-accent/20 to-accent/10 text-accent shadow-[0_0_15px_color-mix(in_oklab,var(--color-accent)_20%,transparent)]';
/** Inputs sit on dark glass so they stay legible over every theme. */
const FIELD = 'h-9 rounded-full border border-fg/10 bg-black/30 px-3 text-xs text-fg outline-none transition focus:border-accent/50';
const GLASS = 'surface-glass flex min-h-0 min-w-0 flex-col gap-3 rounded-2xl p-4';
/** The small control that marks a manual slide break, placed at the top-right of a selected verse. */
const SPLIT =
  'absolute top-3 right-3 flex h-7 items-center gap-1 rounded-full border px-2.5 text-[10px] font-bold uppercase tracking-[0.12em] transition disabled:opacity-40';

/** Search hits wrap matched words in « and ». Splitting on them keeps the markup out of the snippet text. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(/[«»]/).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-accent/30 px-0.5 text-accent">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function BibleDeck() {
  const t = useBibleT();
  const pt = usePlannerT();
  const [translations, setTranslations] = useState<Translation[] | null>(null);
  const [translationId, setTranslationId] = useState('WEB');
  const [compareId, setCompareId] = useState('');
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [testament, setTestament] = useState<Testament>('OT');
  const [bookNumber, setBookNumber] = useState<number | null>(null);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [chapter, setChapter] = useState<number | null>(null);
  const [verses, setVerses] = useState<Verse[]>([]);
  /** The chapter the verses above belong to, so a pending reference is applied only to the right chapter. */
  const [loadedKey, setLoadedKey] = useState('');
  const [compareVerses, setCompareVerses] = useState<Verse[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  /** Verse numbers that start a new slide. Only selected verses after the first can be breaks. */
  const [breaks, setBreaks] = useState<number[]>([]);
  // The one verse on the projector, or null when nothing is projected.
  const [projection, setProjection] = useState<Projection | null>(null);
  // A single click on a live verse waits briefly, in case a second click makes it a double-click.
  const liveOffTimer = useRef<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [pendingRange, setPendingRange] = useState<PendingRange | null>(null);
  const [style, setStyle] = useState<TextStyle>(loadStyle);
  const [operatorListFontSize, setOperatorListFontSize] = useState(loadOperatorListFontSize);
  // Saved on every change, so the reading size is the same the next time the app opens.
  useEffect(() => saveOperatorListFontSize(operatorListFontSize), [operatorListFontSize]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [block, setBlock] = useState<LiturgicalBlock>('word');
  const flashRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    api
      .getTranslations()
      .then((list) => {
        setTranslations(list);
        setTranslationId((current) => (list.some((tr) => tr.id === current) || !list.length ? current : list[0].id));
      })
      .catch((err) => setError(errorText(err)));
    bridge.plans
      .list()
      .then((list) => {
        setPlans(list);
        setPlanId((current) => current ?? list[0]?.id ?? null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let live = true;
    api
      .getBooks(translationId)
      .then((list) => {
        if (live) setBooks(list);
      })
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [translationId]);

  useEffect(() => {
    if (bookNumber === null) {
      setChapters([]);
      return;
    }
    let live = true;
    api
      .getChapters(translationId, bookNumber)
      .then((list) => {
        if (live) setChapters(list);
      })
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [translationId, bookNumber]);

  useEffect(() => {
    if (bookNumber === null || chapter === null) {
      setVerses([]);
      setLoadedKey('');
      return;
    }
    const key = `${translationId}:${bookNumber}:${chapter}`;
    let live = true;
    api
      .getVerses(translationId, bookNumber, chapter)
      .then((list) => {
        if (!live) return;
        setVerses(list);
        setLoadedKey(key);
      })
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [translationId, bookNumber, chapter]);

  useEffect(() => {
    if (!compareId || bookNumber === null || chapter === null) {
      setCompareVerses([]);
      return;
    }
    let live = true;
    api
      .getVerses(compareId, bookNumber, chapter)
      .then((list) => {
        if (live) setCompareVerses(list);
      })
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [compareId, bookNumber, chapter]);

  // A typed reference selects its verses once its chapter has loaded, so the old chapter's verses are never used.
  useEffect(() => {
    if (!pendingRange || pendingRange.key !== loadedKey) return;
    const numbers = verses.filter((v) => v.verse >= pendingRange.from && v.verse <= pendingRange.to).map((v) => v.verse);
    setSelected(numbers);
    setBreaks([]);
    setPreviewIndex(0);
    setFlash(pendingRange.from);
    setPendingRange(null);
  }, [pendingRange, loadedKey, verses]);

  // After a search jump, bring the matched verse into view.
  useEffect(() => {
    flashRef.current?.scrollIntoView({ block: 'center' });
  }, [flash, verses]);

  const changeTranslation = (id: string) => {
    setTranslationId(id);
    if (id === compareId) setCompareId('');
  };

  const chooseBook = (number: number) => {
    setBookNumber(number);
    setChapter(1);
    setSelected([]);
    setBreaks([]);
    setPreviewIndex(0);
    setFlash(null);
    setHits(null);
  };

  const chooseChapter = (n: number) => {
    setChapter(n);
    setSelected([]);
    setBreaks([]);
    setPreviewIndex(0);
    setFlash(null);
  };

  const scopeValue = (): string => {
    if (scope !== 'book') return scope;
    return bookNumber === null ? 'all' : String(bookNumber);
  };

  /** Moves the reader to a typed citation. The book is matched by its code, so abbreviations work in every translation. */
  const goToCitation = (citation: { book: string; chapter: number; from?: number; to?: number }) => {
    const code = resolveBookCode(citation.book);
    const book = books.find((b) => (code !== null && b.code === code) || b.name.toLowerCase() === citation.book.toLowerCase());
    if (!book) {
      setError(t('refNotFound', { ref: query.trim() }));
      return;
    }
    setError(null);
    setHits(null);
    setTestament(book.testament);
    setBookNumber(book.number);
    setChapter(citation.chapter);
    setSelected([]);
    setBreaks([]);
    setPreviewIndex(0);
    setFlash(null);
    if (citation.from !== undefined) {
      setPendingRange({
        key: `${translationId}:${book.number}:${citation.chapter}`,
        from: citation.from,
        to: citation.to ?? citation.from,
      });
    }
  };

  const runSearch = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    // A citation such as "John 3:16" or "Ps 23" goes to the passage. Anything else is searched for as words.
    const citation = parseCitation(q);
    if (citation) {
      goToCitation(citation);
      return;
    }
    try {
      setHits(await api.search({ query: q, translationId, scope: scopeValue() }));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const openHit = (hit: SearchHit) => {
    const hitTestament = books.find((b) => b.number === hit.bookNumber)?.testament;
    if (hitTestament) setTestament(hitTestament);
    setBookNumber(hit.bookNumber);
    setChapter(hit.chapter);
    setSelected([]);
    setBreaks([]);
    setPreviewIndex(0);
    setFlash(hit.verse);
    setHits(null);
  };

  const currentTranslation = translations?.find((tr) => tr.id === translationId);
  const bookName = books.find((b) => b.number === bookNumber)?.name ?? '';
  const chosen = verses.filter((v) => selected.includes(v.verse));
  const runs = runsOf(selected);
  const canUseSelection = chosen.length > 0 && chapter !== null && bookName !== '';
  // A break on the first selected verse would be an empty slide, so it is ignored. Breaks on unselected verses drop away.
  const activeBreaks = breaks.filter((n) => selected.includes(n) && n !== selected[0]);

  /** One plan item per contiguous run of selected verses, e.g. 16-17 and 19 become two items. */
  const selectionItems = (target: LiturgicalBlock): PlanItem[] =>
    runs.map((run) => {
      const range = formatRuns([run]);
      return {
        block: target,
        module: 'bible',
        sourceId: formatSourceId(translationId, bookName, chapter ?? 0, range),
        label: `${bookName} ${chapter}:${range} (${translationId})`,
      };
    });

  const live = useLive((s) => s.state.projector.live);
  const noteOverlay = useLive((s) => s.state.noteOverlay);

  /** The verses of the current chapter that the live frame shows, or none when it shows another passage. */
  const liveVerses = (() => {
    const mark: PassageMark | undefined = live.kind === 'deck' ? live.passage : undefined;
    if (!mark || mark.translationId !== translationId || mark.bookNumber !== bookNumber || mark.chapter !== chapter) return [];
    return mark.verses;
  })();

  /**
   * The slide for the verse on the projector: that one verse, with its citation. It is built from the projection as it
   * was sent, so browsing to another chapter does not change what is live.
   */
  const passageSlides = useMemo<DeckFrame | null>(() => {
    if (!projection) return null;
    return {
      kind: 'deck',
      title: '',
      index: 0,
      slides: scriptureSlides([projection.verse], { bookName: projection.bookName, chapter: projection.chapter }, t('pageLabel')),
      passage: { translationId: projection.translationId, bookNumber: projection.bookNumber, chapter: projection.chapter, verses: [projection.verse.verse] },
      style: sanitizeTextStyle(style),
    };
    // `t` is rebuilt each render; the projection and the style are the inputs that change.
  }, [projection, style]);

  const slideCount = passageSlides?.slides.length ?? 0;
  const shownIndex = Math.min(previewIndex, Math.max(0, slideCount - 1));

  /** Returns the live output to idle. The background is a separate layer, so it stays as it is. */
  const resetProjector = () => {
    dispatch({ type: 'projector/stage', frame: { kind: 'idle' } });
    dispatch({ type: 'projector/take' });
  };

  // Only what is projected, its style, or the slide shown goes live. Selecting a verse does not send it.
  useEffect(() => {
    if (!passageSlides) return;
    dispatch({ type: 'projector/stage', frame: { ...passageSlides, index: shownIndex } });
    dispatch({ type: 'projector/take' });
  }, [passageSlides, shownIndex]);

  // ── Verse gestures. A key held while clicking chooses what the click does. ──
  // P, Q and C are read from the keyboard, not the mouse event, so holding them is enough.
  const heldKeys = useRef(new Set<string>());
  // The verse the last plain click chose. Shift+click extends from it.
  const [anchor, setAnchor] = useState<number | null>(null);
  const [compareVerse, setCompareVerse] = useState<Verse | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);

  useEffect(() => {
    const typing = (e: KeyboardEvent) => Boolean((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]'));
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const key = e.key.toLowerCase();
      if (key === 'p' || key === 'q' || key === 'c') heldKeys.current.add(key);
    };
    const up = (e: KeyboardEvent) => {
      heldKeys.current.delete(e.key.toLowerCase());
    };
    const clear = () => heldKeys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // A different chapter starts a new range, so the old anchor is dropped.
  useEffect(() => setAnchor(null), [translationId, bookNumber, chapter]);

  /**
   * Sends one verse to the projector. Only one verse is live at a time: it replaces whatever was there, and the
   * selection narrows to it, so the list shows what is on screen.
   */
  const projectVerse = (v: Verse) => {
    if (chapter === null || bookNumber === null) return;
    setProjection({ translationId, bookNumber, bookName, chapter, verse: v });
    setSelected([v.verse]);
    setBreaks([]);
    setPreviewIndex(0);
    setAnchor(v.verse);
  };

  /** Turns off the verse that is live, and takes it out of the selection. The list and the badge follow the projector. */
  const turnOffVerse = (n: number) => {
    setProjection(null);
    resetProjector();
    setSelected((current) => current.filter((x) => x !== n));
  };

  /** Takes the verse off the projector and back to idle. The background is a separate layer, so it stays. */
  const clearProjection = () => {
    setProjection(null);
    resetProjector();
  };

  /** Shift+click: selects every verse between the anchor and this one, added to the current selection. */
  const extendRange = (n: number) => {
    const from = Math.min(anchor ?? n, n);
    const to = Math.max(anchor ?? n, n);
    const range = verses.filter((v) => v.verse >= from && v.verse <= to).map((v) => v.verse);
    setSelected((current) => [...new Set([...current, ...range])].sort((a, b) => a - b));
    setPreviewIndex(0);
  };

  /** Q+click: pushes the verse to the Mass Queue, in the block chosen under the reader. */
  const queueVerse = async (v: Verse) => {
    if (chapter === null) return;
    setError(null);
    try {
      await addToQueue([
        {
          block,
          module: 'bible',
          sourceId: formatSourceId(translationId, bookName, chapter, String(v.verse)),
          label: `${bookName} ${chapter}:${v.verse} (${translationId})`,
        },
      ]);
      setNotice(t('addedToQueue', { n: 1 }));
    } catch (err) {
      setError(errorText(err));
    }
  };

  /** Alt+click: saves the verse as a private operator note, ready to edit in Notes & Prayers. */
  const noteVerse = async (v: Verse) => {
    if (chapter === null) return;
    setError(null);
    try {
      await bridge.notes.save({
        title: `${bookName} ${chapter}:${v.verse} (${translationId})`,
        category: 'Presider Note',
        body: v.text,
        display: 'operator',
        style: null,
      });
      setNotice('Saved as a private note. Open Notes & Prayers to edit it.');
    } catch (err) {
      setError(errorText(err));
    }
  };

  /**
   * One click on a verse. The modifiers are checked in order: Shift extends a range, Q queues, C compares, Alt adds a
   * note, and P or Ctrl projects. With no modifier the click toggles the verse in the selection.
   */
  const onVerseClick = (e: MouseEvent<HTMLButtonElement>, v: Verse) => {
    // A double click arrives as two clicks. The double-click handler does the work, so the second click is ignored.
    if (e.detail > 1) return;
    // Q+click only queues. It returns before any selection, projector or preview change, so the live output stays put.
    if (heldKeys.current.has('q')) {
      e.preventDefault();
      e.stopPropagation();
      return void queueVerse(v);
    }
    if (e.shiftKey) return extendRange(v.verse);
    const held = heldKeys.current;
    if (held.has('c')) return setCompareVerse(v);
    if (e.altKey) return void noteVerse(v);
    if (held.has('p') || e.ctrlKey) return projectVerse(v);
    // A single click on the verse that is live turns its output off. Any other click only changes the list.
    if (liveVerses.includes(v.verse)) {
      const n = v.verse;
      liveOffTimer.current = window.setTimeout(() => {
        liveOffTimer.current = null;
        turnOffVerse(n);
      }, 220);
      return;
    }
    setAnchor(v.verse);
    toggleVerse(v.verse);
  };

  const toggleVerse = (n: number) => {
    const next = selected.includes(n) ? selected.filter((v) => v !== n) : [...selected, n].sort((a, b) => a - b);
    setSelected(next);
    setPreviewIndex(0);
    // A click only changes the list. Double-click, or P or Ctrl, is what sends a verse to the projector.
  };

  /** Selects every verse from `from` to `to`. Used by the quick selectors. */
  const selectRange = (from: number, to: number) => {
    const numbers = verses.filter((v) => v.verse >= from && v.verse <= to).map((v) => v.verse);
    setSelected(numbers);
    setBreaks([]);
    setPreviewIndex(0);
  };

  const rangeFrom = selected[0] ?? verses[0]?.verse ?? null;
  const rangeTo = selected[selected.length - 1] ?? rangeFrom;

  /** Turns a slide break before a verse on or off. Breaks belong to the current selection only. */
  const toggleBreak = (n: number) => {
    setBreaks((current) => (current.includes(n) ? current.filter((v) => v !== n) : [...current, n]));
    setPreviewIndex(0);
  };

  const changeStyle = (patch: TextStyle) => {
    const next = { ...style, ...patch };
    setStyle(next);
    saveStyle(sanitizeTextStyle(next) ?? {});
  };

  const handleClearSelection = () => {
    setSelected([]);
    setBreaks([]);
    setPreviewIndex(0);
  };

  const sendToQueue = async () => {
    if (!canUseSelection) return;
    setError(null);
    try {
      await addToQueue(selectionItems(block));
      setNotice(t('addedToQueue', { n: runs.length }));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const sendToPlan = async () => {
    if (!canUseSelection || planId === null) return;
    setError(null);
    try {
      await appendToPlan(planId, selectionItems(block));
      const name = plans.find((p) => p.id === planId)?.name ?? '';
      setNotice(t('addedToPlan', { name }));
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (translations && translations.length === 0) {
    return (
      <div className="p-5">
        <div className={`${GLASS} p-8`}>
          <h1 className="font-serif text-4xl font-semibold text-accent">{t('title')}</h1>
          <p className="mt-2 max-w-xl text-muted">{t('missing')}</p>
        </div>
      </div>
    );
  }

  const shownSlide = passageSlides && slideCount > 0 ? passageSlides.slides[shownIndex] : null;
  const chapterVerseNumbers = verses.map((v) => v.verse);

  return (
    <section aria-labelledby="bible-heading" className="flex flex-col gap-5 p-5">
      {/* Title and search share one header: the search is an embedded glass field, not a separate form. */}
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-fg/[0.06] pb-5">
        <div>
          <h1 id="bible-heading" className="font-serif text-[46px] leading-none font-semibold tracking-wide text-accent">{t('title')}</h1>
          <p className="mt-2 text-[15px] text-muted">{t('subtitle')}</p>
        </div>

        <form
          onSubmit={runSearch}
          role="search"
          className="flex max-w-2xl min-w-[min(100%,34rem)] flex-1 items-center gap-2 rounded-xl border border-fg/10 bg-black/30 p-1.5 pl-3 transition focus-within:border-accent/50 focus-within:shadow-[0_0_20px_color-mix(in_oklab,var(--color-accent)_15%,transparent)]"
        >
          <Search size={15} className="shrink-0 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            aria-label={t('scope')}
            className="h-8 rounded-lg bg-transparent px-2 text-xs text-muted outline-none"
          >
            <option value="all">{t('scopeAll')}</option>
            <option value="ot">{t('scopeOt')}</option>
            <option value="nt">{t('scopeNt')}</option>
            <option value="book" disabled={bookNumber === null}>{t('scopeBook')}</option>
          </select>
          <button type="submit" className={`${PILL} ${PRIMARY}`}>
            {t('search')}
          </button>
        </form>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-danger/40 bg-fg/[0.03] px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      {notice && !error && (
        <div role="status" className="rounded-xl border border-fg/10 bg-fg/[0.03] px-4 py-2 text-sm text-muted">
          {notice}
        </div>
      )}

      {translations === null ? (
        <p className="text-sm text-muted">{t('loading')}</p>
      ) : (
        <>
          {/* The three columns fill the window height, so the verse list needs little scrolling. */}
          <div className="grid min-h-0 gap-4 xl:min-h-[calc(100vh-19rem)] xl:grid-cols-[17rem_11rem_minmax(0,1fr)]">
            {/* Column 1: books, with a segmented Old/New Testament control. */}
            <div className={GLASS}>
              <h2 className="eyebrow">{t('booksHeading')}</h2>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/40 p-1">
                {(['OT', 'NT'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    aria-pressed={testament === tab}
                    onClick={() => setTestament(tab)}
                    className={`h-9 rounded-lg text-xs font-bold uppercase transition ${
                      testament === tab
                        ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_30%,transparent)]'
                        : 'text-muted hover:text-fg'
                    }`}
                  >
                    {tab === 'OT' ? t('oldTab') : t('newTab')}
                  </button>
                ))}
              </div>
              <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
                {books
                  .filter((b) => b.testament === testament)
                  .map((b) => {
                    const active = b.number === bookNumber;
                    return (
                      <li key={b.number}>
                        <button
                          type="button"
                          aria-current={active ? 'true' : undefined}
                          onClick={() => chooseBook(b.number)}
                          className={`flex w-full items-center gap-2 rounded-lg border-l-2 px-3 py-2 text-left text-sm transition ${
                            active
                              ? 'border-accent bg-accent/10 font-semibold text-accent'
                              : 'border-transparent text-muted hover:border-accent/60 hover:bg-fg/[0.03] hover:text-fg'
                          }`}
                        >
                          <span className="flex-1 truncate font-serif text-[15px]">{b.name}</span>
                          <span className="font-mono text-[11px] text-faint tabular-nums" title={t('chapterCount', { count: b.chapters ?? 0 })}>
                            {b.chapters ?? ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>

            {/* Column 2: square chapter tiles. */}
            <div className={GLASS}>
              <h2 className="eyebrow">{t('chaptersHeading')}</h2>
              {bookNumber === null ? (
                <p className="text-sm text-muted">{t('chooseChapter')}</p>
              ) : (
                <div className="grid min-h-0 flex-1 grid-cols-4 content-start gap-2 overflow-y-auto xl:grid-cols-3">
                  {chapters.map((c) => {
                    const active = c.chapter === chapter;
                    return (
                      <button
                        key={c.chapter}
                        type="button"
                        aria-pressed={active}
                        onClick={() => chooseChapter(c.chapter)}
                        className={`flex aspect-square items-center justify-center rounded-lg border font-mono text-sm tabular-nums transition ${
                          active
                            ? 'border-accent bg-accent font-bold text-on-accent shadow-[0_0_15px_color-mix(in_oklab,var(--color-accent)_40%,transparent)]'
                            : 'border-fg/[0.06] bg-fg/[0.02] text-fg/80 hover:border-accent/40 hover:bg-accent/10'
                        }`}
                      >
                        {c.chapter}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Column 3: the reader, or search results in the same place. */}
            <div className={`${GLASS} min-w-0`}>
              <div className="flex flex-wrap items-center gap-2 border-b border-fg/[0.06] pb-3">
                <h2 className="mr-auto font-serif text-3xl tracking-wide text-accent">
                  {hits !== null ? t('resultsHeading') : bookName && chapter !== null ? `${bookName} ${chapter}` : t('readerHeading')}
                </h2>
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                  {t('translation')}
                  <select value={translationId} onChange={(e) => changeTranslation(e.target.value)} className={FIELD}>
                    {(translations ?? []).map((tr) => (
                      <option key={tr.id} value={tr.id}>{tr.name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                  {t('compare')}
                  <select value={compareId} onChange={(e) => setCompareId(e.target.value)} className={FIELD}>
                    <option value="">{t('compareNone')}</option>
                    {(translations ?? [])
                      .filter((tr) => tr.id !== translationId)
                      .map((tr) => (
                        <option key={tr.id} value={tr.id}>{tr.name}</option>
                      ))}
                  </select>
                </label>
                <OperatorListFontStepper value={operatorListFontSize} onChange={setOperatorListFontSize} />
              </div>

              {/* Quick selectors: the same choices as the columns, plus a verse range, in one row. */}
              {hits === null && bookNumber !== null && chapter !== null && (
                <div role="group" aria-label={t('quickSelect')} className="flex flex-wrap items-center gap-2">
                  <select aria-label={t('testamentLabel')} value={testament} onChange={(e) => setTestament(e.target.value as Testament)} className={FIELD}>
                    <option value="OT">{t('oldTab')}</option>
                    <option value="NT">{t('newTab')}</option>
                  </select>
                  <select aria-label={t('bookLabel')} value={bookNumber} onChange={(e) => chooseBook(Number(e.target.value))} className={`${FIELD} max-w-[12rem]`}>
                    {books
                      .filter((b) => b.testament === testament)
                      .map((b) => (
                        <option key={b.number} value={b.number}>{b.name}</option>
                      ))}
                  </select>
                  <select aria-label={t('chapterLabel')} value={chapter} onChange={(e) => chooseChapter(Number(e.target.value))} className={FIELD}>
                    {chapters.map((c) => (
                      <option key={c.chapter} value={c.chapter}>{c.chapter}</option>
                    ))}
                  </select>
                  <select
                    aria-label={t('verseFrom')}
                    value={rangeFrom ?? ''}
                    disabled={verses.length === 0}
                    onChange={(e) => {
                      const from = Number(e.target.value);
                      selectRange(from, Math.max(from, rangeTo ?? from));
                    }}
                    className={FIELD}
                  >
                    {chapterVerseNumbers.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <select
                    aria-label={t('verseTo')}
                    value={rangeTo ?? ''}
                    disabled={verses.length === 0}
                    onChange={(e) => {
                      const to = Number(e.target.value);
                      selectRange(Math.min(rangeFrom ?? to, to), to);
                    }}
                    className={FIELD}
                  >
                    {chapterVerseNumbers.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              )}

              {hits !== null ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-muted">{t('resultCount', { count: hits.length })}</p>
                    <button type="button" onClick={() => setHits(null)} className={PILL}>
                      {t('backToReading')}
                    </button>
                  </div>
                  {hits.length === 0 ? (
                    <p className="text-sm text-muted">{t('noResults')}</p>
                  ) : (
                    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2">
                      {hits.map((h) => (
                        <li key={`${h.bookNumber}:${h.chapter}:${h.verse}`}>
                          <button
                            type="button"
                            onClick={() => openHit(h)}
                            className="flex w-full flex-col gap-1 rounded-xl border border-fg/[0.04] bg-fg/[0.015] p-4 text-left transition hover:border-accent/20 hover:bg-fg/[0.03]"
                          >
                            <span className="font-mono text-xs font-bold tracking-wide text-accent uppercase">
                              {h.bookName} {h.chapter}:{h.verse}
                            </span>
                            <span className="font-serif text-[1.1em] leading-relaxed text-fg"><Snippet text={h.snippet} /></span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : bookNumber === null || chapter === null ? (
                <p className="text-sm text-muted">{t('chooseChapter')}</p>
              ) : verses.length === 0 ? (
                <p className="text-sm text-muted">{t('noVerses')}</p>
              ) : (
                <>
                <ShortcutHint />
                <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2" style={{ fontSize: `${operatorListFontSize}px`, lineHeight: '1.5' }}>
                  {verses.map((v) => {
                    const isSelected = selected.includes(v.verse);
                    const isFlash = flash === v.verse;
                    const isBreak = activeBreaks.includes(v.verse);
                    const isLive = liveVerses.includes(v.verse);
                    const other = compareVerses.find((c) => c.verse === v.verse);
                    return (
                      <li key={v.verse} className="relative">
                        <button
                          ref={isFlash ? flashRef : undefined}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={(e) => onVerseClick(e, v)}
                          onDoubleClick={() => {
                            if (liveOffTimer.current !== null) {
                              window.clearTimeout(liveOffTimer.current);
                              liveOffTimer.current = null;
                            }
                            projectVerse(v);
                          }}
                          className={`flex w-full gap-3 rounded-xl border p-4 text-left transition-all duration-300 select-none ${
                            isSelected
                              ? 'border-accent bg-accent/[0.06] shadow-[0_0_20px_color-mix(in_oklab,var(--color-accent)_12%,transparent)]'
                              : 'border-fg/[0.04] bg-fg/[0.015] hover:border-accent/20'
                          } ${isFlash ? 'ring-2 ring-accent/60' : ''} ${isLive ? 'border-amber-500/50 shadow-[0_0_18px_rgba(245,158,11,0.25)]' : ''} ${isSelected && v.verse !== selected[0] ? 'pr-16' : ''}`}
                        >
                          <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-sm font-bold text-accent tabular-nums">{v.verse}</span>
                          <span className="flex-1 font-serif leading-relaxed text-fg">
                            {v.text}
                            {liveVerses.includes(v.verse) && <LiveBadge>{t('live')}</LiveBadge>}
                            {other && (
                              <span className="mt-1 block border-l border-accent/20 pl-6 font-serif text-[0.85em] text-muted/80 italic">{other.text}</span>
                            )}
                          </span>
                        </button>
                        {/* A slide break can start at any selected verse except the first. It sits beside the verse, not inside its button. */}
                        {isSelected && v.verse !== selected[0] && (
                          <button
                            type="button"
                            onClick={() => toggleBreak(v.verse)}
                            aria-pressed={isBreak}
                            aria-label={t('splitHere')}
                            title={t('splitHere')}
                            className={`${SPLIT} ${
                              isBreak ? 'border-accent bg-accent text-on-accent' : 'border-fg/15 bg-black/30 text-muted hover:border-accent/40 hover:text-accent'
                            }`}
                          >
                            <Scissors size={11} aria-hidden />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
                </>
              )}
            </div>
          </div>

          {/* Styling and preview. The toolbar sits above the slide, so the operator sees the same look the screen will show. */}
          {hits === null && shownSlide && (
            <section aria-label={t('previewHeading')} className={GLASS}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="eyebrow mr-auto">{t('previewHeading')}</h2>
                <button
                  type="button"
                  onClick={() => setPreviewIndex(Math.max(0, shownIndex - 1))}
                  disabled={shownIndex === 0}
                  aria-label={t('prevSlide')}
                  className={ICON}
                >
                  <ChevronLeft size={14} aria-hidden />
                </button>
                <span className="font-mono text-xs text-muted tabular-nums">{t('slideOf', { n: shownIndex + 1, total: slideCount })}</span>
                <button
                  type="button"
                  onClick={() => setPreviewIndex(Math.min(slideCount - 1, shownIndex + 1))}
                  disabled={shownIndex >= slideCount - 1}
                  aria-label={t('nextSlide')}
                  className={ICON}
                >
                  <ChevronRight size={14} aria-hidden />
                </button>
              </div>
              <StyleToolbar style={style} onChange={changeStyle} />
              <div className="flex flex-wrap items-end gap-3">
                <ColorField
                  label={t('backgroundColor')}
                  prefix={t('backgroundColor')}
                  value={style.bgColor}
                  presets={BACKGROUND_COLORS}
                  onChange={(hex) => changeStyle({ bgColor: hex })}
                  clearLabel={t('noColor')}
                />
              </div>
              <SlidePreview
                text={shownSlide.map((line) => line.text).join('\n')}
                bgSrc={null}
                style={sanitizeTextStyle(style)}
                className="aspect-video w-full rounded-xl border border-fg/10"
              />
            </section>
          )}

          {noteOpen && canUseSelection && (
            <AddNoteOverlayModal
              reference={`${bookName} ${chapter}:${formatRuns(runs)}`}
              verseText={chosen.map((v) => v.text).join(' ')}
              onClose={() => setNoteOpen(false)}
            />
          )}

          {compareVerse && chapter !== null && translations && bookNumber !== null && (
            <CompareVerseModal
              verse={compareVerse}
              bookNumber={bookNumber}
              bookName={bookName}
              chapter={chapter}
              translations={translations}
              onClose={() => setCompareVerse(null)}
            />
          )}

          {/* Bottom action toolbar: one row. The attribution sits beneath it in small type. */}
          {hits === null && (
            <footer className="flex shrink-0 flex-col gap-2">
              <div className="surface-glass flex flex-nowrap items-center gap-2 overflow-x-auto rounded-2xl px-3 py-2">
                <span className="shrink-0 rounded-full bg-accent/15 px-3 py-1 font-mono text-[11px] font-bold text-accent tabular-nums">
                  {selected.length > 0 ? t('selectedCount', { count: selected.length }) : t('selectHint')}
                </span>
                {slideCount > 0 && (
                  <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">{t('slidesCount', { n: slideCount })}</span>
                )}
                <button type="button" onClick={handleClearSelection} disabled={!selected.length} className={PILL}>
                  <X size={14} aria-hidden /> {t('clearSelection')}
                </button>
                <button type="button" onClick={clearProjection} disabled={!projection} className={PILL}>
                  Clear projector
                </button>
                <button type="button" onClick={() => setBreaks([])} disabled={activeBreaks.length === 0} className={PILL}>
                  <Scissors size={14} aria-hidden /> {t('clearBreaks')}
                </button>
                <span className="mx-1 h-6 w-px shrink-0 bg-fg/10" aria-hidden />
                <label className="flex shrink-0 items-center gap-2 text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
                  {t('blockLabel')}
                  <select value={block} onChange={(e) => setBlock(e.target.value as LiturgicalBlock)} className={FIELD}>
                    {BLOCKS.map((b) => (
                      <option key={b.id} value={b.id}>{pt(b.titleKey)}</option>
                    ))}
                  </select>
                </label>
                {noteOverlay && (
                  <button type="button" onClick={() => dispatch({ type: 'noteOverlay/clear' })} className={PILL}>
                    Clear note overlay
                  </button>
                )}
                <button type="button" onClick={() => setNoteOpen(true)} disabled={!canUseSelection} className={PILL}>
                  Add note overlay
                </button>
                <button type="button" onClick={sendToQueue} disabled={!canUseSelection} className={PILL}>
                  {t('addToQueue')}
                </button>
                <label className="flex min-w-[10rem] flex-1 shrink items-center gap-2 text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
                  {t('planLabel')}
                  <select
                    value={planId ?? ''}
                    onChange={(e) => setPlanId(Number(e.target.value))}
                    disabled={plans.length === 0}
                    className={`${FIELD} min-w-0 flex-1`}
                  >
                    {plans.length === 0 && <option value="">{t('noPlanYet')}</option>}
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>{p.liturgicalDate} · {p.name}</option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={sendToPlan} disabled={!canUseSelection || planId === null} className={PILL}>
                  {t('addToPlan')}
                </button>
              </div>
              <p className="px-2 text-[10px] text-faint">
                {currentTranslation && (
                  <>
                    {t('license')}: {currentTranslation.license}. {currentTranslation.attribution}
                  </>
                )}
              </p>
            </footer>
          )}
        </>
      )}
    </section>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-stone-700 bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] font-bold text-stone-200 shadow-sm">{children}</kbd>
  );
}

/** The gestures for verse rows, shown above the list so the operator can find them. */
function ShortcutHint() {
  const items: ReactNode[] = [
    'Double-click to project',
    <><Kbd>P</Kbd> +Click to project</>,
    <><Kbd>Q</Kbd> +Click to queue</>,
    <><Kbd>C</Kbd> +Click to compare</>,
    <><Kbd>Alt</Kbd> +Click to add note</>,
    'Shift+click to select multiple',
  ];
  return (
    <div role="note" className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-xs text-stone-300">
      <span aria-hidden className="text-stone-400">ⓘ</span>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden className="text-stone-600">•</span>}
          {item}
        </span>
      ))}
    </div>
  );
}

/** Side-by-side text of one verse in every installed translation. Opened by C+click. */
function CompareVerseModal({ verse, bookNumber, bookName, chapter, translations, onClose }: {
  verse: Verse;
  bookNumber: number;
  bookName: string;
  chapter: number;
  translations: Translation[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<{ translation: Translation; text: string | null }[] | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all(
      translations.map((translation) =>
        api
          .getVerses(translation.id, bookNumber, chapter)
          .then((list) => ({ translation, text: list.find((v) => v.verse === verse.verse)?.text ?? null }))
          .catch(() => ({ translation, text: null })),
      ),
    ).then((result) => {
      if (live) setRows(result);
    });
    return () => {
      live = false;
    };
  }, [translations, bookNumber, chapter, verse.verse]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`${bookName} ${chapter}:${verse.verse}`} className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-stone-700 bg-stone-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-serif text-2xl text-accent">{bookName} {chapter}:{verse.verse}</h2>
          <button type="button" onClick={onClose} className="rounded-md border border-stone-700 px-3 py-1 text-xs font-bold uppercase text-stone-300 hover:text-stone-100">Close</button>
        </div>
        {rows === null ? (
          <p className="text-sm text-stone-400">Loading translations…</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map(({ translation, text }) => (
              <li key={translation.id} className="rounded-lg border border-stone-800 bg-stone-900/60 p-3">
                <div className="mb-1 text-[11px] font-bold tracking-widest text-stone-400 uppercase">{translation.name}</div>
                <p className="font-serif text-base leading-relaxed text-stone-100">{text ?? 'Not in this translation.'}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The verse size control: minus, the size in pixels (typed or stepped), and plus. Stepping moves one pixel.
 * Typed values are kept only when they are within 14 to 24, and the box returns to the size in use on leaving it.
 */
function OperatorListFontStepper({ value, onChange }: { value: number; onChange: (px: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const step = (delta: number) => onChange(clampOperatorListFont(value + delta));

  return (
    <div role="group" aria-label="Verse text size" className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={value <= OPERATOR_LIST_FONT_MIN}
        aria-label="Smaller verse text"
        title="Smaller verse text"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-800 bg-stone-900 text-stone-300 transition-colors hover:border-amber-500/40 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Minus size={14} aria-hidden />
      </button>

      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(e) => {
            // Digits only, at most two of them. Only a value within the limits is applied.
            const text = e.target.value.replace(/\D/g, '').slice(0, 2);
            setDraft(text);
            const n = Number(text);
            if (text !== '' && n >= OPERATOR_LIST_FONT_MIN && n <= OPERATOR_LIST_FONT_MAX) onChange(n);
          }}
          onBlur={() => setDraft(String(value))}
          onKeyDown={(e) => {
            // Typing a size must not trigger the app's shortcuts or the verse navigation keys.
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label="Verse text size in pixels"
          className="h-8 w-14 rounded-lg border border-stone-800 bg-stone-900 pr-4 text-center text-sm font-semibold text-amber-300 focus:border-amber-400 focus:outline-none"
        />
        <span aria-hidden className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[10px] text-stone-500">px</span>
      </div>

      <button
        type="button"
        onClick={() => step(1)}
        disabled={value >= OPERATOR_LIST_FONT_MAX}
        aria-label="Larger verse text"
        title="Larger verse text"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-800 bg-stone-900 text-stone-300 transition-colors hover:border-amber-500/40 hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={14} aria-hidden />
      </button>
    </div>
  );
}
