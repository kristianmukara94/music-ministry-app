import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Cross, Music, X } from 'lucide-react';
import {
  sectionChip,
  sectionOrder,
  segmentStatus,
  slidesFor,
  type PwCues,
  type PwSegment,
  type PwSlide,
} from '../../shared/pw.js';
import { setUi } from '../state/ui';
import type { Hymn } from '../lyrics/types';
import type { ReadingType } from '../lectionary/types';
import { pad2, STATUS_TONE } from './LineupRail';
import { CurrentNextPreview } from './CurrentNextPreview';
import { ShowAllVerses } from '../components/ShowAllVerses';
import { useLive } from '../live/store';
import { useUi } from '../state/ui';
import { SlideThumb } from './SlideThumb';
import { livePosition, visibleSlideIndexes } from '../../shared/pw.js';
import { resolvedFor, setPwState, updateSegment, usePw } from './store';
import { usePwT } from './strings';

const CUE_KEYS: (keyof PwCues)[] = ['lowerThird', 'titleFirst', 'fadeOut'];
const CUE_LABEL: Record<keyof PwCues, string> = { lowerThird: 'cue_lowerThird', titleFirst: 'cue_titleFirst', fadeOut: 'cue_fadeOut' };

const BTN = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-semibold transition hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40';
const BTN_ACCENT = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-on-accent transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';
const FIELD = 'w-full bg-transparent font-semibold outline-none placeholder:font-normal placeholder:text-muted';

/** Focuses the library search, for Replace and the empty states. */
const focusLibrary = () => document.getElementById('pw-library-search')?.focus();

function Tile({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[72px] flex-col justify-center gap-1 rounded-xl border border-line bg-canvas/40 px-4 py-2.5 focus-within:border-accent">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-xs text-muted">{label}</label>
      ) : (
        <span className="text-xs text-muted">{label}</span>
      )}
      {children}
    </div>
  );
}

/** One assigned item: an icon, its name and detail, and the actions for it. */
function ItemCard({ icon, kicker, title, sub, children }: { icon: ReactNode; kicker: string; title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-line-strong bg-panel-2 p-4">
      <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-accent text-on-accent">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted">{kicker}</span>
        <span className="font-sans condensed text-2xl leading-tight font-black uppercase">{title}</span>
        <span className="text-sm text-muted">{sub}</span>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <button type="button" onClick={focusLibrary} className="w-full rounded-2xl border-2 border-dashed border-line-strong p-6 text-left text-sm text-muted transition hover:border-accent hover:text-fg">
      {text}
    </button>
  );
}

/** The section order for one song, as chips. Drag a chip, or use Alt+arrows on it; Delete removes it. */
function Arrangement({ hymn, order, onChange }: { hymn: Hymn; order: string[]; onChange: (order: string[] | null) => void }) {
  const t = usePwT();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const stanza = (id: string) => hymn.stanzas.find((s) => String(s.id) === id);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = order.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
    requestAnimationFrame(() => chips.current[to]?.focus());
  };
  const remove = (at: number) => {
    // The last section stays: an empty arrangement would fall back to the full song without saying so.
    if (order.length <= 1) return;
    onChange(order.filter((_, i) => i !== at));
    requestAnimationFrame(() => chips.current[Math.min(at, order.length - 2)]?.focus());
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold">
          {t('arrangement')} <span className="font-normal text-muted">· {hymn.title}</span>
        </h4>
        <button type="button" onClick={() => onChange(null)} className="min-h-11 px-2 text-xs font-semibold text-muted underline-offset-2 hover:text-fg hover:underline">
          {t('resetArrangement')}
        </button>
      </div>
      <p className="sr-only">{t('arrangementHint')}</p>
      <ol className="flex flex-wrap items-center gap-2" aria-label={`${t('arrangement')}: ${hymn.title}`}>
        {order.map((id, i) => {
          const s = stanza(id);
          const label = s ? sectionChip(s.stanzaType) : '?';
          return (
            <li key={`${id}-${i}`}>
              <button
                ref={(el) => {
                  chips.current[i] = el;
                }}
                type="button"
                draggable
                onDragStart={() => setDragFrom(i)}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={(e) => dragFrom !== null && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null) move(dragFrom, i);
                  setDragFrom(null);
                }}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    e.preventDefault();
                    move(i, i + (e.key === 'ArrowLeft' ? -1 : 1));
                  } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    remove(i);
                  }
                }}
                title={`${s?.stanzaType ?? id} · ${t('arrangementHint')}`}
                aria-label={t('sectionChip', { label: s?.stanzaType ?? id, n: i + 1, total: order.length })}
                className={`grid h-11 min-w-14 cursor-grab place-items-center rounded-full border border-line-strong px-4 font-mono text-sm font-bold transition hover:border-accent ${
                  dragFrom === i ? 'opacity-40' : ''
                }`}
              >
                {label}
              </button>
            </li>
          );
        })}
        <li>
          <label className="sr-only" htmlFor={`pw-add-section-${hymn.id}`}>{t('addSectionLabel')}</label>
          <select
            id={`pw-add-section-${hymn.id}`}
            value=""
            onChange={(e) => e.target.value && onChange([...order, e.target.value])}
            className="h-11 cursor-pointer rounded-full border border-dashed border-line-strong bg-transparent px-4 text-sm font-semibold text-muted hover:border-accent hover:text-fg"
          >
            <option value="">{t('addSection')}</option>
            {hymn.stanzas.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {sectionChip(s.stanzaType)} · {s.stanzaType}
              </option>
            ))}
          </select>
        </li>
      </ol>
    </div>
  );
}

