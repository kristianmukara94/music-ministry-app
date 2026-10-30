import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { VERSE_ALIGNS, VERSE_FONT_MAX, VERSE_FONT_MIN, VERSE_POSITIONS, VERSE_STYLES } from '../../shared/whiteboard.js';
import { bridge } from '../live/bridge';
import type { BibleBook, Translation } from '../bible/types';
import type { WhiteboardVerse } from './types';

const api = bridge.bible;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The seven books the app's Bible holds beyond the 66 of the canon. They are left out of the list, so the book
 * dropdown reads from Genesis to Revelation.
 */
const DEUTEROCANONICAL = new Set(['TOB', 'JDT', 'WIS', 'SIR', 'BAR', '1MA', '2MA']);

const CARD = 'flex w-full max-w-2xl flex-col gap-5 rounded-xl border border-line bg-panel-2 p-6 text-fg shadow-2xl';
const FIELD = 'w-full rounded-lg border border-line bg-panel p-2.5 text-sm text-fg outline-none focus:border-accent';
const LABEL = 'flex flex-col gap-1.5 text-[11px] font-bold tracking-wider text-fg/60 uppercase';

const STYLE_LABELS: Record<string, string> = { plain: 'Plain', italic: 'Italic', boxed: 'Boxed', callout: 'Callout' };
const POSITION_LABELS: Record<string, string> = { bottom: 'Bottom', top: 'Top', center: 'Center', full: 'Full' };
const ALIGN_LABELS: Record<string, string> = { center: 'Center', left: 'Left', right: 'Right' };

