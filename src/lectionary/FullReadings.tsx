import { useMemo, useState } from 'react';
import { Check, ListPlus, Pencil, Play, Zap } from 'lucide-react';
import { addReadingToQueue, applyAllReadings, goLiveReading, resolveReadings, type ResolvedReading } from '../services/lectionaryService';
import { SLOT_KEY, useLectT, type LectT } from './strings';
import type { LectionaryDay, ReadingType } from './types';
import { hasResponse } from '../../shared/daily-readings.js';
import { LECT_LANGS, lectT } from '../../shared/lectionary-i18n.js';
import type { ResolvedScripture } from '../services/citationResolver';

/** The reader's endings in every language. Text fetched from the Bible already ends with one, so the card does not show it twice. */
const ENDINGS = new Set(LECT_LANGS.flatMap((lang) => [lectT(lang, 'endingWord'), lectT(lang, 'endingGospel')]));
const endsWithEnding = (slides: string[]) => ENDINGS.has(slides.at(-1)?.trim().split('\n').at(-1)?.trim() ?? '');

const ICON: Record<ReadingType, string> = {
  'First Reading': '📖',
  'Responsorial Psalm': '🎵',
  'Second Reading': '📖',
  'Gospel Acclamation': '🎺',
  Gospel: '✝️',
  'Prayer of the Faithful': '🤲',
};

const CARD = 'rounded-[10px] border border-line bg-panel';
const button =
  'flex h-9 items-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-3 text-xs font-semibold tracking-wide text-fg/85 uppercase transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Props {
  date: string;
  /** The date as the operator reads it, for messages. */
  dateLabel: string;
  /** The day as loaded for `date`. Cards show what is saved, not what is being typed in the editor. */
  day: LectionaryDay | null;
  /** The part with unsaved edits in the editor, which its card says. */
  unsavedSlot: ReadingType | null;
  onEdit: (readingType: ReadingType) => void;
  /** Bible text fetched for parts with a citation and nothing saved. Shown on their cards, and saved by ⚡ Apply All. */
  drafts?: Partial<Record<ReadingType, ResolvedScripture>>;
  /** The translation the drafts come from, for their cards. */
  draftSource?: string;
  onSaveDrafts?: () => Promise<void>;
}

/**
 * The day's six parts in full, as cards: each reading's text slide by slide with its ending, the psalm and prayers with their response pinned
 * above, and a way to take each one live or into the Service Queue. ⚡ Apply All puts them all into the Holy Mass plan for the date.
 */
