import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, CopyPlus, FileUp, History, PenLine, Trash2, X } from 'lucide-react';
import { LANGUAGES, sectionHeader } from '../../shared/lyrics-parser.js';
import { isMetadataLine, splitSongSheet } from '../../shared/lyrics-import.js';
import { batchT } from '../../shared/song-batch-i18n.js';
import { bridge } from '../live/bridge';
import { useUi } from '../state/ui';
import { BatchImportView, type CloseGuard } from './BatchImportView';
import { useLyT, type LyT } from './strings';
import type { Hymn, HymnLanguage } from './types';
import { CategorySelectGroup } from './CategorySelectGroup';
import { useSongEditor, type PreviewStanza, type SongEditor } from './useSongEditor';

const api = bridge.lyrics;

const SAMPLE = `[Verse 1]
Ang Panginoon ang aking pastol
Hindi ako magkukulang

[Chorus]
Aleluya, aleluya

[Verse 2]
Sa sariwang pastulan`;

/** The keys a song can be in, major then minor. A song saved in another key keeps it. */
const KEYS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

const FIELD = 'h-10 w-full rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none placeholder:text-fg/40 focus:border-accent focus:ring-1 focus:ring-accent/40';
const CAPTION = 'flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-fg/60 uppercase';
const ICON = 'grid size-7 place-items-center rounded-md text-fg/60 transition hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Which part a stanza is, as a colour: verses carry the accent, a chorus is green, a bridge blue, a tag or outro amber. */
const chipTone = (type: string) =>
  /^Chorus/.test(type) ? 'border-ok/50 bg-ok/10 text-ok'
    : /^Bridge/.test(type) ? 'border-info/50 bg-info/10 text-info'
      : /^(Tag|Outro)/.test(type) ? 'border-warn/50 bg-warn/10 text-warn'
        : 'border-accent/50 bg-accent/10 text-accent';

/**
 * One stanza as the projector shows it: white lines centred on black, sized to fit the screen. The size follows the longest line and the
 * number of lines, so a long stanza is seen to shrink, as it will live.
 */
function CuePreview({ stanza }: { stanza: PreviewStanza }) {
  const lines = stanza.lyricsText.split('\n');
  const longest = Math.max(8, ...lines.map((l) => l.length));
  const size = `min(${(88 / (longest * 0.55)).toFixed(2)}cqw, ${(82 / (lines.length * 1.3)).toFixed(2)}cqh, 11cqh)`;
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black" style={{ containerType: 'size' }}>
      <div className="absolute inset-0 flex items-center justify-center px-[5%] text-center leading-[1.3] font-semibold whitespace-pre-line text-white" style={{ fontSize: size }}>
        {stanza.lyricsText}
      </div>
    </div>
  );
}

