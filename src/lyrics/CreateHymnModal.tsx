import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { CATEGORIES, LANGUAGES, parseLyrics, sectionHeader, toTaggedLyrics } from '../../shared/lyrics-parser.js';
import { isMetadataLine, splitSongSheet } from '../../shared/lyrics-import.js';
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

const field = 'h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm outline-none focus:border-accent';

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
    setBusy(true);
    setError(null);
    try {
      const input = { title, composer, category, language, musicalKey, songCategory, raw };
      if (hymn) await api.editHymn(hymn.id, input);
      else await api.createHymn(input);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" role="dialog" aria-modal="true" aria-label={hymn ? t('editHymn') : t('createHymn')}>
      <form onSubmit={save} className="flex max-h-full w-full max-w-[1100px] flex-col overflow-hidden rounded-xl border border-line-strong bg-panel">
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-2xl font-black uppercase condensed">{hymn ? t('editHymn') : t('createHymn')}</h2>
          <button type="button" onClick={onClose} aria-label={t('close')} className="text-muted hover:text-fg">
            <X size={18} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto p-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">{t('fieldTitle')}</span>
              <input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">{t('fieldHymnal')}</span>
              <input maxLength={80} value={composer} placeholder={t('hymnalPlaceholder')} onChange={(e) => setComposer(e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Musical key</span>
              <input maxLength={12} value={musicalKey} placeholder="C, Bb, F#m" onChange={(e) => setMusicalKey(e.target.value)} className={field} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="eyebrow">{t('fieldCategory')}</span>
                <select value={category} onChange={(e) => setCategory(e.target.value as HymnCategory)} className={field}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat_${c}`)}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="eyebrow">{t('fieldLanguage')}</span>
                <select value={language} onChange={(e) => setLanguage(e.target.value as HymnLanguage)} className={field}>
                  {LANGUAGES.map((l) => <option key={l} value={l}>{t(`lang_${l}`)}</option>)}
                </select>
              </label>
            </div>

            {!hymn && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={importFile}
                  disabled={importing}
                  className="h-10 self-start rounded-md border border-line-strong px-4 text-xs font-bold uppercase hover:bg-panel-2 disabled:opacity-40"
                >
                  {importing ? t('importing') : t('importFile')}
                </button>
                <p className="text-xs text-faint">{t('importHelp')}</p>
              </div>
            )}
            {notice && <p role="status" className="text-sm text-ok">{notice}</p>}
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">{t('songCategoryField')}</span>
              <select value={songCategory} onChange={(e) => setSongCategory(e.target.value)} className={field}>
                <option value="">{t('songCategoryNone')}</option>
                {songCategoryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>

            <label className="flex min-h-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">{t('fieldLyrics')}</span>
              <textarea
                value={raw}
                ref={lyricsRef}
                onPaste={pasteSheet}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={SAMPLE}
                spellCheck={false}
                className="min-h-[260px] flex-1 resize-y rounded-md border border-line-strong bg-canvas p-3 font-mono text-sm leading-relaxed outline-none focus:border-accent"
              />
            </label>
            <p className="text-xs text-faint">{t('lyricsHelp')}</p>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="eyebrow">{t('parsedStanzas', { n: parsed.stanzas.length })}</div>
            <ol className="flex flex-col gap-2">
              {parsed.stanzas.map((s, i) => (
                <li key={i} className="rounded-md border border-line p-3">
                  <div className="font-mono text-[11px] font-bold tracking-wider text-accent uppercase">{s.stanzaType}</div>
                  <p className="mt-1 text-sm whitespace-pre-line">{s.lyricsText}</p>
                </li>
              ))}
            </ol>
            {parsed.warnings.map((w) => (
              <p key={w} className="text-xs text-amber">{w}</p>
            ))}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-line px-6 py-4">
          <p role="alert" className="min-h-5 text-sm text-danger">{error ?? blocking ?? ''}</p>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-10 rounded-md px-4 text-xs font-bold uppercase text-muted hover:text-fg">
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="h-10 rounded-md bg-accent px-5 text-[13px] font-extrabold uppercase condensed text-on-accent hover:brightness-105 disabled:opacity-40"
            >
              {t('saveHymn')}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
