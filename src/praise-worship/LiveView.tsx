import { AlertTriangle, Check, Play } from 'lucide-react';
import { livePosition, readiness, segmentStatus } from '../../shared/pw.js';
import { dispatch, useLive } from '../live/store';
import { ProjectorView } from '../output/ProjectorView';
import { LowerThirdStage } from '../output/LowerThirdView';
import { useNow } from '../operator/useNow';
import { pad2, STATUS_TONE } from './LineupRail';
import { endSession, goLive, jumpTo, liveDeck, otherSourceOnAir, showPosition, stepLive, type LiveStep } from './live';
import { PwSlideFace } from './PwSlideFace';
import { setPwState, usePw } from './store';
import { usePwT, type PwT } from './strings';
import type { PwSession } from './types';

const BTN = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line-strong px-5 text-sm font-semibold transition hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40';
const BTN_ACCENT = 'inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-accent px-8 text-base font-bold text-on-accent transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';
const TOGGLE = (on: boolean) =>
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-5 text-sm font-semibold transition ${
    on ? 'border-accent bg-accent/15 text-accent' : 'border-line-strong hover:bg-panel-2'
  }`;

/** mm:ss, or h:mm:ss once past an hour. */
function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h ? `${String(h).padStart(2, '0')}:${mmss}` : mmss;
}

/** The chip for one step in Jump to section. */
function stepChip(s: LiveStep, t: PwT) {
  if (s.kind === 'black') return { label: '■', name: t('blackStep') };
  if (s.slide.kind === 'lyrics') return { label: s.slide.chip, name: s.slide.label };
  if (s.slide.kind === 'title') return { label: 'T', name: t('titleChip') };
  return { label: String(s.index + 1), name: s.slide.label };
}

function LiveLineup({ session, segment }: { session: PwSession; segment: number }) {
  const t = usePwT();
  return (
    <section aria-labelledby="pw-live-lineup" className="flex min-w-0 flex-col rounded-2xl border border-line bg-panel p-4">
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 id="pw-live-lineup" className="text-lg font-bold">{t('lineup')}</h2>
        <span className="font-mono text-xs text-muted">{t('doneOf', { done: segment, total: session.segments.length })}</span>
      </div>
      <ol className="flex flex-col gap-1">
        {session.segments.map((s, i) => {
          const done = i < segment;
          const current = i === segment;
          const noSong = segmentStatus(s) === 'needs_song';
          return (
            <li key={`${s.key}-${i}`}>
              <button
                type="button"
                onClick={() => jumpTo(i)}
                aria-current={current ? 'step' : undefined}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                  current ? 'border-accent bg-panel-2' : 'border-transparent hover:bg-panel-2'
                }`}
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full font-mono text-xs ${
                    done ? 'bg-ok text-canvas' : current ? 'bg-accent text-on-accent' : 'bg-panel-2 text-muted'
                  }`}
                >
                  {done ? <Check size={14} aria-label={t('done')} /> : pad2(i + 1)}
                </span>
                <span className={`min-w-0 flex-1 text-[15px] leading-tight ${done ? 'text-muted' : 'font-semibold'}`}>{s.name}</span>
                {noSong && <span className="shrink-0 text-[11px] font-extrabold tracking-wide text-accent uppercase">{t('noSongBadge')}</span>}
                <span className="shrink-0 font-mono text-xs text-muted">{s.minutes}m</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Praise & Worship's live console. Drives the real projector and lower third through the shared live state. */
export function LiveView() {
  const t = usePwT();
  const session = usePw((s) => s.session);
  // Subscribed so the deck is rebuilt when songs, prayers or the day's readings finish loading.
  const hymns = usePw((s) => s.hymns);
  usePw((s) => s.prayers);
  usePw((s) => s.day);
  const live = useLive((s) => s.state);
  const now = useNow().getTime();
  if (!session) return <p className="rounded-2xl border border-line bg-panel p-6 text-muted">{t('noSessions')}</p>;

  const pw = live.pw?.sessionId === session.id ? live.pw : null;
  if (!pw) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-line bg-panel p-6">
        <p className="text-muted">{t('notLive')}</p>
        <button type="button" className={BTN_ACCENT} onClick={goLive}>
          <Play size={18} aria-hidden fill="currentColor" /> {t('goLive')}
        </button>
      </div>
    );
  }

  const deck = liveDeck(session);
  // The position is found by key. Null when the live segment has been taken out of the lineup since it went live.
  const at = livePosition(session.segments, pw);
  if (!at) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-accent bg-panel p-6 text-accent">
        <p>{t('segmentGone')}</p>
        <p className="text-sm text-muted">{t('segmentGoneHint')}</p>
      </div>
    );
  }
  const segmentIndex = at.segment;
  const segment = session.segments[segmentIndex];
  const steps = deck[segmentIndex] ?? [];
  const current = steps[at.slide];
  const group = session.groups.find((g) => g.key === segment?.group)?.name ?? '';
  const songTitles = segment?.content.kind === 'song' ? segment.content.hymnIds.map((id) => hymns[id]?.title).filter(Boolean).join(' · ') : '';
  const planned = (segment?.minutes ?? 0) * 60_000;
  const elapsed = pw.onAir && pw.startedAt ? now - pw.startedAt : 0;
  const other = otherSourceOnAir(live);
  const nextSegment = session.segments[segmentIndex + 1];
  const { missingSongs } = readiness(session.segments);
  const lowerOn = live.lowerThird.live != null;
  const blackout = live.projector.live.kind === 'blackout';
  const atStart = segmentIndex === 0 && at.slide === 0;
  const atEnd = segmentIndex === deck.length - 1 && at.slide === steps.length - 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-4">
        <span
          className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-4 text-sm font-extrabold tracking-[0.18em] uppercase ${
            pw.onAir ? 'border-danger text-danger' : 'border-line-strong text-muted'
          }`}
        >
          <span aria-hidden className={`size-2 rounded-full ${pw.onAir ? 'bg-danger' : 'bg-muted'}`} />
          {pw.onAir ? t('liveBadge') : t('offAir')}
        </span>
        <span className="flex flex-col">
          <span className="text-xs text-muted">{t('sessionTime')}</span>
          <span className="font-mono text-2xl">{clock(pw.liveSince ? now - pw.liveSince : 0)}</span>
        </span>
        <button type="button" className={BTN} onClick={() => window.confirm(t('confirmEnd')) && endSession()}>
          {t('endSession')}
        </button>
      </div>

      {/* Whichever took the projector last is on air. When it is not Praise & Worship, say so and offer to take over. */}
      {other && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent bg-panel-2 px-5 py-3">
          <span>{t('takeOverBanner', { source: other, segment: segment?.name ?? '' })}</span>
          <button type="button" className={BTN} onClick={() => showPosition(session, deck, at)}>
            {t('takeOver')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 @4xl/pw:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] @6xl/pw:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(260px,320px)]">
        <LiveLineup session={session} segment={segmentIndex} />

        {segment && (
          <section aria-labelledby="pw-live-title" className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-extrabold tracking-[0.18em] text-accent uppercase">
                  {t('nowEyebrow', { n: pad2(segmentIndex + 1), total: session.segments.length, group })}
                </p>
                <h2 id="pw-live-title" className="mt-1 font-serif text-4xl leading-tight font-semibold">{segment.name}</h2>
                {songTitles && <p className="text-muted">{songTitles}</p>}
              </div>
              <div className="flex min-w-56 flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span id="pw-seg-time" className="text-sm text-muted">{t('segmentTime')}</span>
                  <span className="font-mono">{clock(elapsed)} / {clock(planned)}</span>
                </div>
                <div role="progressbar" aria-labelledby="pw-seg-time" aria-valuemin={0} aria-valuemax={planned / 1000} aria-valuenow={Math.round(elapsed / 1000)} className="h-2 overflow-hidden rounded-full bg-panel-2">
                  <div className={`h-full rounded-full ${elapsed > planned ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${planned ? Math.min(100, (elapsed / planned) * 100) : 0}%` }} />
                </div>
              </div>
            </div>

            {segmentStatus(segment) === 'needs_song' && (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-accent px-4 py-3 text-accent">
                <AlertTriangle size={18} aria-hidden />
                <span className="flex-1">{t('noSongBanner')}</span>
                <button type="button" className="min-h-11 font-semibold underline underline-offset-2" onClick={() => setPwState({ tab: 'plan', selected: segmentIndex })}>
                  {t('fixInPlanner')}
                </button>
              </div>
            )}

            {/* What this step looks like, drawn locally. The real projector is on the right. */}
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-line-strong [container-type:size]">
              {current?.kind === 'slide' ? (
                <PwSlideFace slide={current.slide} segmentName={segment.name} type={segment.type} index={current.index} total={current.total} footer={current.slide.kind === 'lyrics' ? current.slide.hymnTitle : current.slide.kind === 'prayer' ? t('prayTogether') : undefined} />
              ) : (
                <div data-theme="default" className="absolute inset-0 grid place-items-center bg-canvas text-muted">{t('blackStep')}</div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-extrabold tracking-[0.18em] text-accent uppercase">{t('jumpToSection')}</h3>
              <ol className="flex flex-wrap gap-2">
                {steps.map((s, i) => {
                  const chip = stepChip(s, t);
                  const here = i === at.slide;
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => jumpTo(segmentIndex, i)}
                        aria-current={here ? 'step' : undefined}
                        aria-label={t('stepLabel', { label: chip.name, n: i + 1, total: steps.length })}
                        className={`grid h-12 min-w-14 place-items-center rounded-full border px-4 font-mono text-sm font-bold transition ${
                          here ? 'border-accent bg-accent text-on-accent' : 'border-line-strong hover:border-accent'
                        }`}
                      >
                        {chip.label}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <button type="button" className={BTN} disabled={atStart} onClick={() => void stepLive(-1)}>
                {t('back')}
              </button>
              <button type="button" className={BTN_ACCENT} disabled={atEnd} onClick={() => void stepLive(1)}>
                {t('next')}
              </button>
              <span className="flex-1" />
              <button type="button" aria-pressed={lowerOn} className={TOGGLE(lowerOn)} onClick={() => dispatch({ type: 'lowerThird/toggle' })}>
                {t('lowerThirdToggle')}: {lowerOn ? t('on') : t('off')}
              </button>
              <button type="button" aria-pressed={blackout} className={TOGGLE(blackout)} onClick={() => dispatch({ type: 'projector/blackout' })}>
                {t('blackoutToggle')}: {blackout ? t('on') : t('off')}
              </button>
            </div>
          </section>
        )}

        <div className="flex min-w-0 flex-col gap-5 @4xl/pw:col-span-2 @6xl/pw:col-span-1">
          <section aria-labelledby="pw-outputs" className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
            <h2 id="pw-outputs" className="text-lg font-bold">{t('outputs')}</h2>
            <span className="text-sm text-muted">{t('congregation')}</span>
            <div className="relative aspect-video overflow-hidden rounded-xl border border-line">
              <ProjectorView mirror embedded />
            </div>
            <span className="text-sm text-muted">{t('livestream')}</span>
            <div data-theme="default" className="relative aspect-video overflow-hidden rounded-xl border border-line bg-canvas [container-type:size]">
              {live.lowerThird.live && <LowerThirdStage value={live.lowerThird.live} />}
            </div>
          </section>

          <section aria-labelledby="pw-next-up" className="flex flex-col gap-1 rounded-2xl border border-line bg-panel p-4">
            <h2 id="pw-next-up" className="text-xs font-extrabold tracking-[0.18em] text-accent uppercase">{t('nextUp')}</h2>
            {nextSegment ? (
              <>
                <p className="font-serif text-2xl font-semibold">{nextSegment.name}</p>
                <p className={`text-sm font-semibold ${STATUS_TONE[segmentStatus(nextSegment)]}`}>
                  {t(`status_${segmentStatus(nextSegment)}`)}
                </p>
              </>
            ) : (
              <p className="text-muted">{t('endOfLineup')}</p>
            )}
          </section>

          <section aria-labelledby="pw-preflight" className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-4">
            <h2 id="pw-preflight" className="text-xs font-extrabold tracking-[0.18em] text-accent uppercase">{t('preflight')}</h2>
            <p>{missingSongs === 0 ? t('preflightOk') : missingSongs === 1 ? t('preflightSongsOne') : t('preflightSongs', { n: missingSongs })}</p>
            {missingSongs > 0 && (
              <button type="button" className="min-h-11 self-start font-semibold text-accent underline underline-offset-2" onClick={() => setPwState({ tab: 'plan' })}>
                {t('fixInPlanner')}
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