/** The song form with its lyrics box and, beside it, the slides as they will be cued, which can be moved, repeated or removed. */
function SongComposer({
  editor: e,
  hymn,
  active,
  t,
  onClose,
  onSaved,
}: {
  editor: SongEditor;
  hymn: Hymn | null;
  active: boolean;
  t: LyT;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { fields, set } = e;
  const lyricsRef = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const submit = async () => {
    if (await e.save()) onSaved();
  };

  // Ctrl+Enter saves from anywhere in the form; Escape closes (the draft is kept).
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
      } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /**
   * Pasting a song sheet fills the title and the stanzas: the credit lines are dropped, and the title goes in only when the title field is
   * empty. A plain single-line paste keeps the browser's own paste.
   */
  const pasteSheet = (ev: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = ev.clipboardData.getData('text');
    const trimmed = pasted.trim();
    const isSheet = /[\r\n]/.test(pasted) || Boolean(sectionHeader(trimmed)) || isMetadataLine(trimmed);
    if (!isSheet) return;
    const sheet = splitSongSheet(pasted);
    if (!sheet.title && !sheet.raw) return;
    ev.preventDefault();
    const el = ev.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const empty = fields.raw.trim() === '';
    set('raw', empty ? sheet.raw : `${fields.raw.slice(0, start)}${sheet.raw}${fields.raw.slice(end)}`);
    if (!fields.title.trim() && sheet.title) set('title', sheet.title);
    setNotice(t('sheetPasted'));
    if (!empty) {
      const caret = start + sheet.raw.length;
      requestAnimationFrame(() => lyricsRef.current?.setSelectionRange(caret, caret));
    }
  };

  /** Reads one song from a PDF, Word or text file into the form. Nothing is saved until the operator saves. */
  const importOne = async () => {
    e.setError(null);
    setNotice(null);
    setImporting(true);
    try {
      const result = await api.importFile();
      if (!result) return;
      if (fields.raw.trim() && !window.confirm(t('importReplace', { name: result.fileName }))) return;
      set('raw', result.raw);
      if (!fields.title.trim()) set('title', result.title);
      setNotice(t('importedFrom', { name: result.fileName }));
    } catch (err) {
      e.setError(errorText(err));
    } finally {
      setImporting(false);
    }
  };

  /** Puts a section tag on its own line where the cursor is, and leaves the cursor after it, ready to type. */
  const insertTag = (tag: string) => {
    const el = lyricsRef.current;
    const at = el ? el.selectionStart : fields.raw.length;
    const before = fields.raw.slice(0, at);
    const after = fields.raw.slice(el ? el.selectionEnd : fields.raw.length);
    const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const inserted = `${lead}${tag}\n`;
    set('raw', `${before}${inserted}${after}`);
    const caret = before.length + inserted.length;
    requestAnimationFrame(() => {
      lyricsRef.current?.focus();
      lyricsRef.current?.setSelectionRange(caret, caret);
    });
  };
  const nextVerse = e.stanzas.filter((s) => /^Verse/.test(s.stanzaType)).length + 1;
  const TAGS = [
    { label: t('tagVerse'), tag: `[Verse ${nextVerse}]` },
    { label: t('tagChorus'), tag: '[Chorus]' },
    { label: t('tagBridge'), tag: '[Bridge]' },
    { label: t('tagOutro'), tag: '[Outro]' },
  ];

  const showProblem = (p: SongEditor['problems'][number]) => e.triedSave && e.problems.includes(p);
  const keyOptions = fields.musicalKey && !KEYS.includes(fields.musicalKey) ? [fields.musicalKey, ...KEYS] : KEYS;
  const required = <span className="text-danger" aria-hidden>*</span>;
  const footerProblem = e.error ?? e.parseError ?? (e.triedSave ? (e.problems.includes('titleMissing') ? t('problemTitle') : e.problems.includes('noStanzas') ? t('problemStanzas') : e.problems.includes('songCategoryMissing') ? t('chooseSongCategory') : null) : null);

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit();
      }}
      className={active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
    >
      {e.draftNotice && (
        <div role="status" className="flex flex-wrap items-center gap-3 border-b border-info/40 bg-info/10 px-6 py-2.5 text-sm text-fg/90">
          <History size={16} className="shrink-0 text-info" aria-hidden />
          <span className="min-w-0 flex-1">{t('draftRestored', { time: new Date(e.draftNotice).toLocaleString() })}</span>
          <button type="button" onClick={e.discardChanges} className="rounded-md border border-fg/20 px-3 py-1 text-xs font-semibold hover:border-danger/60 hover:text-danger">
            {t('draftDiscard')}
          </button>
          <button type="button" onClick={e.dismissDraftNotice} aria-label={t('close')} className={ICON}>
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* The song's details. Title and song category are required. */}
          <section aria-label={t('detailsHeading')} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={CAPTION}>{t('fieldTitle')} {required}</span>
              <input
                autoFocus
                maxLength={120}
                value={fields.title}
                onChange={(ev) => set('title', ev.target.value)}
                aria-invalid={showProblem('titleMissing') || undefined}
                className={`${FIELD} ${showProblem('titleMissing') ? '!border-danger' : ''}`}
              />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <label className="flex flex-col gap-1.5">
                <span className={CAPTION}>{t('fieldComposer')}</span>
                <input maxLength={80} value={fields.composer} placeholder={t('hymnalPlaceholder')} onChange={(ev) => set('composer', ev.target.value)} className={FIELD} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={CAPTION}>{t('fieldKey')}</span>
                <select value={fields.musicalKey} onChange={(ev) => set('musicalKey', ev.target.value)} className={FIELD}>
                  <option value="">{t('keyNone')}</option>
                  {keyOptions.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <CategorySelectGroup
              t={t}
              mode="form"
              required
              idPrefix="add-song"
              scope={fields.primaryCategory}
              onScope={(scope) => set('primaryCategory', scope)}
              songCategory={fields.songCategory}
              onSongCategory={(name) => set('songCategory', name)}
              categories={e.songCategories}
              invalid={showProblem('songCategoryMissing')}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className={CAPTION}>{t('fieldLanguage')}</span>
                <select value={fields.language} onChange={(ev) => set('language', ev.target.value as HymnLanguage)} className={FIELD}>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {t(`lang_${l}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {/* The lyrics: typed, pasted, or read from a file. The section buttons put a tag where the cursor is. */}
          <section aria-label={t('fieldLyrics')} className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={CAPTION}>{t('fieldLyrics')} {required}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] text-fg/50">{t('insertSection')}</span>
                {TAGS.map(({ label, tag }) => (
                  <button key={label} type="button" onClick={() => insertTag(tag)} title={tag} className="h-7 rounded-md border border-fg/15 bg-panel-2 px-2.5 text-[11px] font-semibold text-fg/85 transition hover:border-accent/50 hover:text-accent">
                    {label}
                  </button>
                ))}
                {!hymn && (
                  <>
                    <span className="mx-1 h-5 w-px bg-line" aria-hidden />
                    <button type="button" onClick={() => void importOne()} disabled={importing} className="flex h-7 items-center gap-1.5 rounded-md border border-fg/15 bg-panel-2 px-2.5 text-[11px] font-semibold text-fg/85 transition hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40">
                      <FileUp size={12} aria-hidden /> {importing ? t('importing') : t('importOneFile')}
                    </button>
                  </>
                )}
              </div>
            </div>
            <textarea
              value={fields.raw}
              ref={lyricsRef}
              onPaste={pasteSheet}
              onChange={(ev) => set('raw', ev.target.value)}
              placeholder={SAMPLE}
              spellCheck={false}
              aria-label={t('fieldLyrics')}
              aria-invalid={showProblem('noStanzas') || undefined}
              className={`min-h-[320px] flex-1 resize-y rounded-lg border bg-panel-2 p-3 font-mono text-sm leading-relaxed text-fg outline-none placeholder:text-fg/35 focus:border-accent focus:ring-1 focus:ring-accent/40 ${showProblem('noStanzas') ? 'border-danger' : 'border-fg/15'}`}
            />
            <p className="text-xs text-fg/60">{t('lyricsHelp')}</p>
            {notice && <p role="status" className="rounded-lg border border-ok/50 bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</p>}
          </section>
        </div>

        {/* The slides the projector will get, updated as you type. Each can be moved, repeated or removed. */}
        <aside aria-label={t('previewTitle', { n: e.stanzas.length })} className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0 lg:max-h-[calc(100vh-15rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={CAPTION}>{t('previewTitle', { n: e.stanzas.length })}</span>
            <span className="text-[11px] text-fg/45">{t('previewHint')}</span>
          </div>
          {e.stanzas.length === 0 ? (
            <div className={`grid min-h-40 place-items-center rounded-[10px] border-2 border-dashed p-6 text-center text-sm text-fg/60 ${showProblem('noStanzas') ? 'border-danger/60' : 'border-fg/20'}`}>
              {t('parsedEmpty')}
            </div>
          ) : (
            <ol className="flex flex-col gap-3">
              {e.stanzas.map((s, i) => (
                <li key={`${i}-${s.stanzaType}`} className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-fg/45 tabular-nums">{i + 1}</span>
                    <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider uppercase ${chipTone(s.stanzaType)}`}>{s.stanzaType}</span>
                    <div className="ml-auto flex items-center">
                      <button type="button" onClick={() => e.stanzaActions.move(i, i - 1)} disabled={i === 0} aria-label={`${t('moveUp')}: ${s.stanzaType}`} title={t('moveUp')} className={ICON}>
                        <ArrowUp size={14} aria-hidden />
                      </button>
                      <button type="button" onClick={() => e.stanzaActions.move(i, i + 1)} disabled={i === e.stanzas.length - 1} aria-label={`${t('moveDown')}: ${s.stanzaType}`} title={t('moveDown')} className={ICON}>
                        <ArrowDown size={14} aria-hidden />
                      </button>
                      <button type="button" onClick={() => e.stanzaActions.duplicate(i)} aria-label={`${t('stanzaRepeat')}: ${s.stanzaType}`} title={t('stanzaRepeat')} className={ICON}>
                        <CopyPlus size={14} aria-hidden />
                      </button>
                      <button type="button" onClick={() => e.stanzaActions.remove(i)} aria-label={`${t('stanzaRemove')}: ${s.stanzaType}`} title={t('stanzaRemove')} className={`${ICON} hover:text-danger`}>
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                  </div>
                  <CuePreview stanza={s} />
                </li>
              ))}
            </ol>
          )}
          {e.warnings.map((w) => (
            <p key={w} className="flex items-start gap-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-xs text-warn">
              <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden /> {w}
            </p>
          ))}
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-6 py-4">
        <p role="alert" className="min-h-5 min-w-0 flex-1 text-sm text-danger">{footerProblem ?? ''}</p>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-fg/50 md:block">{e.draftSavedAt ? t('saveHintDraft') : t('saveHint')}</span>
          {e.dirty && (
            <button type="button" onClick={() => window.confirm(t('discardConfirm')) && e.discardChanges()} className="h-10 rounded-md px-3 text-xs font-semibold tracking-wide text-fg/70 uppercase transition hover:text-danger">
              {t('draftDiscard')}
            </button>
          )}
          <button type="button" onClick={onClose} className="h-10 rounded-md border border-fg/15 bg-panel-2 px-4 text-xs font-semibold tracking-wide text-fg/85 uppercase transition hover:bg-fg/10 hover:text-fg">
            {t('close')}
          </button>
          <button type="submit" disabled={e.busy} className="h-10 rounded-md border border-accent bg-accent px-5 text-xs font-extrabold tracking-wider text-on-accent uppercase transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
            {e.busy ? t('saving') : t('saveHymn')}
          </button>
        </div>
      </footer>
    </form>
  );
}

