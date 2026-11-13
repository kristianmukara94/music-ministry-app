import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, CopyPlus, FileText, FileUp, GripVertical, Loader2, Plus, RotateCcw, Trash2, Upload, XCircle } from 'lucide-react';
import { LANGUAGES, MAX_STANZAS } from '../../shared/lyrics-parser.js';
import {
  MAX_DOCX_BYTES,
  appendSection,
  applyTitleCase,
  defaultDeck,
  docxSongIssues,
  duplicateSlide,
  parseDocxSongs,
  parseTextSongs,
  removeSlide,
  reorderPreviewSlides,
  sameDeck,
  setDeckSlidePart,
  songSlides,
  songToTaggedLyrics,
  sortSongsAlphabetically,
  type CaseMode,
  type DeckSlide,
  type DocxSong,
  type LineupResult,
} from '../../shared/docx-song-parser.js';
import { docxT, type DocxKey } from '../../shared/docx-import-i18n.js';
import { bridge } from '../live/bridge';
import { addToQueue } from '../planner/plan-api';
import { useUi } from '../state/ui';
import { CategorySelectGroup } from './CategorySelectGroup';
import { useLyT } from './strings';
import { PartSelect } from './PartSelect';
import type { HymnLanguage, PrimaryCategory, SongCategory } from './types';

const api = bridge.lyrics;

type Phase = 'pick' | 'reading' | 'review' | 'saving' | 'done';
type DupAction = 'skip' | 'update' | 'new';
type DT = (key: DocxKey, vars?: Record<string, string | number>) => string;

/** Asks before the import goes away with songs reviewed but not saved. Returns true when it may close. */
export type CloseGuard = { current: (() => boolean) | null };

/** A song on the review screen: the parsed song, whether it is ticked, and what to do when it is already in the library. */
interface ReviewSong extends DocxSong {
  selected: boolean;
  action: DupAction;
}

interface Summary {
  created: number;
  updated: number;
  skipped: number;
  failures: { title: string; error: string }[];
  queue: string | null;
}

const MB = MAX_DOCX_BYTES / 1024 / 1024;
const FIELD =
  'h-9 w-full rounded-lg border border-line-strong bg-surface-2 px-3 text-sm text-fg outline-none placeholder:text-faint focus:border-accent focus:ring-1 focus:ring-accent/40';
const CAPTION = 'text-[11px] font-semibold tracking-wider text-muted uppercase';
/** The small icon buttons on a slide card's caption. */
const CARD_ICON =
  'grid size-5 cursor-pointer place-items-center rounded text-muted transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35';
/** The drag data type of a slide card being dragged in the slides preview, so files or text dragged in from outside are ignored. */
const SLIDE_DRAG = 'application/x-apccmma-preview-slide';
const BADGE = 'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase';
const BUTTON =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-xs font-semibold tracking-wide text-fg/85 uppercase transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40';
const PRIMARY =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-accent bg-accent px-5 text-xs font-extrabold tracking-wider text-on-accent uppercase transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';

const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** A step's colour: verses carry the accent, a chorus is green, a bridge blue, a coda, tag or ending amber (as in the song form). */
const tone = (label: string) =>
  /^Chorus/.test(label)
    ? 'border-ok/50 bg-ok/10 text-ok'
    : /^Bridge/.test(label)
      ? 'border-info/50 bg-info/10 text-info'
      : /^(Tag|Coda|Ending)/.test(label)
        ? 'border-warn/50 bg-warn/10 text-warn'
        : 'border-accent/50 bg-accent/10 text-accent';