/** Adds one verse, or a range of verses, from the Bible to a slide. The text is read from the app's own Bible data. */
export function AddBibleVerseModal({ onAdd, onClose }: {
  onAdd: (verse: WhiteboardVerse) => void;
  onClose: () => void;
}) {
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [translationId, setTranslationId] = useState('WEB');
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [bookNumber, setBookNumber] = useState<number | null>(null);
  const [chapterCount, setChapterCount] = useState(0);
  const [verseCount, setVerseCount] = useState(0);
  const [chapter, setChapter] = useState(1);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(1);
  const [style, setStyle] = useState<WhiteboardVerse['style']>('plain');
  const [position, setPosition] = useState<WhiteboardVerse['position']>('bottom');
  const [align, setAlign] = useState<WhiteboardVerse['align']>('center');
  const [fontSize, setFontSize] = useState(32);
  const [showReference, setShowReference] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getTranslations()
      .then((list) => {
        setTranslations(list);
        if (list.length > 0 && !list.some((t) => t.id === 'WEB')) setTranslationId(list[0].id);
      })
      .catch((err) => setError(errorText(err)));
  }, []);

  // The book list comes from the database, so it is always the books this app actually holds.
  useEffect(() => {
    let live = true;
    api
      .getBooks(translationId)
      .then((list) => {
        if (!live) return;
        const canon = list.filter((b) => !DEUTEROCANONICAL.has(b.code));
        setBooks(canon);
        setBookNumber((current) => (current !== null && canon.some((b) => b.number === current) ? current : (canon[0]?.number ?? null)));
      })
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [translationId]);

  // The chapter and verse counts come from the database, so the inputs can be checked against it.
  useEffect(() => {
    if (bookNumber === null) return;
    let live = true;
    api
      .getChapters(translationId, bookNumber)
      .then((list) => {
        if (live) setChapterCount(list.length);
      })
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [translationId, bookNumber]);

  useEffect(() => {
    if (bookNumber === null || chapter < 1) return;
    let live = true;
    api
      .getVerses(translationId, bookNumber, chapter)
      .then((list) => {
        if (live) setVerseCount(list.length);
      })
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [translationId, bookNumber, chapter]);

  const book = books.find((b) => b.number === bookNumber) ?? null;

  /** Reads the verses from the Bible, checks the range, and hands the verse to the editor. */
  const addVerse = async () => {
    setError(null);
    if (!book) return setError('Choose a book.');
    if (chapter < 1 || chapter > chapterCount) return setError(`${book.name} has ${chapterCount} chapters. Choose one from 1 to ${chapterCount}.`);
    if (start < 1 || end < start || end > verseCount) {
      return setError(`${book.name} ${chapter} has ${verseCount} verses. Set a start from 1 and an end no earlier than the start.`);
    }
    setBusy(true);
    try {
      const verses = await api.getVerses(translationId, book.number, chapter);
      const picked = verses.filter((v) => v.verse >= start && v.verse <= end);
      if (picked.length === 0) throw new Error(`${book.name} ${chapter}:${start}-${end} is not in this translation.`);
      // Several verses keep their numbers in the text, so the reader can see where each one starts.
      const several = picked.length > 1;
      const text = picked.map((v) => (several ? `${v.verse} ${v.text}` : v.text)).join(' ');
      const range = start === end ? `${start}` : `${start}-${end}`;
      onAdd({ reference: `${book.name} ${chapter}:${range}`, text, style, position, fontSize, align, showReference });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Add Bible Verse" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={CARD}>
        <header className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold tracking-tight text-fg">Add Bible Verse</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md border border-fg/20 text-fg/60 hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </header>

        {error && <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`${LABEL} sm:col-span-2`}>
            Book
            <select value={bookNumber ?? ''} onChange={(e) => { setBookNumber(Number(e.target.value)); setChapter(1); setStart(1); setEnd(1); }} className={FIELD}>
              {books.map((b) => (
                <option key={b.number} value={b.number}>{b.name}</option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Translation
            <select value={translationId} onChange={(e) => setTranslationId(e.target.value)} className={FIELD}>
              {translations.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className={LABEL}>
            Chapter
            <input type="number" min={1} max={chapterCount || undefined} value={chapter} onChange={(e) => setChapter(Number(e.target.value))} className={FIELD} />
          </label>
          <label className={LABEL}>
            Verse start
            <input type="number" min={1} max={verseCount || undefined} value={start} onChange={(e) => setStart(Number(e.target.value))} className={FIELD} />
          </label>
          <label className={LABEL}>
            Verse end
            <input type="number" min={start} max={verseCount || undefined} value={end} onChange={(e) => setEnd(Number(e.target.value))} className={FIELD} />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={LABEL}>
            Style
            <select value={style} onChange={(e) => setStyle(e.target.value as WhiteboardVerse['style'])} className={FIELD}>
              {VERSE_STYLES.map((s) => (
                <option key={s} value={s}>{STYLE_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Position
            <select value={position} onChange={(e) => setPosition(e.target.value as WhiteboardVerse['position'])} className={FIELD}>
              {VERSE_POSITIONS.map((p) => (
                <option key={p} value={p}>{POSITION_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Alignment
            <select value={align} onChange={(e) => setAlign(e.target.value as WhiteboardVerse['align'])} className={FIELD}>
              {VERSE_ALIGNS.map((a) => (
                <option key={a} value={a}>{ALIGN_LABELS[a]}</option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            <span className="flex items-center justify-between">
              Font size
              <span className="rounded-full border border-accent/30 bg-panel px-2.5 py-0.5 font-mono text-xs font-semibold text-accent normal-case tabular-nums">
                Font Size: {fontSize}px
              </span>
            </span>
            <input
              type="range"
              min={VERSE_FONT_MIN}
              max={VERSE_FONT_MAX}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer accent-accent bg-fg/10 rounded-lg"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-fg/90">
          <input type="checkbox" checked={showReference} onChange={(e) => setShowReference(e.target.checked)} className="size-4 accent-accent" />
          Show verse reference
        </label>

        <footer className="flex items-center justify-end gap-3 border-t border-line pt-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-fg/20 bg-fg/10 px-4 py-2 text-xs font-bold tracking-wider text-fg/90 uppercase hover:bg-fg/20">
            Cancel
          </button>
          <button
            type="button"
            onClick={addVerse}
            disabled={busy || !book}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-extrabold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 hover:brightness-110 disabled:opacity-40"
          >
            {busy ? 'Reading…' : 'Add Verse'}
          </button>
        </footer>
      </div>
    </div>
  );
}