export function FullReadings({ date, dateLabel, day, unsavedSlot, onEdit, drafts = {}, draftSource = '', onSaveDrafts }: Props) {
  const t = useLectT();
  const name = (type: string) => t(SLOT_KEY[type as ReadingType] ?? type);
  const resolved = useMemo(() => (day && day.date === date ? resolveReadings(day) : null), [day, date]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const savedCount = resolved?.readings.filter((r) => r.saved).length ?? 0;
  const draftCount = resolved?.readings.filter((r) => !r.saved && drafts[r.readingType]).length ?? 0;

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await work();
      if (text) setMessage({ tone: 'ok', text });
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const applyAll = () =>
    run(async () => {
      await onSaveDrafts?.();
      const out = await applyAllReadings(date, (labels) => window.confirm(t('applyAllReplace', { parts: labels.join(', ') })));
      if (out.status === 'noPlan') throw new Error(t('applyAllNoPlan', { date: dateLabel }));
      return [
        t('applyAllDone', { plan: out.planName, parts: out.placed.map(name).join(', ') }),
        out.kept.length > 0 && t('applyAllKept', { parts: out.kept.join(', ') }),
        out.missing.length > 0 && t('applyAllMissing', { parts: out.missing.map(name).join(', ') }),
      ].filter(Boolean).join(' ');
    });

  const goLive = (reading: ResolvedReading) =>
    run(async () => {
      if (!(await goLiveReading(date, reading.readingType))) throw new Error(t('notSavedYet'));
      return null;
    });

  const queue = (reading: ResolvedReading) =>
    run(async () => {
      const slot = name(reading.readingType);
      let out = await addReadingToQueue(date, reading.readingType);
      if (out.status === 'occupied') {
        if (!window.confirm(t('replaceInQueue', { slot, label: out.label }))) return null;
        out = await addReadingToQueue(date, reading.readingType, { replace: true });
      }
      return t(out.status === 'already' ? 'alreadyInQueue' : 'addedToQueue', { slot });
    });

  return (
    <section aria-labelledby="full-readings" className={`${CARD} flex flex-col gap-4 p-5`}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 id="full-readings" className="text-2xl font-bold tracking-tight text-fg">{t('fullReadingsHeading')}</h2>
          <p className="mt-0.5 text-sm text-fg/70">{t('fullReadingsHint', { date: dateLabel })}</p>
        </div>
        <button
          type="button"
          onClick={() => void applyAll()}
          disabled={busy || savedCount + draftCount === 0}
          title={savedCount + draftCount === 0 ? t('applyAllNothing', { date: dateLabel }) : t('applyAllTip')}
          className="flex h-10 items-center gap-2 rounded-md border border-accent bg-accent px-5 text-xs font-extrabold tracking-wider text-on-accent uppercase shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Zap size={14} fill="currentColor" aria-hidden /> {t('applyAll')}
        </button>
      </div>

      {message && (
        <div
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 rounded-lg border px-4 py-2 text-sm ${message.tone === 'error' ? 'border-danger/50 bg-danger/10 text-danger' : 'border-ok/50 bg-ok/10 text-ok'}`}
        >
          {message.tone === 'ok' && <Check size={16} className="mt-0.5 shrink-0" aria-hidden />}
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {resolved?.readings.map((reading) => (
          <ReadingCard
            key={reading.readingType}
            reading={reading}
            draft={reading.saved ? undefined : drafts[reading.readingType]}
            draftSource={draftSource}
            t={t}
            busy={busy}
            unsaved={unsavedSlot === reading.readingType}
            onEdit={() => onEdit(reading.readingType)}
            onGoLive={() => void goLive(reading)}
            onQueue={() => void queue(reading)}
          />
        ))}
      </div>
    </section>
  );
}

function ReadingCard({ reading, draft, draftSource, t, busy, unsaved, onEdit, onGoLive, onQueue }: {
  reading: ResolvedReading;
  draft?: ResolvedScripture;
  draftSource: string;
  t: LectT;
  busy: boolean;
  unsaved: boolean;
  onEdit: () => void;
  onGoLive: () => void;
  onQueue: () => void;
}) {
  const { readingType, citation, congregationResponse, saved, ending, forMass } = reading;
  const slides = draft ? draft.slides : reading.slides;
  const shown = saved || Boolean(draft);
  return (
    <article aria-label={t(SLOT_KEY[readingType])} className={`flex min-w-0 flex-col gap-3 rounded-lg border p-4 ${saved ? 'border-line bg-fg/[0.03]' : draft ? 'border-dashed border-accent/40 bg-accent/[0.03]' : 'border-dashed border-fg/20'}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="text-lg leading-none">{ICON[readingType]}</span>
        <h3 className="text-base font-bold text-fg">{t(SLOT_KEY[readingType])}</h3>
        {(citation || draft?.citation) && <span className="truncate text-sm text-fg/70">{citation || draft?.citation}</span>}
        <span className="ml-auto flex items-center gap-2">
          {draft && !unsaved && <span className="rounded-full border border-accent/60 bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">{t('fromBible')}</span>}
          {unsaved && <span className="rounded-full border border-warn/60 bg-warn/15 px-2 py-0.5 text-[10px] font-bold text-warn">{t('editorAhead')}</span>}
          {slides.length > 0 && (
            <span className="font-mono text-xs text-fg/60 tabular-nums">{slides.length === 1 ? t('slideOne') : t('slideMany', { n: slides.length })}</span>
          )}
        </span>
      </header>

      {shown ? (
        <>
          {draft && <p className="text-xs text-accent">{t('fromBibleCard', { translation: draftSource })}</p>}
          {hasResponse(readingType) && congregationResponse && (
            <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-semibold text-accent">℟ {congregationResponse}</p>
          )}
          {/* The text as it plays: one block per slide, numbered like Mass Live's jump chips. */}
          <ol className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
            {slides.map((slide, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-0.5 h-fit shrink-0 rounded border border-fg/15 bg-panel-2 px-1.5 font-mono text-[10px] font-bold text-fg/60 tabular-nums">{i + 1}</span>
                <p className="font-serif text-[15px] leading-relaxed whitespace-pre-line text-fg/90">{slide}</p>
              </li>
            ))}
          </ol>
          {ending && !endsWithEnding(slides) && <p className="text-sm font-semibold text-fg/75 italic">{t(ending === 'gospel' ? 'endingGospel' : 'endingWord')}</p>}
        </>
      ) : (
        <p className="text-sm text-fg/55">{readingType === 'Second Reading' ? `${t('optional')}. ` : ''}{t('notSavedYet')}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="button" onClick={onEdit} className={button}>
          <Pencil size={14} aria-hidden /> {t('editPart')}
        </button>
        <button
          type="button"
          onClick={onQueue}
          disabled={busy || !saved || !forMass}
          title={forMass ? t('addToQueueTip') : t('acclamationNotForMass')}
          className={`${button} ml-auto`}
        >
          <ListPlus size={14} aria-hidden /> {t('addToQueue')}
        </button>
        <button
          type="button"
          onClick={onGoLive}
          disabled={busy || !saved}
          title={t('goLiveNowTip')}
          className="flex h-9 items-center gap-2 rounded-md border border-ok bg-ok px-3 text-xs font-extrabold tracking-wider text-canvas uppercase transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={14} fill="currentColor" aria-hidden /> {t('goLiveNow')}
        </button>
      </div>
    </article>
  );
}