/** The three steps across the top, the current one lit. */
function Stepper({ phase, t }: { phase: Phase; t: DT }) {
  const at = phase === 'pick' || phase === 'reading' ? 0 : phase === 'done' ? 2 : 1;
  const steps = [t('stepChoose'), t('stepReview'), t('stepDone')];
  return (
    <ol className="flex items-center gap-2" aria-label="Steps">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2" aria-current={i === at ? 'step' : undefined}>
          <span
            className={`grid size-6 place-items-center rounded-full text-[11px] font-extrabold ${
              i < at ? 'bg-accent/25 text-accent' : i === at ? 'bg-accent text-on-accent' : 'border border-fg/20 text-faint'
            }`}
          >
            {i < at ? <Check size={13} aria-hidden /> : i + 1}
          </span>
          <span className={`hidden text-xs font-semibold sm:inline ${i === at ? 'text-fg' : 'text-faint'}`}>{label}</span>
          {i < steps.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-fg/20" />}
        </li>
      ))}
    </ol>
  );
}

/** Keeps a press on a card button from starting a drag of the card. */
const stopDrag = {
  draggable: false,
  onMouseDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  onDragStart: (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  },
};

/**
 * A slide as it will look on the projector: white words centred on black, under its place in the order and its section, with buttons to
 * duplicate it (the copy goes straight after it) and remove it (`onRemove` null when it is the last slide left).
 */
function SlideCard({
  n,
  part,
  text,
  onPart,
  onDuplicate,
  onRemove,
  t,
}: {
  n: number;
  /** The slide's part, or '' for a continuation of the slide before it. */
  part: string;
  text: string;
  onPart: (part: string) => void;
  onDuplicate: () => void;
  onRemove: (() => void) | null;
  t: DT;
}) {
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex items-center justify-between gap-2 text-[10px] font-bold tracking-wider text-faint uppercase">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-muted">#{n}</span>
          <PartSelect
            small
            n={n}
            value={part}
            first={n === 1}
            onChange={onPart}
            labels={{ part: t('slidePart'), continuation: t('partContinuation'), firstSlide: t('partContinuation') }}
          />
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <button type="button" {...stopDrag} onClick={onDuplicate} className={CARD_ICON} aria-label={`${t('duplicateSlide')}: #${n}`} title={t('duplicateSlide')}>
            <CopyPlus size={12} aria-hidden />
          </button>
          <button
            type="button"
            {...stopDrag}
            onClick={() => onRemove?.()}
            disabled={!onRemove}
            className={`${CARD_ICON} hover:text-danger`}
            aria-label={`${t('removeSlide')}: #${n}`}
            title={t('removeSlide')}
          >
            <Trash2 size={12} aria-hidden />
          </button>
          <GripVertical size={12} aria-hidden className="ml-0.5" />
        </span>
      </figcaption>
      <div className="grid aspect-video place-items-center rounded-md bg-black px-3 text-center text-[11px] leading-snug font-semibold whitespace-pre-line text-white">
        {text}
      </div>
    </figure>
  );
}

/**
 * The Import tab of the Add song dialog: reads a Word (.docx) or text (.txt) lineup, takes it apart into songs with their sections and sung
 * order, and lets the operator check each song (title, language, and its slides, which they can drag, add sections to, duplicate or trim)
 * before saving the chosen ones to the Hymn Library and, if asked, adding them to the Service Plan queue. Three steps: choose the file,
 * review the songs, done. Nothing is saved until Import. While `active`, Escape closes the dialog (which asks first, through `closeGuard`,
 * when reviewed songs would be lost).
 */