/** The segment's slides one at a time, at a readable size. Esc or Close returns focus to the Preview button. */
function PreviewDialog({ segment, slides, onClose }: { segment: PwSegment; slides: PwSlide[]; onClose: () => void }) {
  const t = usePwT();
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  // The button that opened the dialog gets focus back when it closes; the dialog unmounts, so the browser cannot do it.
  const opener = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const el = dialog.current;
    const back = opener.current;
    if (el && !el.open) el.showModal();
    // No close() here: it fires the close event, and under StrictMode's mount-unmount-mount that would shut the
    // dialog as soon as it opened. Unmounting removes the dialog from the top layer by itself.
    return () => back?.focus();
  }, []);
  const slide = slides[index];
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, slides.length - 1));
        if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
      }}
      aria-label={t('previewTitle', { name: segment.name })}
      className="m-auto w-[min(92vw,1100px)] rounded-2xl border border-line-strong bg-canvas p-5 text-fg backdrop:bg-black/70"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-sans condensed text-2xl font-black uppercase">{t('previewTitle', { name: segment.name })}</h2>
        <button type="button" onClick={onClose} autoFocus className={BTN} aria-label={t('close')}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <CurrentNextPreview
        current={{ slide: slide ?? null, segmentName: segment.name, type: segment.type, index, total: slides.length }}
        next={slides[index + 1] ? { slide: slides[index + 1], segmentName: segment.name, type: segment.type, index: index + 1, total: slides.length } : null}
        endLabel={t('previewEndSegment')}
      />
      <div className="mt-3 flex items-center justify-between">
        <button type="button" className={BTN} disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ChevronLeft size={16} aria-hidden /> {t('prevSlide')}
        </button>
        <span className="font-mono text-sm text-muted" aria-live="polite">{t('pos', { n: index + 1, total: slides.length })}</span>
        <button type="button" className={BTN} disabled={index >= slides.length - 1} onClick={() => setIndex(index + 1)}>
          {t('nextSlide')} <ChevronRight size={16} aria-hidden />
        </button>
      </div>
    </dialog>
  );
}

