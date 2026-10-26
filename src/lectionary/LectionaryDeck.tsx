import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Play, Save, Scissors, Sparkles, Trash2 } from 'lucide-react';
import { bridge } from '../live/bridge';
import { dispatch } from '../live/store';
import { setUi, useUi } from '../state/ui';
import { useAnnT } from '../announcements/strings';
import { SlidePreview } from '../announcements/TextSlideModal';
import { ColorField, StyleToolbar } from '../announcements/StyleControls';
import { BACKGROUND_COLORS, sanitizeTextStyle } from '../../shared/text-style.js';
import type { TextStyle } from '../../shared/text-style';
import { fontCss } from '../../shared/text-style.js';
import { autoPaginateText, BREAK, pagesOf, withFitter } from '../announcements/paginate';
import { useLectT, type LectT } from './strings';
import { READING_TYPES, type LectionaryDay, type ReadingType } from './types';

const api = bridge.lectionary;
const PSALM: ReadingType = 'Responsorial Psalm';
const SLOT_KEY: Record<ReadingType, string> = {
  'First Reading': 'slot_first',
  'Responsorial Psalm': 'slot_psalm',
  'Second Reading': 'slot_second',
  'Gospel Acclamation': 'slot_acclamation',
  Gospel: 'slot_gospel',
};
const DATE_LOCALE = { en: 'en-PH', tl: 'fil-PH', ceb: 'en-PH' } as const;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Local calendar date as YYYY-MM-DD. */
const isoOf = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const parseIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (iso: string, n: number) => {
  const d = parseIso(iso);
  return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
/** Today if it is a Sunday, otherwise the coming Sunday: the reading set the operator usually prepares. */
const upcomingSunday = () => {
  const today = new Date();
  return isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((7 - today.getDay()) % 7)));
};

const input = 'h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm outline-none focus:border-accent';
const button =
  'flex h-9 items-center gap-2 rounded-md border border-line-strong px-3 text-xs font-bold uppercase hover:bg-panel-2 disabled:opacity-40';

