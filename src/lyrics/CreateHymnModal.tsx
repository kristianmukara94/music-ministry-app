import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { AlertTriangle, Upload, X } from 'lucide-react';
import { CATEGORIES, LANGUAGES, parseLyrics, sectionHeader, toTaggedLyrics } from '../../shared/lyrics-parser.js';
import { isMetadataLine, splitSongSheet } from '../../shared/lyrics-import.js';
import { isSongCategoryMissing, isSongCategoryRefusal } from '../../shared/hymn-category.js';
import { bridge } from '../live/bridge';
import { useLyT } from './strings';
import type { Hymn, HymnCategory, HymnLanguage, SongCategory } from './types';

const api = bridge.lyrics;

const SAMPLE = `[V1]
Ang Panginoon ang aking pastol
Hindi ako magkukulang

[C]
Aleluya, aleluya

[V2]
Sa sariwang pastulan`;

const field = 'h-10 w-full rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none placeholder:text-fg/40 focus:border-accent focus:ring-1 focus:ring-accent/40';

/** The main process sends IPC errors with a prefix that the operator should not see. */
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Create when `hymn` is absent; edit (prefilled from the stored hymn) when it is present. */
export function CreateHymnModal({
  hymn,
  onClose,
  onSaved,
}: {
  hymn?: Hymn | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useLyT();
  const [title, setTitle] = useState(hymn?.title ?? '');
  const [composer, setComposer] = useState(hymn?.composer ?? '');
  const [musicalKey, setMusicalKey] = useState(hymn?.musicalKey ?? '');
  const [category, setCategory] = useState<HymnCategory>(hymn?.category ?? 'General');
  const [language, setLanguage] = useState<HymnLanguage>(hymn?.language ?? 'EN');
  const [songCategory, setSongCategory] = useState(hymn?.songCategory ?? '');
  const [songCategories, setSongCategories] = useState<SongCategory[]>([]);
  const [raw, setRaw] = useState(hymn ? toTaggedLyrics(hymn.stanzas) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when a save is attempted with no song category. Cleared as soon as a category is chosen.
  const [categoryPrompt, setCategoryPrompt] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lyricsRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.listSongCategories().then(setSongCategories).catch(() => undefined);
  }, []);
  // A song keeps its category even when the list no longer has it, so the form shows it as it is.
  const songCategoryOptions = [
    ...songCategories.map((c) => c.name),
    ...(songCategory && !songCategories.some((c) => c.name === songCategory) ? [songCategory] : []),
  ];

  /**
   * Pasting a song sheet fills the title and the stanzas: the credit lines are dropped, and the title goes in only when the
   * title field is empty. A plain single-line paste keeps the browser's own paste. Nothing is saved until the operator saves.
   */
  const pasteSheet = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text');
    const trimmed = pasted.trim();
    const isSheet = /[\r\n]/.test(pasted) || Boolean(sectionHeader(trimmed)) || isMetadataLine(trimmed);
    if (!isSheet) return;
    const sheet = splitSongSheet(pasted);
    if (!sheet.title && !sheet.raw) return;
    e.preventDefault();

    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const empty = raw.trim() === '';
    setRaw(empty ? sheet.raw : `${raw.slice(0, start)}${sheet.raw}${raw.slice(end)}`);
    if (!title.trim() && sheet.title) setTitle(sheet.title);
    setError(null);
    setNotice(t('sheetPasted'));
    if (!empty) {
      const caret = start + sheet.raw.length;
      requestAnimationFrame(() => lyricsRef.current?.setSelectionRange(caret, caret));
    }
  };

  const parsed = parseLyrics(raw);
  const blocking = raw.trim() ? parsed.errors[0] : undefined;
  const canSave = !busy && title.trim().length > 0 && !blocking && parsed.stanzas.length > 0;

  /** Reads a PDF, Word or text file in the main process and fills the form. Nothing is saved until the operator saves. */
  const importFile = async () => {
    setError(null);
    setNotice(null);
    setImporting(true);
    try {
      const result = await api.importFile();
      if (!result) return;
      if (raw.trim() && !window.confirm(t('importReplace', { name: result.fileName }))) return;
      setRaw(result.raw);
      if (!title.trim()) setTitle(result.title);
      setNotice(t('importedFrom', { name: result.fileName }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setImporting(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    // A hymn needs a song category. Nothing is sent and nothing typed is cleared: the prompt shows beside the field.
    if (isSongCategoryMissing(songCategory)) {
      setCategoryPrompt(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = { title, composer, category, language, musicalKey, songCategory, raw };
      if (hymn) await api.editHymn(hymn.id, input);
      else await api.createHymn(input);
      onSaved();
    } catch (err) {
      const message = errorText(err);
      // The service refuses a save with no category too. The same prompt shows, and the form stays open with its text.
      if (isSongCategoryRefusal(message)) setCategoryPrompt(true);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };

  // Which part a stanza is, as a colour: verses carry the accent, a chorus is green, a bridge blue, a tag amber.
  const chipTone = (type: string) =>
    /^Chorus/.test(type) ? 'border-ok/50 bg-ok/10 text-ok'
      : /^Bridge/.test(type) ? 'border-info/50 bg-info/10 text-info'
        : /^(Tag|Outro)/.test(type) ? 'border-warn/50 bg-warn/10 text-warn'
          : 'border-accent/50 bg-accent/10 text-accent';

  /** Puts a section tag on its own line where the cursor is, then keeps the cursor after it, so the operator can keep typing. */
  const insertTag = (tag: string) => {
    const el = lyricsRef.current;
    const at = el ? el.selectionStart : raw.length;
    const before = raw.slice(0, at);
    const after = raw.slice(el ? el.selectionEnd : raw.length);
    const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const inserted = `${lead}${tag}\n`;
    setRaw(`${before}${inserted}${after}`);
    const caret = before.length + inserted.length;
    requestAnimationFrame(() => {
      lyricsRef.current?.focus();
      lyricsRef.current?.setSelectionRange(caret, caret);
    });
  };
  const nextVerse = parsed.stanzas.filter((s) => /^Verse/.test(s.stanzaType)).length + 1;
  const TAGS: { label: string; tag: string }[] = [
    { label: t('tagVerse'), tag: `[V${nextVerse}]` },
    { label: t('tagChorus'), tag: '[C]' },
    { label: t('tagBridge'), tag: '[B]' },
    { label: t('tagTag'), tag: '[T]' },
  ];

  const dirty =
    title !== (hymn?.title ?? '') || composer !== (hymn?.composer ?? '') || musicalKey !== (hymn?.musicalKey ?? '') || raw !== (hymn ? toTaggedLyrics(hymn.stanzas) : '');
  // Esc closes the dialog, and Ctrl+Enter saves it from anywhere in the form. Typing that would be lost asks first.
  const close = () => {
    if (!dirty || window.confirm(t('discardConfirm'))) onClose();
  };
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const labelCls = 'flex flex-col gap-1.5';
  const caption = 'flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-fg/60 uppercase';
  const required = <span className="text-danger" aria-hidden>*</span>;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" role="dialog" aria-modal="true" aria-label={hymn ? t('editHymn') : t('createHymn')} onClick={close}>
      <form ref={formRef} onSubmit={save} onClick={(e) => e.stopPropagation()} className="flex max-h-full w-full max-w-[1100px] flex-col overflow-hidden rounded-[10px] border border-fg/15 bg-panel shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <h2 className="text-2xl font-bold tracking-tight text-fg">{hymn ? t('editHymn') : t('createHymn')}</h2>
          <button type="button" onClick={close} aria-label={t('close')} className="grid size-8 place-items-center rounded-md text-fg/60 transition hover:bg-fg/10 hover:text-fg">
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            {/* The song's details. Title and song category are required. */}
            <section aria-label={t('detailsHeading')} className="flex flex-col gap-3">
              <label className={labelCls}>
                <span className={caption}>{t('fieldTitle')} {required}</span>
                <input required autoFocus maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <label className={labelCls}>
                  <span className={caption}>{t('fieldHymnal')}</span>
                  <input maxLength={80} value={composer} placeholder={t('hymnalPlaceholder')} onChange={(e) => setComposer(e.target.value)} className={field} />
                </label>
                <label className={labelCls}>
                  <span className={caption}>Musical key</span>
                  <input maxLength={12} value={musicalKey} placeholder="C, Bb, F#m" onChange={(e) => setMusicalKey(e.target.value)} className={field} />
                </label>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className={labelCls}>
                  <span className={caption}>{t('fieldCategory')}</span>
                  <select value={category} onChange={(e) => setCategory(e.target.value as HymnCategory)} className={field}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat_${c}`)}</option>)}
                  </select>
                </label>
                <label className={labelCls}>
                  <span className={caption}>{t('fieldLanguage')}</span>
                  <select value={language} onChange={(e) => setLanguage(e.target.value as HymnLanguage)} className={field}>
                    {LANGUAGES.map((l) => <option key={l} value={l}>{t(`lang_${l}`)}</option>)}
                  </select>
                </label>
                <label className={labelCls}>
                  <span className={caption}>{t('songCategoryField')} {required}</span>
                  <select
                    value={songCategory}
                    onChange={(e) => {
                      setSongCategory(e.target.value);
                      if (e.target.value) setCategoryPrompt(false);
                    }}
                    aria-invalid={categoryPrompt || undefined}
                    className={`${field} ${categoryPrompt ? '!border-danger' : ''}`}
                  >
                    <option value="">{t('songCategoryNone')}</option>
                    {songCategoryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
              </div>
              {categoryPrompt && <p role="alert" className="text-sm text-danger">{t('chooseSongCategory')}</p>}
            </section>

            {/* The lyrics: typed, pasted, or imported from a file. The tag buttons put a section marker where the cursor is. */}
            <section aria-label={t('fieldLyrics')} className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={caption}>{t('fieldLyrics')} {required}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] text-fg/50">{t('insertSection')}</span>
                  {TAGS.map(({ label, tag }) => (
                    <button key={tag} type="button" onClick={() => insertTag(tag)} title={tag} className="h-7 rounded-md border border-fg/15 bg-panel-2 px-2.5 text-[11px] font-semibold text-fg/85 transition hover:border-accent/50 hover:text-accent">
                      {label}
                    </button>
                  ))}
                  {!hymn && (
                    <>
                      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
                      <button
                        type="button"
                        onClick={importFile}
                        disabled={importing}
                        className="flex h-7 items-center gap-1.5 rounded-md border border-fg/15 bg-panel-2 px-2.5 text-[11px] font-semibold text-fg/85 transition hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Upload size={12} aria-hidden /> {importing ? t('importing') : t('importFile')}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <textarea
                value={raw}
                ref={lyricsRef}
                onPaste={pasteSheet}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={SAMPLE}
                spellCheck={false}
                aria-label={t('fieldLyrics')}
                className="min-h-[300px] flex-1 resize-y rounded-lg border border-fg/15 bg-panel-2 p-3 font-mono text-sm leading-relaxed text-fg outline-none placeholder:text-fg/35 focus:border-accent focus:ring-1 focus:ring-accent/40"
              />
              <p className="text-xs text-fg/60">{t('lyricsHelp')}</p>
              {!hymn && <p className="text-xs text-fg/50">{t('importHelp')}</p>}
              {notice && <p role="status" className="rounded-lg border border-ok/50 bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</p>}
            </section>
          </div>

          {/* What the projector will get: one card per stanza, updated as you type. */}
          <aside aria-label={t('parsedStanzas', { n: parsed.stanzas.length })} className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0 lg:max-h-[calc(100vh-14rem)] lg:self-start lg:overflow-y-auto">
            <div className={caption}>
              {t('parsedStanzas', { n: parsed.stanzas.length })}
            </div>
            {parsed.stanzas.length === 0 ? (
              <div className="grid min-h-40 place-items-center rounded-[10px] border-2 border-dashed border-fg/20 p-6 text-center text-sm text-fg/60">
                {t('parsedEmpty')}
              </div>
            ) : (
              <ol className="flex flex-col gap-2">
                {parsed.stanzas.map((s, i) => (
                  <li key={i} className="rounded-lg border border-line bg-panel-2 p-3">
                    <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider uppercase ${chipTone(s.stanzaType)}`}>{s.stanzaType}</span>
                    <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-fg/90">{s.lyricsText}</p>
                  </li>
                ))}
              </ol>
            )}
            {parsed.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-xs text-warn">
                <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden /> {w}
              </p>
            ))}
          </aside>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-6 py-4">
          <p role="alert" className="min-h-5 min-w-0 flex-1 text-sm text-danger">{error ?? blocking ?? ''}</p>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-fg/50 md:block">{t('saveHint')}</span>
            <button type="button" onClick={close} className="h-10 rounded-md border border-fg/15 bg-panel-2 px-4 text-xs font-semibold tracking-wide text-fg/85 uppercase transition hover:bg-fg/10 hover:text-fg">
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="h-10 rounded-md border border-accent bg-accent px-5 text-xs font-extrabold tracking-wider text-on-accent uppercase transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('saveHymn')}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
