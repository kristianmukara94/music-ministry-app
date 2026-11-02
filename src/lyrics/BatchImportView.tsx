import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Files,
  FileUp,
  Loader2,
  Merge,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { LANGUAGES } from '../../shared/lyrics-parser.js';
import { batchT } from '../../shared/song-batch-i18n.js';
import { effectiveTitle, MAX_BATCH_FILE_BYTES, MAX_SONG_TITLE, type SongIssue, type SplitMode } from '../../shared/song-batch.js';
import { useUi } from '../state/ui';
import { useLyT } from './strings';
import type { HymnLanguage } from './types';
import { CategorySelectGroup } from './CategorySelectGroup';
import { useBatchImporter, type BatchImporter, type ReviewSong } from './useBatchImporter';

type BT = (key: string, vars?: Record<string, string | number>) => string;
function useBatchT(): BT {
  const lang = useUi((s) => s.lang);
  return (key, vars) => batchT(lang, key, vars);
}

const FIELD = 'h-10 w-full rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none placeholder:text-fg/40 focus:border-accent focus:ring-1 focus:ring-accent/40';
const LABEL = 'text-[11px] font-bold tracking-wider text-fg/60 uppercase';
const BUTTON = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-fg/15 bg-panel-2 px-4 text-xs font-bold tracking-wider text-fg/90 uppercase transition hover:border-accent/50 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-5 text-xs font-extrabold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40';
const ICON = 'grid size-8 shrink-0 place-items-center rounded-md border border-transparent text-fg/60 transition hover:border-fg/15 hover:bg-panel-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30';

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The stanza labels a stanza can be given, with its current one kept even when it is not on the list. */
function stanzaOptions(current: string): string[] {
  const list = [...Array.from({ length: 12 }, (_, i) => `Verse ${i + 1}`), 'Chorus', 'Chorus 2', 'Bridge', 'Bridge 2', 'Tag', 'Outro'];
  return list.includes(current) ? list : [current, ...list];
}

/** One issue as a small badge: amber for something to check, red for something that stops the import. */
function IssueBadge({ issue, t }: { issue: SongIssue; t: BT }) {
  const error = issue.level === 'error';
  const help = t(`issueHelp_${issue.code}`);
  return (
    <span
      title={help === `issueHelp_${issue.code}` ? undefined : help}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
        error ? 'border-danger/50 bg-danger/15 text-danger' : 'border-warn/50 bg-warn/15 text-warn'
      }`}
    >
      {error ? <XCircle size={11} aria-hidden /> : <AlertTriangle size={11} aria-hidden />}
      {t(`issue_${issue.code}`)}
    </span>
  );
}

/** The three steps across the top, the current one lit. */
function Stepper({ step, t }: { step: BatchImporter['step']; t: BT }) {
  const at = step === 'upload' || step === 'reading' ? 0 : step === 'done' ? 2 : 1;
  const steps = [t('stepUpload'), t('stepReview'), t('stepDone')];
  return (
    <ol className="flex items-center gap-2" aria-label="Steps">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2" aria-current={i === at ? 'step' : undefined}>
          <span
            className={`grid size-6 place-items-center rounded-full text-[11px] font-extrabold ${
              i < at ? 'bg-accent/25 text-accent' : i === at ? 'bg-accent text-on-accent' : 'border border-fg/20 text-fg/50'
            }`}
          >
            {i < at ? <Check size={13} aria-hidden /> : i + 1}
          </span>
          <span className={`hidden text-xs font-semibold sm:inline ${i === at ? 'text-fg' : 'text-fg/55'}`}>{label}</span>
          {i < steps.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-fg/20" />}
        </li>
      ))}
    </ol>
  );
}

/** An error the operator can act on, with a way to dismiss it. */
function ErrorAlert({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
      <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{text}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-danger/20">
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Step 1: the file

function UploadStep({ b, t }: { b: BatchImporter; t: BT }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const reading = b.step === 'reading';

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && !reading) b.acceptFile(dropped);
  };

  return (
    <div className="flex flex-col gap-5 p-6">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = reading ? 'none' : 'copy';
        }}
        onDragLeave={() => {
          depth.current -= 1;
          if (depth.current <= 0) setOver(false);
        }}
        onDrop={onDrop}
        className={`flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
          over ? 'border-accent bg-accent/10' : 'border-fg/20 bg-panel-2/40'
        }`}
      >
        {reading ? (
          <div className="flex w-full max-w-md flex-col items-center gap-4" role="status" aria-live="polite">
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
              <FileText size={14} aria-hidden /> <span className="truncate">{b.file?.name}</span>
            </span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-fg/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={b.progress}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${b.progress}%` }} />
            </div>
            <p className="flex items-center gap-2 text-sm text-fg/75">
              <Loader2 size={15} className="animate-spin" aria-hidden /> {t(b.stage)}
            </p>
          </div>
        ) : (
          <>
            <span className={`grid size-16 place-items-center rounded-full ${over ? 'bg-accent text-on-accent' : 'bg-accent/15 text-accent'}`}>
              <Upload size={28} aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-lg font-bold text-fg">{over ? t('dropActive') : t('dropTitle')}</p>
              <p className="text-sm text-fg/60">{t('dropHint', { mb: MAX_BATCH_FILE_BYTES / 1024 / 1024 })}</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-fg/50">
              <span className="h-px w-10 bg-fg/20" aria-hidden /> {t('dropOr')} <span className="h-px w-10 bg-fg/20" aria-hidden />
            </div>
            <button type="button" onClick={() => void b.browse()} className={PRIMARY} autoFocus>
              <FileUp size={15} aria-hidden /> {t('browse')}
            </button>
          </>
        )}
      </div>

      {b.error && <ErrorAlert text={b.error.key ? t(b.error.key, b.error.vars) : b.error.message ?? ''} onDismiss={b.clearError} />}

      <section className="rounded-lg border border-line bg-panel-2/40 p-4">
        <h3 className={LABEL}>{t('howTitle')}</h3>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-fg/70">
          <li>{t('how1')}</li>
          <li>{t('how2')}</li>
          <li>{t('how3')}</li>
        </ul>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Step 2: the songs