export function LectionaryDeck() {
  const t = useLectT();
  const tAnn = useAnnT();
  const lang = useUi((s) => s.lang);
  const [date, setDate] = useState(upcomingSunday);
  const [day, setDay] = useState<LectionaryDay | null>(null);
  const [dayLabel, setDayLabel] = useState('');
  const [slot, setSlot] = useState<ReadingType>('First Reading');
  const [citation, setCitation] = useState('');
  const [response, setResponse] = useState('');
  const [master, setMaster] = useState('');
  const [dirty, setDirty] = useState(false);
  // How this reading is set on the projector. Saved with the reading and used for every page of it.
  const [readingStyle, setReadingStyle] = useState<TextStyle>({});
  const checked = sanitizeTextStyle(readingStyle);
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);

  const isPsalm = slot === PSALM;
  const pages = pagesOf(master);
  const current = Math.min(pageIndex, Math.max(pages.length - 1, 0));
  const fail = (err: unknown) => setError(errorText(err));

  const reloadDay = () => api.getDay(date).then(setDay).catch(fail);

  // A Service Queue request to open one reading: show its date and slot. The loaders below fill the editor.
  useEffect(() => {
    const pending = useUi.getState().pendingFocus;
    if (pending?.kind !== 'reading') return;
    setUi({ pendingFocus: null });
    setDate(pending.date);
    setSlot(pending.readingType as ReadingType);
  }, []);

  // Date change: load the day's slots and its label.
  useEffect(() => {
    setNotice(null);
    api.getDay(date).then((loaded) => {
      setDay(loaded);
      setDayLabel(loaded.seasonInfo);
    }).catch(fail);
  }, [date]);

  // Slot change (or a reload after saving): fill the editor from the stored row.
  useEffect(() => {
    const row = day?.readings.find((r) => r.readingType === slot);
    setCitation(row?.citation ?? '');
    setResponse(row?.congregationResponse ?? '');
    setMaster(row?.rawText ?? '');
    setReadingStyle(row?.style ?? {});
    setDirty(false);
    setPageIndex(0);
  }, [day, slot]);

  /** Guards against silently discarding typed text when moving to another date or slot. */
  const confirmDiscard = () => !dirty || window.confirm(t('discardConfirm'));
  const changeDate = (next: string) => {
    if (confirmDiscard()) setDate(next);
  };
  const changeSlot = (next: ReadingType) => {
    if (next !== slot && confirmDiscard()) setSlot(next);
  };

  const edit = (apply: () => void) => {
    apply();
    setDirty(true);
    setNotice(null);
  };

  const autoPaginate = () => {
    if (!master.trim()) return;
    // The psalm verses sit below the pinned response, so they get less height.
    // Readings and psalms are set in serif on the projector, so they are measured in serif too.
    edit(() => setMaster(withFitter((fits) => autoPaginateText(master, fits), isPsalm ? 0.6 : 0.8, 'serif')));
  };

  /** Inserts a manual break where the cursor sits. */
  const insertBreak = () => {
    const el = editor.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const before = master.slice(0, start).replace(/\s+$/, '');
    const after = master.slice(end).replace(/^\s+/, '');
    edit(() => setMaster(`${before}\n${BREAK}\n${after}`));
  };

  /** Removes the break before page `index`, joining it onto the previous page. */
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveReading({
        date,
        readingType: slot,
        seasonInfo: dayLabel,
        citation,
        congregationResponse: isPsalm ? response : '',
        rawText: master,
        style: checked,
      });
      setDirty(false);
      setNotice(t('savedNotice'));
      await reloadDay();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const clearSlot = async () => {
    if (!window.confirm(t('clearConfirm', { slot: t(SLOT_KEY[slot] as Parameters<LectT>[0]) }))) return;
    setBusy(true);
    try {
      await api.clearReading(date, slot);
      await reloadDay();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  /** Applies the day label to every saved slot for this date. */
  const saveDayLabel = async () => {
    if (!day || dayLabel === day.seasonInfo) return;
    try {
      await api.setSeasonInfo(date, dayLabel);
      await reloadDay();
    } catch (err) {
      fail(err);
    }
  };

  /**
   * Saves what is on screen, then stages every page for the projector. Nothing reaches the screen until
   * TAKE LIVE (or Enter). PgDn / PgUp step through the pages once live.
   */
  const stageReading = async () => {
    setError(null);
    if (pages.length === 0) return setError(t('pasteFirst'));
    if (isPsalm && !response.trim()) return setError(t('responseFirst'));

    await save();
    const title = [dayLabel, t(SLOT_KEY[slot] as Parameters<LectT>[0]), citation].map((s) => s.trim()).filter(Boolean).join(' · ');
    if (isPsalm) {
      dispatch({ type: 'projector/stage', frame: { kind: 'psalm', title, response: response.trim(), pages, index: 0, style: checked } });
    } else {
      // Blank lines stay in as empty reader lines, so the projector keeps the paragraph spacing.
      const slides = pages.map((page) => page.split('\n').map((text) => ({ role: 'reader' as const, text })));
      dispatch({ type: 'projector/stage', frame: { kind: 'deck', title, slides, index: 0, style: checked } });
    }
  };

  /** Sends the staged reading to the projector and the mirror. */
  const takeLive = () => dispatch({ type: 'projector/take' });

  // Enter takes the staged reading live. Enter inside the editor or a field still types or submits as usual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      takeLive();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dateLabel = parseIso(date).toLocaleDateString(DATE_LOCALE[lang], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="flex min-h-[calc(100vh-88px)] flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
        <div>
          <div className="eyebrow text-fg">{t('eyebrow')}</div>
          <h1 className="mt-1 text-[56px] leading-none font-black uppercase condensed">{t('title')}</h1>
          <p className="mt-2 text-[15px] text-muted">{t('subtitle')}</p>
        </div>
      </header>

      {error && (
        <div role="alert" className="border-b border-crimson/40 bg-crimson/10 px-6 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* ── Left: calendar and slots ── */}
        <section className="flex flex-col gap-4 border-r border-line p-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="lect-date" className="eyebrow">{t('dateHeading')}</label>
            <input id="lect-date" type="date" value={date} onChange={(e) => changeDate(e.target.value)} className={input} />
            <p className="text-sm text-muted">{dateLabel}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => changeDate(addDays(date, -1))} className={button}>
                <ChevronLeft size={14} aria-hidden /> {t('previousDay')}
              </button>
              <button type="button" onClick={() => changeDate(addDays(date, 1))} className={button}>
                {t('nextDay')} <ChevronRight size={14} aria-hidden />
              </button>
            </div>
            <button type="button" onClick={() => changeDate(upcomingSunday())} className={`${button} w-fit`}>
              {t('upcomingSunday')}
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="lect-label" className="eyebrow">{t('labelHeading')}</label>
            <input
              id="lect-label"
              value={dayLabel}
              maxLength={160}
              placeholder={t('labelPlaceholder')}
              onChange={(e) => setDayLabel(e.target.value)}
              onBlur={() => void saveDayLabel()}
              className={input}
            />
          </div>

          <nav aria-label={t('readingsHeading')} className="flex flex-col gap-2">
            <span className="eyebrow">{t('readingsHeading')}</span>
            {READING_TYPES.map((type) => {
              const row = day?.readings.find((r) => r.readingType === type);
              const filled = Boolean(row?.rawText);
              const active = slot === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => changeSlot(type)}
                  aria-current={active}
                  className={`flex flex-col gap-0.5 rounded-lg border-l-2 px-3 py-2.5 text-left transition ${
                    active ? 'border-accent bg-panel-2' : 'border-transparent hover:bg-panel-2'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {t(SLOT_KEY[type] as Parameters<LectT>[0])}
                    <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${filled ? 'bg-accent text-on-accent' : 'border border-line-strong text-muted'}`}>
                      {filled ? t('saved') : t('empty')}
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted">
                    {row?.citation || (type === 'Second Reading' ? t('optional') : ' ')}
                  </span>
                </button>
              );
            })}
          </nav>
        </section>

        {/* ── Right: editor and cue ── */}
        <section className="flex min-w-0 flex-col gap-4 p-5">
          <div className="flex items-center gap-2">
            <BookOpen size={16} aria-hidden />
            <h2 className="text-2xl font-black uppercase condensed">{t(SLOT_KEY[slot] as Parameters<LectT>[0])}</h2>
            <span className="ml-auto text-xs text-muted">{dirty ? t('unsaved') : notice ?? ''}</span>
          </div>

          {isPsalm && (
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">{t('responseLabel')}</span>
              <input
                value={response}
                maxLength={160}
                placeholder={t('responsePlaceholder')}
                onChange={(e) => edit(() => setResponse(e.target.value))}
                className="h-11 rounded-md border border-line-strong bg-canvas px-3 text-[15px] font-semibold text-gold outline-none focus:border-accent"
              />
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">{t('citation')}</span>
            <input
              value={citation}
              maxLength={160}
              placeholder={isPsalm ? t('citationPsalmPlaceholder') : t('citationReadingPlaceholder')}
              onChange={(e) => edit(() => setCitation(e.target.value))}
              className={input}
            />
          </label>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 2xl:grid-cols-2">
            <div className="flex min-h-0 flex-col gap-3">
              <div className="flex flex-col gap-2">
                <StyleToolbar style={readingStyle} onChange={(patch) => edit(() => setReadingStyle((s) => ({ ...s, ...patch })))} />
                <ColorField
                  label="Background colour"
                  prefix="Background"
                  value={readingStyle.bgColor}
                  presets={BACKGROUND_COLORS}
                  onChange={(hex) => edit(() => setReadingStyle((s) => ({ ...s, bgColor: hex })))}
                  clearLabel="No colour"
                />
              </div>
              <label htmlFor="lect-text" className="eyebrow">{isPsalm ? t('versesLabel') : t('readingLabel')}</label>
              <textarea
                id="lect-text"
                ref={editor}
                value={master}
                onChange={(e) => edit(() => setMaster(e.target.value))}
                rows={14}
                spellCheck={false}
                placeholder={isPsalm ? t('versesPlaceholder') : t('readingPlaceholder')}
                className="min-h-[240px] flex-1 resize-y rounded-md border border-line-strong bg-canvas p-3 font-mono text-sm leading-relaxed outline-none focus:border-accent"
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={autoPaginate} disabled={!master.trim()} className={button}>
                  <Sparkles size={14} aria-hidden /> {t('autoPaginate')}
                </button>
                <button type="button" onClick={insertBreak} disabled={!master.trim()} className={button}>
                  <Scissors size={14} aria-hidden /> {t('breakAtCursor')}
                </button>
              </div>

            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <span className="eyebrow">{t('preview')}</span>
              {isPsalm ? (
                <PsalmPreview response={response} text={pages[current] ?? ''} style={checked} />
              ) : (
                <SlidePreview text={pages[current] ?? ''} bgSrc={null} style={checked} className="aspect-video w-full rounded-lg border border-line-strong" />
              )}
              {pages.length > 1 && (
                <div className="flex items-center justify-between text-sm">
                  <button type="button" onClick={() => setPageIndex(Math.max(current - 1, 0))} disabled={current === 0} className={button}>
                    <ChevronLeft size={14} aria-hidden /> {t('previous')}
                  </button>
                  <span className="font-mono text-xs text-muted">{current + 1} / {pages.length}</span>
                  <button type="button" onClick={() => setPageIndex(Math.min(current + 1, pages.length - 1))} disabled={current >= pages.length - 1} className={button}>
                    {t('next')} <ChevronRight size={14} aria-hidden />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            <button type="button" onClick={clearSlot} disabled={busy || !day?.readings.find((r) => r.readingType === slot)?.rawText} className={`${button} mr-auto text-danger`}>
              <Trash2 size={14} aria-hidden /> {t('clearSlot')}
            </button>
            <button type="button" onClick={save} disabled={busy || !dirty} className={button}>
              <Save size={14} aria-hidden /> {t('save')}
            </button>
            <button
              type="button"
              onClick={stageReading}
              disabled={busy || pages.length === 0}
              className="h-10 rounded-md border border-line-strong px-5 text-[13px] font-extrabold uppercase condensed hover:bg-panel-2 disabled:opacity-40"
            >
              {t('stage')}
            </button>
            <button
              type="button"
              onClick={takeLive}
              disabled={busy}
              className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-bold tracking-wider text-white uppercase shadow-md transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={14} fill="currentColor" aria-hidden /> {tAnn('play')}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Psalm preview: the response is pinned in gold above the verses, as on the projector. */
function PsalmPreview({ response, text, style = null }: { response: string; text: string; style?: TextStyle | null }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line-strong bg-black" style={{ containerType: 'inline-size', backgroundColor: style?.bgColor }}>
      <div className="absolute inset-x-0 top-[6%] px-[6%] text-center">
        <p className="font-extrabold text-gold" style={{ fontSize: '3.6cqw' }}>
          ℟ {response || '…'}
        </p>
      </div>
      <div className="absolute inset-x-[7%] top-[34%] bottom-[4%] flex items-center justify-center">
        <p className="whitespace-pre-line text-center leading-[1.22] font-medium text-white" style={{ fontSize: '4.1cqw', color: style?.textColor, fontFamily: fontCss(style), textAlign: style?.textAlign }}>
          {text}
        </p>
      </div>
    </div>
  );
}
