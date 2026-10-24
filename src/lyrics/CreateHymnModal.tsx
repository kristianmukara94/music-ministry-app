import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { CATEGORIES, LANGUAGES, parseLyrics, toTaggedLyrics } from '../../shared/lyrics-parser.js';
import { bridge } from '../live/bridge';
import { useLyT } from './strings';
import type { Hymn, HymnCategory, HymnLanguage } from './types';

const api = bridge.lyrics;

const SAMPLE = `[V1]
Ang Panginoon ang aking pastol
Hindi ako magkukulang

[C]
Aleluya, aleluya

[V2]
Sa sariwang pastulan`;

const field = 'h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm outline-none focus:border-accent';

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
  const [raw, setRaw] = useState(hymn ? toTaggedLyrics(hymn.stanzas) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseLyrics(raw);
  const blocking = raw.trim() ? parsed.errors[0] : undefined;
  const canSave = !busy && title.trim().length > 0 && !blocking && parsed.stanzas.length > 0;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = { title, composer, category, language, musicalKey, raw };
      if (hymn) await api.editHymn(hymn.id, input);
      else await api.createHymn(input);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

            <label className="flex min-h-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">{t('fieldLyrics')}</span>
              <textarea
                value={raw}
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