export function SegmentEditor() {
  const t = usePwT();
  const session = usePw((s) => s.session)!;
  const selected = usePw((s) => s.selected);
  const hymns = usePw((s) => s.hymns);
  const prayers = usePw((s) => s.prayers);
  const day = usePw((s) => s.day);
  const replacing = usePw((s) => s.replacing);
  const [previewing, setPreviewing] = useState(false);
  const livePw = useLive((s) => s.state.pw);
  const showAllVerses = useUi((s) => s.showAllVerses);

  const segment = session.segments[selected];
  if (!segment) return null;
  const i = selected;
  const status = segmentStatus(segment);
  const group = session.groups.find((g) => g.key === segment.group);
  const slides = slidesFor(segment, resolvedFor(segment, { hymns, prayers, day }));
  // While "Show all verses" is off, a song lists its live slide and the next one, or the first before any slide is live.
  const liveAt = livePw?.onAir && livePw.sessionId === session.id ? livePosition(session.segments, livePw) : null;
  const liveSlide = liveAt && liveAt.segment === selected ? liveAt.slide : -1;
  const shownIndexes =
    segment.type === 'song' && !showAllVerses ? visibleSlideIndexes(slides.length, liveSlide) : slides.map((_, n) => n);
  const c = segment.content;
  const songHymns = c.kind === 'song' ? c.hymnIds.map((id) => hymns[id]).filter((h): h is Hymn => Boolean(h)) : [];
  const key = songHymns.find((h) => h.musicalKey)?.musicalKey ?? '—';
  const update = (patch: Partial<PwSegment>) => updateSegment(i, patch);
  const startReplace = (hymnId: number | null) => {
    setPwState({ replacing: { segment: i, hymnId } });
    focusLibrary();
  };
  const isReplacing = (hymnId: number | null) => replacing?.segment === i && replacing.hymnId === hymnId;

  const replaceButton = (hymnId: number | null) =>
    isReplacing(hymnId) ? (
      <button type="button" className={BTN} aria-pressed onClick={() => setPwState({ replacing: null })}>
        {t('cancelReplace')}
      </button>
    ) : (
      <button type="button" className={BTN} onClick={() => startReplace(hymnId)}>
        {t('replace')}
      </button>
    );

  const prayer = c.kind === 'prayer' && c.noteId != null ? prayers.find((p) => p.id === c.noteId) : undefined;
  const reading = c.kind === 'lectionary' ? day?.readings.find((r) => r.readingType === c.readingType) : undefined;

  return (
    <section aria-labelledby="pw-segment-title" className="flex min-w-0 flex-col gap-5 rounded-2xl border border-line bg-panel p-5 @container/editor">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow !text-accent">
            {t('segmentEyebrow', { n: pad2(i + 1), group: group?.name ?? segment.group })}
          </p>
          <h2 id="pw-segment-title" className="mt-1 font-sans condensed text-2xl leading-tight font-black uppercase">
            {segment.name}
          </h2>
        </div>
        <span className={`rounded-full border border-line-strong px-3 py-1.5 text-sm font-semibold ${STATUS_TONE[status]}`}>{t(`status_${status}`)}</span>
      </header>

      <div className="grid grid-cols-1 gap-3 @md/editor:grid-cols-2 @2xl/editor:grid-cols-4">
        <Tile label={t('tile_type')}>
          <span className="font-semibold">{t(`type_${segment.type}`)}</span>
        </Tile>
        <Tile label={t('tile_time')} htmlFor="pw-minutes">
          <span className="flex items-baseline gap-1.5 font-mono">
            <input
              id="pw-minutes"
              type="number"
              min={0}
              max={240}
              inputMode="numeric"
              value={segment.minutes}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isInteger(n) && n >= 0 && n <= 240) update({ minutes: n });
              }}
              className="w-14 bg-transparent font-mono font-semibold outline-none"
            />
            <span className="text-sm text-muted">{t('minutes')}</span>
          </span>
        </Tile>
        <Tile label={t('tile_leader')} htmlFor="pw-leader">
          <input
            id="pw-leader"
            value={segment.leader}
            maxLength={80}
            placeholder={t('leaderPlaceholder')}
            onChange={(e) => update({ leader: e.target.value })}
            className={FIELD}
          />
        </Tile>
        <Tile label={t('tile_key')}>
          <span className="font-mono font-semibold">{key}</span>
        </Tile>
      </div>

      {segment.stale && <p className="rounded-xl border border-danger px-4 py-3 text-sm text-danger">{t('missingContent')}</p>}
      {replacing?.segment === i && <p className="text-sm text-accent" aria-live="polite">{t('replacing')}</p>}

      {/* What is assigned */}
      <div className="flex flex-col gap-3">
        {c.kind === 'song' &&
          (songHymns.length === 0 ? (
            <EmptyState text={t('emptySong')} />
          ) : (
            songHymns.map((h) => (
              <ItemCard
                key={h.id}
                icon={<Music size={24} aria-hidden />}
                kicker={t('type_song')}
                title={h.title}
                sub={t('songCard', { n: h.stanzas.length, category: [h.category, h.language].filter(Boolean).join(' · ') })}
              >
                <button type="button" className={BTN} onClick={() => setPreviewing(true)}>{t('preview')}</button>
                {replaceButton(h.id)}
                <button
                  type="button"
                  className={BTN}
                  onClick={() => {
                    const arrangement = { ...segment.arrangement };
                    delete arrangement[String(h.id)];
                    update({ content: { ...c, hymnIds: c.hymnIds.filter((x) => x !== h.id) }, arrangement });
                  }}
                >
                  {t('remove')}
                </button>
              </ItemCard>
            ))
          ))}
        {c.kind === 'song' && c.maxSongs > 1 && c.hymnIds.length > 0 && c.hymnIds.length < c.maxSongs && (
          <p className="text-sm text-muted">{t('moreSongs', { n: c.maxSongs })}</p>
        )}

        {c.kind === 'prayer' &&
          (prayer ? (
            <ItemCard icon={<Cross size={24} aria-hidden />} kicker={t('type_prayer')} title={prayer.title} sub={t('prayerCardSub')}>
              <button type="button" className={BTN} onClick={() => setPreviewing(true)}>{t('preview')}</button>
              {replaceButton(null)}
              <button type="button" className={BTN} onClick={() => update({ content: { kind: 'prayer', noteId: null } })}>{t('remove')}</button>
            </ItemCard>
          ) : (
            <EmptyState text={t('emptyPrayer')} />
          ))}

        {c.kind === 'title' && <ItemCard icon={<BookOpen size={24} aria-hidden />} kicker={t('type_scripture')} title={t('titleCard')} sub={t('titleCardSub')} />}

        {c.kind === 'lectionary' && (
          <ItemCard
            icon={<BookOpen size={24} aria-hidden />}
            kicker={t('fromLectionary')}
            title={t('lectionaryCard', { reading: c.readingType, date: session.liturgicalDate })}
            sub={reading?.rawText ? [reading.citation, t('lectionaryFilled')].filter(Boolean).join(' · ') : t('lectionaryEmpty')}
          >
            <button type="button" className={BTN} onClick={() => setPreviewing(true)}>{t('preview')}</button>
            <button
              type="button"
              className={BTN}
              onClick={() =>
                setUi({ view: 'lectionary', pendingFocus: { kind: 'reading', date: session.liturgicalDate, readingType: c.readingType as ReadingType } })
              }
            >
              {t('openLectionary')}
            </button>
          </ItemCard>
        )}
      </div>

      {songHymns.map((h) => (
        <Arrangement
          key={h.id}
          hymn={h}
          order={sectionOrder({ id: h.id, title: h.title, stanzas: h.stanzas }, segment.arrangement)}
          onChange={(order) => {
            const arrangement = { ...segment.arrangement };
            if (order) arrangement[String(h.id)] = order;
            else delete arrangement[String(h.id)];
            update({ arrangement });
          }}
        />
      ))}

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h3 className="font-bold">{t('projectorSlides')}</h3>
          <span className="text-sm text-muted">{t('slidesCount', { n: slides.length })}</span>
        </div>
        {segment.type === 'song' && (
          <div className="flex items-center">
            <ShowAllVerses label={t('showAllVerses')} />
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {shownIndexes.map((n) => (
            <SlideThumb key={n} slide={slides[n]} index={n} total={slides.length} segmentName={segment.name} type={segment.type} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 @2xl/editor:grid-cols-2">
        <fieldset className="rounded-2xl border border-line p-4">
          <legend className="px-2 font-bold">{t('cues')}</legend>
          <div className="flex flex-col">
            {CUE_KEYS.map((k) => (
              <label key={k} className="flex min-h-11 cursor-pointer items-center gap-3 py-1.5">
                <input
                  type="checkbox"
                  checked={segment.cues[k]}
                  onChange={(e) => update({ cues: { ...segment.cues, [k]: e.target.checked } })}
                  className="size-5 shrink-0 accent-[var(--color-accent)]"
                />
                <span>{t(CUE_LABEL[k])}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-2 rounded-2xl border border-line p-4">
          <label htmlFor="pw-notes" className="font-bold">{t('operatorNotes')}</label>
          <textarea
            id="pw-notes"
            value={segment.notes}
            maxLength={2000}
            rows={4}
            placeholder={t('notesPlaceholder')}
            onChange={(e) => update({ notes: e.target.value })}
            className="min-h-28 flex-1 resize-y rounded-xl border border-line-strong bg-canvas/40 p-3 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        </div>
      </div>

      <nav className="flex flex-wrap justify-between gap-3 border-t border-line pt-4" aria-label={t('lineup')}>
        <button type="button" className={BTN} disabled={i === 0} onClick={() => setPwState({ selected: i - 1, replacing: null })}>
          {t('prevSegment')}
        </button>
        <button type="button" className={BTN_ACCENT} disabled={i >= session.segments.length - 1} onClick={() => setPwState({ selected: i + 1, replacing: null })}>
          {t('nextSegment')}
        </button>
      </nav>

      {previewing && <PreviewDialog segment={segment} slides={slides} onClose={() => setPreviewing(false)} />}
    </section>
  );
}