function SongCard({ song, index, b, t }: { song: ReviewSong; index: number; b: BatchImporter; t: BT }) {
  const issues = b.issuesOf.get(song.key) ?? [];
  const hasError = issues.some((i) => i.level === 'error');
  const first = effectiveTitle({ title: '', stanzas: song.stanzas });
  const position = b.songs.findIndex((s) => s.key === song.key);

  return (
    <li
      className={`rounded-lg border bg-panel-2/70 transition ${
        song.selected ? (hasError ? 'border-danger/50' : 'border-accent/40') : 'border-line opacity-70'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <input
          type="checkbox"
          checked={song.selected}
          onChange={() => b.toggleSelected(song.key)}
          aria-label={`Import ${effectiveTitle(song) || `song ${index + 1}`}`}
          className="size-4 shrink-0 cursor-pointer accent-accent"
        />
        <button type="button" onClick={() => b.toggleOpen(song.key)} aria-expanded={song.open} aria-label={song.open ? t('collapse') : t('expand')} className={ICON}>
          {song.open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        </button>
        <span className="w-7 shrink-0 text-right font-mono text-xs text-fg/40 tabular-nums">{position + 1}</span>
        <input
          value={song.title}
          maxLength={MAX_SONG_TITLE + 20}
          onChange={(e) => b.setTitle(song.key, e.target.value)}
          placeholder={first ? t('titlePlaceholder', { first }) : t('titlePlaceholderEmpty')}
          aria-label={t('titleLabel')}
          className="h-9 min-w-[12rem] flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold text-fg outline-none placeholder:font-normal placeholder:text-fg/40 hover:border-fg/15 focus:border-accent focus:bg-panel-2"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {issues.map((issue) => (
            <IssueBadge key={issue.code} issue={issue} t={t} />
          ))}
          <span className="text-xs text-fg/50 tabular-nums">{song.stanzas.length === 1 ? t('stanzaOne') : t('stanzaCount', { count: song.stanzas.length })}</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => b.toggleSource(song.key)} aria-pressed={song.showSource} title={song.showSource ? t('hideSource') : t('showSource')} aria-label={song.showSource ? t('hideSource') : t('showSource')} className={`${ICON} ${song.showSource ? 'border-accent/40 text-accent' : ''}`}>
            <FileText size={15} aria-hidden />
          </button>
          <button type="button" onClick={() => b.mergeUp(song.key)} disabled={position <= 0} title={t('mergeUp')} aria-label={t('mergeUp')} className={ICON}>
            <Merge size={15} aria-hidden />
          </button>
          <button type="button" onClick={() => b.removeSong(song.key)} title={t('removeSong')} aria-label={t('removeSong')} className={`${ICON} hover:text-danger`}>
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      </div>

      {song.open && (
        <div className={`grid gap-4 border-t border-line px-4 py-4 ${song.showSource ? 'lg:grid-cols-2' : ''}`}>
          <div className="flex min-w-0 flex-col gap-3">
            {issues.some((i) => i.code === 'noStanzas') && <p className="text-xs text-danger">{t('issueHelp_noStanzas')}</p>}
            {song.stanzas.map((stanza, si) => (
              <div key={stanza.key} className="flex flex-col gap-1.5 rounded-md border border-line bg-panel-2/50 p-3">
                <div className="flex items-center gap-2">
                  <select
                    value={stanza.type}
                    onChange={(e) => b.setStanzaType(song.key, stanza.key, e.target.value)}
                    aria-label={t('stanzaType')}
                    className="h-8 rounded-md border border-fg/15 bg-panel px-2 text-xs font-semibold text-accent outline-none focus:border-accent"
                  >
                    {stanzaOptions(stanza.type).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <div className="ml-auto flex items-center gap-1">
                    <button type="button" onClick={() => b.splitAt(song.key, si)} disabled={si === 0} title={t('splitHere')} aria-label={t('splitHere')} className={ICON}>
                      <Scissors size={14} aria-hidden />
                    </button>
                    <button type="button" onClick={() => b.removeStanza(song.key, stanza.key)} title={t('removeStanza')} aria-label={t('removeStanza')} className={`${ICON} hover:text-danger`}>
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </div>
                <textarea
                  value={stanza.text}
                  onChange={(e) => b.setStanzaText(song.key, stanza.key, e.target.value)}
                  rows={Math.min(10, Math.max(2, stanza.text.split('\n').length))}
                  aria-label={`${stanza.type}`}
                  className={`w-full resize-y rounded-md border bg-panel px-3 py-2 text-sm leading-relaxed text-fg outline-none focus:border-accent ${stanza.text.trim() ? 'border-fg/15' : 'border-warn/60'}`}
                />
              </div>
            ))}
            <button type="button" onClick={() => b.addStanza(song.key)} className={`${BUTTON} w-fit`}>
              <Plus size={14} aria-hidden /> {t('addStanza')}
            </button>
          </div>
          {song.showSource && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className={LABEL}>{t('source')}</span>
              <pre className="max-h-[28rem] overflow-auto rounded-md border border-line bg-black/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg/75">{song.source || '—'}</pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ReviewStep({ b, t, lt }: { b: BatchImporter; t: BT; lt: ReturnType<typeof useLyT> }) {
  const [mode, setMode] = useState<SplitMode>(b.options.mode);
  const [delimiter, setDelimiter] = useState(b.options.delimiter);
  const allShownSelected = b.visible.length > 0 && b.visible.every((s) => s.selected);
  const someShownSelected = b.visible.some((s) => s.selected);
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someShownSelected && !allShownSelected;
  }, [someShownSelected, allShownSelected]);

  const resplit = () => {
    if (b.edited && !window.confirm(t('resplitConfirm'))) return;
    b.resplit({ mode, delimiter });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The file, how it was split, and what every song is saved with. */}
      <div className="flex flex-col gap-4 border-b border-line px-6 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <span className="inline-flex h-10 max-w-full items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 text-xs font-semibold text-accent">
            <FileText size={15} aria-hidden />
            <span className="max-w-[16rem] truncate">{b.file?.name}</span>
            {b.file?.size ? <span className="text-accent/70">{formatSize(b.file.size)}</span> : null}
          </span>
          <label className="flex min-w-[12rem] flex-col gap-1">
            <span className={LABEL}>{t('splitBy')}</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as SplitMode)} className={FIELD}>
              <option value="auto">{t('modeAuto')}</option>
              <option value="blank">{t('modeBlank')}</option>
              <option value="delimiter">{t('modeDelimiter')}</option>
            </select>
          </label>
          {mode === 'delimiter' && (
            <label className="flex w-40 flex-col gap-1" title={t('delimiterHint')}>
              <span className={LABEL}>{t('delimiterLabel')}</span>
              <input value={delimiter} onChange={(e) => setDelimiter(e.target.value)} placeholder="---" className={`${FIELD} font-mono`} />
            </label>
          )}
          <button type="button" onClick={resplit} className={BUTTON}>
            <RefreshCw size={14} aria-hidden /> {t('resplit')}
          </button>
          <span className="ml-auto self-center text-sm font-semibold text-fg/80">{t('found', { count: b.songs.length })}</span>
        </div>

        <fieldset className="flex flex-wrap items-end gap-3">
          <legend className={`${LABEL} mb-1`}>{t('defaults')}</legend>
          <div className="min-w-[18rem] flex-[2]">
            <CategorySelectGroup
              t={lt}
              mode="form"
              required
              idPrefix="batch"
              scope={b.defaults.primaryCategory}
              onScope={(scope) => b.setDefaults({ primaryCategory: scope })}
              songCategory={b.defaults.songCategory}
              onSongCategory={(name) => b.setDefaults({ songCategory: name })}
              names={b.songCategories.map((c) => c.name)}
              invalid={b.categoryMissing}
            />
          </div>
          <label className="flex min-w-[9rem] flex-col gap-1">
            <span className={LABEL}>{t('language')}</span>
            <select value={b.defaults.language} onChange={(e) => b.setDefaults({ language: e.target.value as HymnLanguage })} className={FIELD}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {lt(`lang_${l}`)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        {/* The whole list at once: tick all, search, remove, and how many need a look. */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg/85">
            <input ref={selectAllRef} type="checkbox" checked={allShownSelected} onChange={() => b.selectAll(!allShownSelected)} className="size-4 accent-accent" />
            {t('selectAll')}
          </label>
          <span className="text-xs text-fg/55 tabular-nums">{t('selectedCount', { selected: b.selected.length, total: b.songs.length })}</span>
          <label className="relative min-w-[12rem] flex-1">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg/45" aria-hidden />
            <input value={b.query} onChange={(e) => b.setQuery(e.target.value)} placeholder={t('search')} aria-label={t('search')} className={`${FIELD} h-9 pl-8`} />
          </label>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('deleteSelectedConfirm', { count: b.selected.length }))) b.removeSelected();
            }}
            disabled={b.selected.length === 0}
            className={`${BUTTON} h-9 hover:border-danger/60 hover:text-danger`}
          >
            <Trash2 size={14} aria-hidden /> {t('deleteSelected')}
          </button>
          <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase">
            <span className="rounded-full bg-ok/15 px-2 py-0.5 text-ok">{t('ready', { count: b.counts.ready })}</span>
            {b.counts.warnings > 0 && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-warn">{t('warnings', { count: b.counts.warnings })}</span>}
            {b.counts.errors > 0 && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-danger">{t('errors', { count: b.counts.errors })}</span>}
          </div>
        </div>
        {b.error && <ErrorAlert text={b.error.key ? t(b.error.key, b.error.vars) : b.error.message ?? ''} onDismiss={b.clearError} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {b.visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-fg/20 px-4 py-8 text-center text-sm text-fg/60">{t('noMatch', { query: b.query })}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {b.visible.map((song, i) => (
              <SongCard key={song.key} song={song} index={i} b={b} t={t} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Step 3: done

function DoneStep({ b, t, onOpenSong }: { b: BatchImporter; t: BT; onOpenSong: (id: number) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center gap-4">
        <span className={`grid size-14 shrink-0 place-items-center rounded-full ${b.saved.length ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'}`}>
          {b.saved.length ? <CheckCircle2 size={30} aria-hidden /> : <XCircle size={30} aria-hidden />}
        </span>
        <h3 className="text-xl font-bold text-fg" role="status">
          {b.saved.length === 0 ? t('doneNone') : b.saved.length === 1 ? t('doneOne') : t('doneTitle', { count: b.saved.length })}
        </h3>
      </div>
      {b.saved.length > 0 && (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel-2/70">
          {b.saved.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <Check size={15} className="shrink-0 text-ok" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{s.title}</span>
              <button type="button" onClick={() => onOpenSong(s.id)} className={`${BUTTON} h-8 px-3`}>
                {t('openSong')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {b.failed.length > 0 && (
        <section className="flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-bold text-danger">{t('failedTitle', { count: b.failed.length })}</h4>
            <button type="button" onClick={b.backToReview} className={`${BUTTON} h-8`}>
              {t('failedBack')}
            </button>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {b.failed.map((f) => (
              <li key={f.key} className="text-fg/80">
                <span className="font-semibold">{f.title || '—'}</span>: <span className="text-fg/65">{f.error}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ The view

/** Asks before the import goes away with songs reviewed but not saved. Returns true when it may close. */
export type CloseGuard = { current: (() => boolean) | null };

/**
 * Imports many songs from one Word or text file into the Hymn Library, in three steps: choose the file (drop it or pick it), review the
 * songs found (fix titles and stanzas, split or join songs, untick what should not be imported), and see what was added, with a way to
 * open each new song. It fills a dialog's body (the Add Song dialog's Import tab). While `active`, Escape closes (asking first when
 * reviewed songs would be lost) and Enter goes on to the next step.
 */
export function BatchImportView({
  active,
  closeGuard,
  onClose,
  onOpenSong,
  onImported,
}: {
  active: boolean;
  closeGuard: CloseGuard;
  onClose: () => void;
  onOpenSong: (id: number) => void;
  onImported: () => void;
}) {
  const t = useBatchT();
  const lt = useLyT();
  const b = useBatchImporter();

  const mayClose = () => !b.unsaved || window.confirm(t('discardConfirm'));
  // Asked whichever tab is showing: reviewed songs here are lost however the dialog closes.
  useEffect(() => {
    closeGuard.current = mayClose;
  });

  // The library reloads as soon as songs were added, whether or not the dialog stays open.
  useEffect(() => {
    if (b.step === 'done' && b.saved.length > 0) onImported();
  }, [b.step]);

  // Escape closes; Enter goes on (outside text fields, where Enter means a new line or is the field's own).
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // The dialog asks first, through the close guard.
        onClose();
        return;
      }
      if (e.key !== 'Enter' || e.shiftKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, button')) return;
      if (b.step === 'review' && b.canImport) {
        e.preventDefault();
        void b.importSelected();
      } else if (b.step === 'done') {
        e.preventDefault();
        onClose();
      } else if (b.step === 'upload') {
        e.preventDefault();
        void b.browse();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let footer: ReactNode = null;
  if (b.step === 'review' || b.step === 'saving') {
    footer = (
      <>
        <p className="mr-auto min-w-0 text-xs">
          {b.categoryMissing ? (
            <span className="flex items-center gap-1.5 text-warn">
              <AlertTriangle size={14} aria-hidden /> {t('songCategoryNeeded')}
            </span>
          ) : b.blocked.length > 0 ? (
            <span className="flex items-center gap-1.5 text-danger">
              <XCircle size={14} aria-hidden /> {t('blocked', { count: b.blocked.length })}
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => {
            if (!b.unsaved || window.confirm(t('discardConfirm'))) b.reset();
          }}
          disabled={b.step === 'saving'}
          className={BUTTON}
        >
          {t('another')}
        </button>
        <button key="import" type="button" onClick={() => void b.importSelected()} disabled={!b.canImport || b.step === 'saving'} className={PRIMARY}>
          {b.step === 'saving' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Files size={15} aria-hidden />}
          {b.selected.length === 1 ? t('importOne') : t('importButton', { count: b.selected.length })}
        </button>
      </>
    );
  } else if (b.step === 'done') {
    footer = (
      <>
        <button type="button" onClick={b.reset} className={`${BUTTON} mr-auto`}>
          <FileUp size={14} aria-hidden /> {t('importAnother')}
        </button>
        <button key="done" type="button" onClick={onClose} className={PRIMARY}>
          {t('done')}
        </button>
      </>
    );
  }

  return (
    <div className={active ? 'relative flex min-h-0 flex-1 flex-col' : 'hidden'}>
      <div className="flex items-center justify-end border-b border-line px-6 py-2.5">
        <Stepper step={b.step} t={t} />
      </div>

      {b.step === 'upload' || b.step === 'reading' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <UploadStep b={b} t={t} />
        </div>
      ) : b.step === 'done' ? (
        <DoneStep b={b} t={t} onOpenSong={onOpenSong} />
      ) : (
        <ReviewStep b={b} t={t} lt={lt} />
      )}

      {b.step === 'saving' && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/55" role="status" aria-live="polite">
          <div className="flex w-80 flex-col items-center gap-3 rounded-xl border border-fg/15 bg-panel p-6 text-center shadow-2xl">
            <Loader2 size={26} className="animate-spin text-accent" aria-hidden />
            <p className="text-sm text-fg/85">{t('saving')}</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-fg/10">
              <div className="h-full w-1/3 animate-[batch-slide_1.1s_ease-in-out_infinite] rounded-full bg-accent" />
            </div>
          </div>
        </div>
      )}

      {footer && <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-3">{footer}</footer>}
      <style>{'@keyframes batch-slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}'}</style>
    </div>
  );
}
