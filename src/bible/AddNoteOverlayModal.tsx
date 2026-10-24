import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, Info, Pencil, Presentation, X } from 'lucide-react';
import type { NoteOverlay } from '../../shared/live.js';
import { dispatch } from '../live/store';
import { NOTE_DARK, NOTE_GOLD, NOTE_WHITE, NoteCallout } from '../output/NoteCallout';

const PREFIX_MAX = 50;
const MESSAGE_MAX = 200;

const PILL = 'flex h-9 shrink-0 items-center gap-2 rounded-md px-4 text-xs font-bold uppercase transition disabled:cursor-not-allowed disabled:opacity-40';
const FIELD = 'w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 outline-none focus:border-amber-400';

const TEXT_SWATCHES = [
  { label: 'White', hex: NOTE_WHITE },
  { label: 'Gold', hex: NOTE_GOLD },
  { label: 'Dark', hex: NOTE_DARK },
];

/**
 * Sends a short message to the projector as a callout, for example "Write this down" or "Important!".
 * The verse's words can be clicked into the message, so the note can quote the text being preached on.
 */
export function AddNoteOverlayModal({ reference, verseText, onClose }: {
  /** For example "2 Kings 1:2". */
  reference: string;
  /** The text of the selected verses, tokenised into word pills. */
  verseText: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [prefixOn, setPrefixOn] = useState(true);
  const [prefix, setPrefix] = useState('NOTE');
  const [textColor, setTextColor] = useState(NOTE_WHITE);
  const [accent, setAccent] = useState(NOTE_GOLD);
  const [colorsOpen, setColorsOpen] = useState(false);

  const words = useMemo(() => verseText.split(/\s+/).filter(Boolean), [verseText]);

  const value: NoteOverlay = {
    text: message.trim(),
    prefix: prefixOn && prefix.trim() ? prefix.trim() : null,
    textColor,
    accent,
    citation: reference,
  };
  // What the screen will show when the placeholder text is empty, so the preview is never blank.
  const previewText = value.text || 'Your message here';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Appends a word to the message, with a space between words. */
  const addWord = (word: string) => setMessage((current) => (current ? `${current} ${word}` : word).slice(0, MESSAGE_MAX));

  const clearNote = () => setMessage('');

  const send = () => {
    if (!value.text) return;
    dispatch({ type: 'noteOverlay/show', value: { ...value, text: value.text } });
    onClose();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Add note overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-xl border border-stone-700 bg-stone-950 p-6 shadow-2xl"
      >
        {/* Header: icon, title, close, and the verse it is for. */}
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md border border-amber-400/40 bg-amber-400/10 text-amber-300">
              <Pencil size={16} aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-widest text-stone-100 uppercase">Add note overlay</h2>
              <p className="mt-0.5 text-sm text-stone-400">For: {reference}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-md border border-stone-700 text-stone-400 hover:text-stone-100">
            <X size={16} aria-hidden />
          </button>
        </header>

        {/* The verse's words, each one a pill. Clicking a pill adds that word to the message. */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-stone-200">
            <BookOpen size={15} className="text-amber-300" aria-hidden /> {reference}
          </div>
          <p className="text-xs text-stone-400">Click words to add them to your note:</p>
          <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-stone-800 bg-stone-900/60 p-3">
            {words.map((word, i) => (
              <button
                key={`${i}:${word}`}
                type="button"
                onClick={() => addWord(word)}
                className="rounded-full border border-stone-700 bg-stone-800 px-2.5 py-1 font-serif text-sm text-stone-200 transition hover:border-amber-400/60 hover:text-amber-200"
              >
                {word}
              </button>
            ))}
          </div>
        </section>

        {/* The message, the prefix, and the live preview. */}
        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-bold tracking-wider text-stone-400 uppercase">
            Message
            <textarea
              rows={3}
              value={message}
              maxLength={MESSAGE_MAX}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type or click words above"
              className={`${FIELD} resize-none normal-case`}
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={prefixOn}
              onClick={() => setPrefixOn((on) => !on)}
              className="flex items-center gap-2 text-xs font-bold tracking-wider text-stone-300 uppercase"
            >
              <span className={`relative h-5 w-9 rounded-full border transition ${prefixOn ? 'border-lime-300 bg-lime-400' : 'border-stone-600 bg-stone-900'}`}>
                <span className={`absolute top-0.5 size-3.5 rounded-full transition-all ${prefixOn ? 'left-[18px] bg-stone-950' : 'left-0.5 bg-stone-400'}`} aria-hidden />
              </span>
              Custom Prefix
            </button>
            <input
              value={prefix}
              maxLength={PREFIX_MAX}
              disabled={!prefixOn}
              onChange={(e) => setPrefix(e.target.value)}
              aria-label="Prefix"
              className="h-9 w-40 rounded-md border border-stone-700 bg-stone-900 px-3 font-mono text-sm font-bold text-stone-100 uppercase outline-none focus:border-amber-400 disabled:opacity-40"
            />
            <span className="font-mono text-xs text-stone-400 tabular-nums">
              {prefix.length}/{PREFIX_MAX}
            </span>
          </div>

          <div className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 font-mono text-sm text-stone-300">
            Preview: {prefixOn && prefix.trim() ? `${prefix.trim()}: ` : ''}{previewText}
          </div>
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-stone-800 bg-black [container-type:inline-size]">
            <div className="absolute inset-x-0 bottom-[6cqh] flex justify-center">
              <NoteCallout value={{ ...value, text: previewText }} />
            </div>
          </div>
        </section>

        {/* Collapsible colour bar: the text colour and the accent bar. */}
        <section className="rounded-lg border border-stone-800 bg-stone-900/60">
          <button
            type="button"
            onClick={() => setColorsOpen((open) => !open)}
            aria-expanded={colorsOpen}
            className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-bold tracking-wider text-stone-300 uppercase"
          >
            Custom Colors
            {colorsOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          </button>
          {colorsOpen && (
            <div className="grid gap-3 border-t border-stone-800 px-4 py-3 sm:grid-cols-2">
              {([
                ['Text', textColor, setTextColor],
                ['Border accent', accent, setAccent],
              ] as const).map(([label, current, set]) => (
                <div key={label} className="flex flex-col gap-2">
                  <span className="text-xs font-bold tracking-wider text-stone-400 uppercase">{label}</span>
                  <div className="flex gap-2">
                    {TEXT_SWATCHES.map((swatch) => (
                      <button
                        key={swatch.hex}
                        type="button"
                        aria-label={`${label} ${swatch.label}`}
                        aria-pressed={current === swatch.hex}
                        onClick={() => set(swatch.hex)}
                        className={`size-7 rounded-full border-2 ${current === swatch.hex ? 'border-amber-300' : 'border-stone-600'}`}
                        style={{ backgroundColor: swatch.hex }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* The tip, for the preacher. */}
        <aside className="flex gap-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-100/90">
          <Info size={15} className="mt-0.5 shrink-0 text-amber-300" aria-hidden />
          <p>
            <span className="font-bold text-amber-200">Tip:</span> Use this to display notes like &apos;Write this down&apos;, &apos;Important!&apos;, or key takeaways during your sermon.
          </p>
        </aside>

        {/* Actions, bottom right. */}
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-800 pt-4">
          <button type="button" onClick={clearNote} className={`${PILL} border border-red-500 text-red-400 hover:bg-red-500/10`}>
            Clear note
          </button>
          <button type="button" onClick={onClose} className={`${PILL} border border-stone-600 text-stone-300 hover:border-stone-400`}>
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!value.text}
            className={`${PILL} bg-amber-400 font-extrabold text-stone-950 shadow-md hover:bg-amber-300`}
          >
            <Presentation size={14} aria-hidden /> Send note
          </button>
        </footer>
      </div>
    </div>
  );
}