export type AddSongTab = 'type' | 'import';

/**
 * Adds songs to the Hymn Library, two ways, each on its own tab: type or paste one song (with its slides shown as they will be cued), or
 * import many songs from a Word or text file. With `hymn`, it edits that song instead, and only the typing tab is there.
 * Both tabs stay open while the other is shown, so switching never loses work.
 */
export function AddSongModal({
  hymn = null,
  initialTab = 'type',
  onClose,
  onSaved,
  onOpenSong,
  onImported,
}: {
  hymn?: Hymn | null;
  initialTab?: AddSongTab;
  onClose: () => void;
  /** After the typed song is saved. */
  onSaved: () => void;
  /** Opens a song added by the file import. */
  onOpenSong: (id: number) => void;
  /** After the file import added songs. */
  onImported: () => void;
}) {
  const t = useLyT();
  const lang = useUi((s) => s.lang);
  const editor = useSongEditor(hymn);
  const [tab, setTab] = useState<AddSongTab>(hymn ? 'type' : initialTab);
  const closeGuard: CloseGuard = useRef<(() => boolean) | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const requestClose = () => {
    if (closeGuard.current?.() ?? true) onClose();
  };

  // Focus goes back where it was when the dialog closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => before?.focus?.();
  }, []);

  const tabs: { id: AddSongTab; label: string; icon: ReactNode }[] = [
    { id: 'type', label: t('tabType'), icon: <PenLine size={15} aria-hidden /> },
    { id: 'import', label: t('tabImport'), icon: <FileUp size={15} aria-hidden /> },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 sm:p-6" onMouseDown={(ev) => ev.target === ev.currentTarget && requestClose()}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-song-heading"
        className="relative flex h-[min(920px,100%)] w-full max-w-[1180px] flex-col overflow-hidden rounded-xl border border-fg/15 bg-panel shadow-2xl"
      >
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-6 py-3.5">
          <h2 id="add-song-heading" className="text-xl font-bold tracking-tight text-fg">
            {hymn ? t('editHymn') : t('addSongTitle')}
          </h2>
          {!hymn && (
            <div role="tablist" aria-label={t('addSongTitle')} className="inline-flex rounded-lg border border-fg/15 bg-panel-2 p-1">
              {tabs.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === x.id}
                  onClick={() => setTab(x.id)}
                  className={`flex h-8 items-center gap-2 rounded-md px-3.5 text-xs font-bold tracking-wide transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
                    tab === x.id ? 'bg-accent text-on-accent shadow' : 'text-fg/70 hover:text-fg'
                  }`}
                >
                  {x.icon} {x.label}
                </button>
              ))}
            </div>
          )}
          {!hymn && tab === 'import' && <span className="hidden text-xs text-fg/50 md:inline">{batchT(lang, 'dropHint', { mb: 10 })}</span>}
          <button type="button" onClick={requestClose} aria-label={t('close')} title={t('close')} className="ml-auto grid size-8 place-items-center rounded-md text-fg/60 transition hover:bg-fg/10 hover:text-fg">
            <X size={18} aria-hidden />
          </button>
        </header>

        <SongComposer editor={editor} hymn={hymn} active={tab === 'type'} t={t} onClose={requestClose} onSaved={onSaved} />
        {!hymn && <BatchImportView active={tab === 'import'} closeGuard={closeGuard} onClose={requestClose} onOpenSong={onOpenSong} onImported={onImported} />}
      </div>
    </div>
  );
}