export function DocxImportView({
  active,
  closeGuard,
  onClose,
  onImported,
}: {
  active: boolean;
  closeGuard: CloseGuard;
  onClose: () => void;
  /** After songs were added or updated. */
  onImported: () => void;
}) {
  const lang = useUi((s) => s.lang);
  const lt = useLyT();
  const t: DT = (key, vars) => docxT(lang, key, vars);

  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [titleMode, setTitleMode] = useState<LineupResult['titleMode']>('emphasis');
  const [songs, setSongs] = useState<ReviewSong[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [caseMode, setCaseMode] = useState<CaseMode>('sentence');
  const [queueToo, setQueueToo] = useState(true);
  const [filing, setFiling] = useState<{ primaryCategory: PrimaryCategory; songCategory: string }>({ primaryCategory: 'GENERAL', songCategory: '' });
  const [categories, setCategories] = useState<SongCategory[]>([]);
  const [existing, setExisting] = useState<{ id: number; title: string }[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  /** The library's titles, to flag songs in the file that are already there. */
  const loadExisting = () =>
    api
      .listHymns({})
      .then((list) => setExisting(list.map((h) => ({ id: h.id, title: h.title }))))
      .catch(() => undefined);

  useEffect(() => {
    api
      .listSongCategories()
      .then(setCategories)
      .catch(() => undefined);
    void loadExisting();
  }, []);

  const unsaved = phase === 'review' && songs.length > 0;
  // Asked whichever tab is showing: reviewed songs here are lost however the dialog closes.
  useEffect(() => {
    closeGuard.current = () => phase !== 'saving' && (!unsaved || window.confirm(t('discardConfirm')));
  });

  // Escape closes the dialog (the close guard asks first).
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const startOver = () => {
    setSongs([]);
    setSummary(null);
    setActiveKey(null);
    setError(null);
    setPhase('pick');
  };

  /** Reads a chosen or dropped file and takes it apart into songs. A .txt goes through the same parser as a Word file. */
  const read = async (file: File) => {
    setError(null);
    const isDocx = /\.docx$/i.test(file.name);
    const isText = /\.txt$/i.test(file.name);
    if (!isDocx && !isText) return setError(t('badType', { file: file.name }));
    if (file.size > MAX_DOCX_BYTES) return setError(t('tooBig', { file: file.name, size: (file.size / 1024 / 1024).toFixed(1), mb: MB }));
    setFileName(file.name);
    setPhase('reading');
    try {
      const result = isDocx ? await parseDocxSongs(await file.arrayBuffer(), { existing }) : parseTextSongs(await file.text(), { existing });
      if (!result.songs.length) {
        setError(t('noSongs', { file: file.name }));
        setPhase('pick');
        return;
      }
      setTitleMode(result.titleMode);
      setCaseMode(result.allCaps ? 'sentence' : 'preserve');
      // Listed A–Z by title (sorted once here, on the file's titles, so changing the case or editing a title never reshuffles the list).
      const sorted = sortSongsAlphabetically(result.songs);
      // A song already in the library, or a second copy in the file, starts unticked; the operator chooses what to do with it.
      setSongs(
        sorted.map((s) => {
          const inLibrary = s.duplicate.existingId != null;
          return { ...s, selected: !inLibrary && s.duplicate.inFile == null, action: inLibrary ? 'skip' : 'new' };
        }),
      );
      setActiveKey(sorted[0].key);
      setPhase('review');
    } catch (err) {
      setError(errorText(err));
      setPhase('pick');
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && phase === 'pick') void read(file);
  };

  const patch = (key: string, change: Partial<ReviewSong>) => setSongs((list) => list.map((s) => (s.key === key ? { ...s, ...change } : s)));
  const activeSong = songs.find((s) => s.key === activeKey) ?? null;
  const opts = { caseMode };
  const issuesOf = useMemo(() => new Map(songs.map((s) => [s.key, docxSongIssues(s, { caseMode })])), [songs, caseMode]);
  const selected = songs.filter((s) => s.selected && s.action !== 'skip');
  const blocked = selected.some((s) => issuesOf.get(s.key)?.some((i) => i.level === 'error'));
  const needsCategory = selected.some((s) => s.action === 'new' || s.duplicate.existingId == null);
  const categoryMissing = needsCategory && !filing.songCategory.trim();
  const canImport = selected.length > 0 && !blocked && !categoryMissing;

  /** Saves the ticked songs: new ones are added, duplicates marked Update replace that song's words, and all go to the queue if asked. */
  const importSelected = async () => {
    if (!canImport) return;
    setPhase('saving');
    const failures: Summary['failures'] = [];
    const savedIds = new Map<string, number>();
    const toCreate = selected.filter((s) => !(s.action === 'update' && s.duplicate.existingId != null));
    const toUpdate = selected.filter((s) => s.action === 'update' && s.duplicate.existingId != null);
    const titleOf = (s: ReviewSong) => applyTitleCase(s.title.trim(), caseMode);
    try {
      if (toCreate.length) {
        const results = await api.createHymns(
          toCreate.map((s) => ({
            title: titleOf(s),
            composer: '',
            language: s.language as HymnLanguage,
            musicalKey: '',
            songCategory: filing.songCategory,
            primaryCategory: filing.primaryCategory,
            raw: songToTaggedLyrics(s, opts),
          })),
        );
        results.forEach((r, i) => {
          if (r.error === undefined) savedIds.set(toCreate[i].key, r.id);
          else failures.push({ title: titleOf(toCreate[i]), error: r.error });
        });
      }
      for (const s of toUpdate) {
        try {
          await api.editLyrics(s.duplicate.existingId as number, songToTaggedLyrics(s, opts));
          savedIds.set(s.key, s.duplicate.existingId as number);
        } catch (err) {
          failures.push({ title: titleOf(s), error: errorText(err) });
        }
      }
    } catch (err) {
      failures.push({ title: fileName, error: errorText(err) });
    }

    let queue: string | null = null;
    // In the order the review list shows them (A–Z).
    const queued = songs.filter((s) => savedIds.has(s.key));
    if (queueToo && queued.length) {
      try {
        await addToQueue(queued.map((s) => ({ block: 'introductory', module: 'lyrics', sourceId: String(savedIds.get(s.key)), label: titleOf(s) })));
        queue = t('queued', { count: queued.length });
      } catch (err) {
        queue = t('queueFailed', { error: errorText(err) });
      }
    }
    const updated = toUpdate.filter((s) => savedIds.has(s.key)).length;
    setSummary({ created: savedIds.size - updated, updated, skipped: songs.length - savedIds.size, failures, queue });
    setPhase('done');
    if (savedIds.size) {
      onImported();
      void loadExisting();
    }
  };

  return (
    <div className={active ? 'relative flex min-h-0 flex-1 flex-col' : 'hidden'}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-2.5">
        <span className="min-w-0 truncate text-xs text-faint">
          {(phase === 'review' || phase === 'saving') &&
            `${t('songsFound', { count: songs.length, file: fileName })} · ${titleMode === 'emphasis' ? t('titlesFrom') : t('titlesGuessed')}`}
        </span>
        <Stepper phase={phase} t={t} />
      </div>

      {/* Step 1: the file. */}
      {(phase === 'pick' || phase === 'reading') && (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              depth.current += 1;
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = phase === 'reading' ? 'none' : 'copy';
            }}
            onDragLeave={() => {
              depth.current -= 1;
              if (depth.current <= 0) setDragging(false);
            }}
            onDrop={onDrop}
            className={`flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
              dragging ? 'border-accent bg-accent/10' : 'border-fg/20 bg-panel-2/40'
            }`}
          >
            {phase === 'reading' ? (
              <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
                <Loader2 size={32} className="animate-spin text-accent" aria-hidden />
                <p className="text-sm text-fg/80">{t('reading', { file: fileName })}</p>
              </div>
            ) : (
              <>
                <span className={`grid size-16 place-items-center rounded-full ${dragging ? 'bg-accent text-on-accent' : 'bg-accent/15 text-accent'}`}>
                  <Upload size={28} aria-hidden />
                </span>
                <div className="flex flex-col gap-1">
                  <p className="text-lg font-bold text-fg">{t('dropTitle')}</p>
                  <p className="text-sm text-muted">{t('fileHint', { mb: MB })}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-faint">
                  <span className="h-px w-10 bg-fg/20" aria-hidden /> {t('dropOr')} <span className="h-px w-10 bg-fg/20" aria-hidden />
                </div>
                <button type="button" onClick={() => input.current?.click()} className={PRIMARY}>
                  <FileUp size={15} aria-hidden /> {t('browse')}
                </button>
                <input
                  ref={input}
                  type="file"
                  accept=".docx,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void read(file);
                  }}
                />
              </>
            )}
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {error}
            </p>
          )}

          <section className="rounded-lg border border-line bg-panel-2/40 p-4">
            <h3 className={CAPTION}>{t('howTitle')}</h3>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-fg/70">
              <li>{t('how1')}</li>
              <li>{t('how2')}</li>
              <li>{t('how3')}</li>
            </ul>
          </section>
        </div>
      )}

      {/* Step 2: the songs, on the left; the song open for checking, on the right. */}
      {(phase === 'review' || phase === 'saving') && (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(280px,360px)_1fr]">
          <aside className="flex min-h-0 flex-col border-b border-line md:border-r md:border-b-0">
            {needsCategory && (
              <fieldset className="border-b border-line px-4 py-3">
                <legend className={`${CAPTION} mb-1.5`}>
                  {t('filing')} <span className="text-danger" aria-hidden>*</span>
                </legend>
                <CategorySelectGroup
                  t={lt}
                  mode="form"
                  required
                  compact
                  idPrefix="docx"
                  scope={filing.primaryCategory}
                  onScope={(scope) => setFiling((f) => ({ ...f, primaryCategory: scope }))}
                  songCategory={filing.songCategory}
                  onSongCategory={(name) => setFiling((f) => ({ ...f, songCategory: name }))}
                  categories={categories}
                  invalid={categoryMissing}
                />
              </fieldset>
            )}
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
              <span className={CAPTION}>
                {selected.length} / {songs.length}
              </span>
              <span className="flex gap-1">
                <button
                  type="button"
                  className="rounded px-2 py-1 text-[11px] font-semibold text-fg/70 hover:bg-fg/10"
                  onClick={() => setSongs((l) => l.map((s) => ({ ...s, selected: true, action: s.action === 'skip' ? 'update' : s.action })))}
                >
                  {t('selectAll')}
                </button>
                <button type="button" className="rounded px-2 py-1 text-[11px] font-semibold text-fg/70 hover:bg-fg/10" onClick={() => setSongs((l) => l.map((s) => ({ ...s, selected: false })))}>
                  {t('selectNone')}
                </button>
              </span>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-2" aria-label={t('heading')}>
              {songs.map((s) => {
                const hasError = (issuesOf.get(s.key) ?? []).some((i) => i.level === 'error');
                const dup = s.duplicate.existingId != null || s.duplicate.inFile != null;
                return (
                  <li key={s.key}>
                    <div
                      className={`mb-1 flex gap-2 rounded-lg border p-2 transition ${s.key === activeKey ? 'border-accent/60 bg-accent/10' : 'border-transparent hover:bg-fg/5'}`}
                      onClick={() => setActiveKey(s.key)}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
                        checked={s.selected && s.action !== 'skip'}
                        aria-label={applyTitleCase(s.title, caseMode)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          patch(s.key, {
                            selected: e.target.checked,
                            action: e.target.checked && s.action === 'skip' ? (s.duplicate.existingId != null ? 'update' : 'new') : s.action,
                          })
                        }
                      />
                      <button type="button" className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left" onClick={() => setActiveKey(s.key)}>
                        <span className="w-full truncate text-sm font-semibold text-fg">{applyTitleCase(s.title, caseMode) || '—'}</span>
                        <span className="flex flex-wrap gap-1">
                          <span className={`${BADGE} bg-fg/10 text-fg/75`} title={s.languages.length ? t('mixed', { langs: s.languages.join(' + ') }) : undefined}>
                            {s.languages.length ? s.languages.join('+') : s.language}
                          </span>
                          <span className={`${BADGE} bg-fg/10 text-muted`}>{t('sections', { count: s.sections.length })}</span>
                          {dup && (
                            <span className={`${BADGE} bg-warn/15 text-warn`} title={s.duplicate.existingId != null ? t('duplicateLibrary') : t('duplicateFile')}>
                              {t('duplicate')}
                            </span>
                          )}
                          {hasError && <AlertTriangle size={14} className="text-danger" aria-label={t('cues')} />}
                        </span>
                      </button>
                    </div>
                    {s.duplicate.existingId != null && (
                      <select
                        value={s.action}
                        onChange={(e) => {
                          const action = e.target.value as DupAction;
                          patch(s.key, { action, selected: action !== 'skip' });
                        }}
                        className="mb-2 ml-8 h-7 rounded border border-line-strong bg-surface-2 px-1.5 text-[11px] text-fg"
                        aria-label={`${t('duplicateLibrary')}: ${applyTitleCase(s.title, caseMode)}`}
                      >
                        <option value="skip">{t('actionSkip')}</option>
                        <option value="update">{t('actionUpdate')}</option>
                        <option value="new">{t('actionNew')}</option>
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="flex min-h-0 flex-col overflow-y-auto p-5">
            {activeSong && <SongInspector song={activeSong} caseMode={caseMode} setCaseMode={setCaseMode} onChange={(c) => patch(activeSong.key, c)} t={t} />}
          </section>
        </div>
      )}

      {/* Step 3: what was done. */}
      {phase === 'done' && summary && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-8 text-center" role="status">
          <span className={`grid size-14 place-items-center rounded-full ${summary.created + summary.updated ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'}`}>
            {summary.created + summary.updated ? <CheckCircle2 size={30} aria-hidden /> : <XCircle size={30} aria-hidden />}
          </span>
          <p className="text-xl font-bold text-fg">{t('doneTitle')}</p>
          <p className="text-sm text-fg/80">{t('doneSummary', { created: summary.created, updated: summary.updated, skipped: summary.skipped })}</p>
          {summary.queue && <p className="text-sm text-fg/70">{summary.queue}</p>}
          {summary.failures.map((f) => (
            <p key={f.title} className="text-sm text-danger">
              {t('failed', f)}
            </p>
          ))}
        </div>
      )}

      {(phase === 'review' || phase === 'saving') && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-fg/85">
              <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={queueToo} onChange={(e) => setQueueToo(e.target.checked)} />
              {t('addToQueue')}
            </label>
            {categoryMissing && (
              <p role="alert" className="text-xs text-danger">
                {t('categoryMissing')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => window.confirm(t('backConfirm')) && startOver()} disabled={phase === 'saving'} className={BUTTON}>
              <ChevronLeft size={14} aria-hidden /> {t('back')}
            </button>
            <button type="button" onClick={() => void importSelected()} disabled={!canImport || phase === 'saving'} className={PRIMARY}>
              {phase === 'saving' && <Loader2 size={15} className="animate-spin" aria-hidden />}
              {phase === 'saving' ? t('saving') : t('importN', { count: selected.length })}
            </button>
          </div>
        </footer>
      )}

      {phase === 'done' && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3">
          <button type="button" onClick={startOver} className={BUTTON}>
            <FileText size={14} aria-hidden /> {t('another')}
          </button>
          <button type="button" onClick={onClose} className={PRIMARY}>
            {t('done')}
          </button>
        </footer>
      )}
    </div>
  );
}

/**
 * The song open for checking: how its words are cased, its title and language, and its slides deck, which is the one place the order is
 * edited: sections added from the bar above it, slides dragged about, duplicated or removed on their cards, and the parsed order restored
 * with Reset. The deck holds section-and-slide references, so changing the case rewrites every slide's words and keeps the order.
 */
function SongInspector({
  song,
  caseMode,
  setCaseMode,
  onChange,
  t,
}: {
  song: ReviewSong;
  caseMode: CaseMode;
  setCaseMode: (mode: CaseMode) => void;
  onChange: (change: Partial<ReviewSong>) => void;
  t: DT;
}) {
  const opts = { caseMode };
  const slides = songSlides(song, opts);
  // Only the references that resolve to a slide, so card positions and deck positions always agree.
  const deck: DeckSlide[] = slides.map(({ id, label, chunk, part }) => (part != null ? { id, label, chunk, part } : { id, label, chunk }));
  const customOrder = song.deck != null && !sameDeck(song.deck, defaultDeck(song, opts));
  const issues = docxSongIssues(song, opts).filter((i) => i.level === 'error');
  const setDeck = (next: DeckSlide[]) => onChange({ deck: next });

  // Drag and drop on the slides grid. The landing place is a card and the side of it the slide lands on, since the grid wraps onto rows.
  const [draggedSlideIndex, setDraggedSlideIndex] = useState<number | null>(null);
  const [slideDropTarget, setSlideDropTarget] = useState<{ index: number; side: 'before' | 'after' } | null>(null);
  /** Set on pointer down: a drag that starts on a card's buttons is not a drag. */
  const fromButton = useRef(false);
  /** Slide cards by deck id, which stays theirs wherever they move, so a keyboard move or a removal can put focus back on a card. */
  const cards = useRef(new Map<string, HTMLElement>());
  const [focusSlide, setFocusSlide] = useState<string | null>(null);
  useEffect(() => {
    if (focusSlide == null) return;
    cards.current.get(focusSlide)?.focus();
    setFocusSlide(null);
  }, [focusSlide]);

  /** The place the dragged slide ends at when dropped at `target`, or null when that leaves it where it is. */
  const slideLanding = (target: { index: number; side: 'before' | 'after' } | null) => {
    if (draggedSlideIndex == null || !target) return null;
    const insert = target.side === 'after' ? target.index + 1 : target.index;
    const to = insert > draggedSlideIndex ? insert - 1 : insert;
    return to === draggedSlideIndex ? null : to;
  };
  const endSlideDrag = () => {
    setDraggedSlideIndex(null);
    setSlideDropTarget(null);
    fromButton.current = false;
  };
  const ownSlideDrag = (e: DragEvent) => draggedSlideIndex != null && e.dataTransfer.types.includes(SLIDE_DRAG);
  const onSlideDragOver = (e: DragEvent<HTMLElement>, index: number) => {
    if (!ownSlideDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const side = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    if (slideDropTarget?.index !== index || slideDropTarget.side !== side) setSlideDropTarget({ index, side });
  };
  const onGridDrop = (e: DragEvent) => {
    if (!ownSlideDrag(e)) return;
    e.preventDefault();
    const to = slideLanding(slideDropTarget);
    if (draggedSlideIndex != null && to != null) setDeck(reorderPreviewSlides(deck, draggedSlideIndex, to));
    endSlideDrag();
  };
  const slideDropAt = slideLanding(slideDropTarget) == null ? null : slideDropTarget;

  const duplicateAt = (index: number) => {
    const next = duplicateSlide(deck, index);
    setDeck(next);
    setFocusSlide(next[index + 1]?.id ?? null);
  };
  const removeAt = (index: number) => {
    if (deck.length <= 1) return;
    const next = removeSlide(deck, index);
    setDeck(next);
    setFocusSlide((next[index] ?? next[index - 1])?.id ?? null);
  };

  /** Alt+← / Alt+→ on a focused slide card moves it one place, keeping focus on it. */
  const onSlideKey = (e: ReactKeyboardEvent, index: number) => {
    if (e.target !== e.currentTarget || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const to = index + (e.key === 'ArrowLeft' ? -1 : 1);
    e.preventDefault();
    if (to < 0 || to >= deck.length) return;
    setDeck(reorderPreviewSlides(deck, index, to));
    setFocusSlide(deck[index].id);
  };

  const issueText = (code: string) => {
    if (code === 'noTitle') return t('issueNoTitle');
    if (code === 'noSlides') return t('issueNoSlides');
    return t('issueTooManySlides', { count: slides.length, max: MAX_STANZAS });
  };

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label={t('caseSentence')} className="inline-flex w-fit rounded-lg border border-fg/15 bg-panel-2 p-0.5">
        {(['sentence', 'preserve'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={caseMode === mode}
            onClick={() => setCaseMode(mode)}
            className={`h-7 rounded-md px-2.5 text-[11px] font-bold transition ${caseMode === mode ? 'bg-accent text-on-accent' : 'text-fg/70 hover:text-fg'}`}
          >
            {mode === 'sentence' ? t('caseSentence') : t('caseKeep')}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <label className="flex flex-col gap-1">
          <span className={CAPTION}>{t('songTitle')}</span>
          <input className={FIELD} value={song.title} maxLength={120} onChange={(e) => onChange({ title: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={CAPTION}>{t('language')}</span>
          <select className={FIELD} value={song.language} onChange={(e) => onChange({ language: e.target.value as DocxSong['language'] })}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      {song.sections.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={CAPTION} id={`add-section-${song.key}`}>
            {t('addSection')}
          </span>
          <div role="group" aria-labelledby={`add-section-${song.key}`} className="flex gap-1.5 overflow-x-auto pb-1">
            {song.sections.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setDeck(appendSection(deck, song, s.label, opts))}
                aria-label={`${t('addSection')}: ${s.label}`}
                className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-bold whitespace-nowrap transition hover:brightness-125 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${tone(s.label)}`}
              >
                <Plus size={12} aria-hidden />
                {s.label}
                {s.repeat > 1 && (
                  <sup className="font-semibold" title={t('repeatSung', { n: s.repeat })}>
                    //{s.repeat}
                  </sup>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {(issues.length > 0 || song.warnings.length > 0) && (
        <div className="flex flex-col gap-1 rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs">
          {issues.map((i) => (
            <p key={i.code} className="text-danger">
              {issueText(i.code)}
            </p>
          ))}
          {song.warnings.length > 0 && <p className={`${CAPTION} text-warn`}>{t('cues')}</p>}
          {song.warnings.map((w) => (
            <p key={w} className="text-fg/75">
              {w}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className={CAPTION}>
            {t('slidesPreview')} · {t('slides', { count: slides.length })}
          </span>
          <span className="flex items-center gap-2">
            {customOrder ? (
              <span className={`${BADGE} bg-accent/15 text-accent`}>{t('slidesCustom')}</span>
            ) : (
              slides.length > 1 && <span className="text-[11px] text-faint">{t('slidesHint')}</span>
            )}
            {song.deck != null && (
              <button
                type="button"
                onClick={() => onChange({ deck: null })}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-fg/15 px-2 text-[11px] font-semibold text-fg/85 transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
              >
                <RotateCcw size={11} aria-hidden /> {t('slidesReset')}
              </button>
            )}
          </span>
        </div>
        <ol
          className="grid grid-cols-2 gap-3 lg:grid-cols-3"
          aria-label={t('slidesPreview')}
          onDragOver={(e) => ownSlideDrag(e) && e.preventDefault()}
          onDrop={onGridDrop}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSlideDropTarget(null);
          }}
        >
          {slides.map((s, i) => (
            <li
              key={s.id}
              ref={(el) => {
                if (el) cards.current.set(s.id, el);
                else cards.current.delete(s.id);
              }}
              tabIndex={0}
              draggable
              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
              aria-label={`#${i + 1} · ${s.continuation ? `${t('partContinuation')} (${s.type})` : s.type}`}
              title={t('slidesHint')}
              onPointerDown={(e) => {
                fromButton.current = !!(e.target as HTMLElement).closest('button, select');
              }}
              onDragStart={(e) => {
                if (fromButton.current) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData(SLIDE_DRAG, String(i));
                setDraggedSlideIndex(i);
              }}
              onDragOver={(e) => onSlideDragOver(e, i)}
              onDragEnd={endSlideDrag}
              onKeyDown={(e) => onSlideKey(e, i)}
              className={`relative cursor-grab rounded-md select-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none active:cursor-grabbing ${
                draggedSlideIndex === i ? 'opacity-45 ring-2 ring-accent' : ''
              }`}
            >
              {slideDropAt?.index === i && (
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-y-0 z-10 w-1 rounded-full bg-accent ${slideDropAt.side === 'before' ? '-left-2' : '-right-2'}`}
                />
              )}
              <SlideCard
                n={i + 1}
                part={s.continuation ? '' : s.type}
                text={s.text}
                onPart={(part) => setDeck(setDeckSlidePart(deck, i, part))}
                onDuplicate={() => duplicateAt(i)}
                onRemove={deck.length > 1 ? () => removeAt(i) : null}
                t={t}
              />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
