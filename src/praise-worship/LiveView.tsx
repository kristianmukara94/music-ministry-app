import { AlertTriangle, Check, Maximize2, Music, Play, X } from 'lucide-react';
import { lineupSongs, livePosition, readiness, runtimeOf, segmentStatus, step } from '../../shared/pw.js';
import { blackoutOverPw, welcomeOverPw } from '../../shared/live.js';
import { useLive } from '../live/store';
import { ProjectorView } from '../output/ProjectorView';
import { LowerThirdStage } from '../output/LowerThirdView';
import { lyricBottomOf } from '../../shared/lyric-area.js';
import { textCaseOf } from '../../shared/text-fit.js';
import { cueText, outputStatus, pad2 as cuePad2, type Cue } from '../../shared/stage-cue.js';
import { useNow } from '../operator/useNow';
import { pad2, STATUS_TONE } from './LineupRail';
import { endSession, goLive, jumpTo, liveDeck, otherSourceOnAir, showPosition, stepLive, type LiveStep } from './live';
import { PwStageFace, type Shown } from './CurrentNextPreview';
import { IntroSlideToggle } from './IntroSlideToggle';
import { SecondaryControls } from './SecondaryControls';
import { CardSlideHotEdit } from './CardSlideHotEdit';
import { subIndexChip } from '../../shared/stage-chips.js';
import { DetachMonitorButton } from '../components/DetachMonitorButton';
import { runOnAir } from '../golive/onAir';
import { useGoLiveT } from '../golive/strings';
import { BroadcastHeader } from '../golive/console/BroadcastHeader';
import { StageMonitors } from '../golive/console/StageMonitors';
import { TransportBar, consoleOutputActions } from '../golive/console/TransportBar';
import { CueNavigator } from '../golive/console/CueNavigator';
import { SlideEditorCard } from '../golive/console/SlideEditorCard';
import { TypographyCard } from '../golive/console/TypographyCard';
import { pwSongTarget } from '../golive/console/editTargets';
import { useConsoleKeys, useSegmentTimer } from '../golive/console/hooks';
import { setPwState, usePw } from './store';
import { setGoLiveFocused, useFocusEscape } from './useGoLiveFocus';
import { usePwT, type PwT } from './strings';
import type { PwSession } from './types';

const BTN = 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
const BTN_ACCENT = 'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-ok bg-ok px-5 text-sm font-extrabold text-canvas shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const CARD = 'rounded-xl border border-line bg-panel';

/** One step as the preview shows it: its slide, or a black screen for the end-of-segment step. */
function shownAt(session: PwSession, deck: LiveStep[][], at: { segment: number; slide: number }): Shown {
  const seg = session.segments[at.segment];
  const s = deck[at.segment]?.[at.slide];
  if (s?.kind === 'slide') return { slide: s.slide, segmentName: seg.name, type: seg.type, index: s.index, total: s.total };
  return { slide: null, segmentName: seg?.name ?? '', type: seg?.type ?? 'song', index: 0, total: 1 };
}

/** mm:ss, or h:mm:ss once past an hour. The Holy Mass console's clocks read the same. */
export function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h ? `${String(h).padStart(2, '0')}:${mmss}` : mmss;
}

/**
 * A segment's steps as cues for Jump to Cue. A song's slides carry its title (their tab) and their section chip (V1, C1.2) for the C and V
 * keys; a title card and the end-of-segment black step take no number key.
 */
function pwCues(steps: LiveStep[], t: PwT): Cue[] {
  return steps.map((s, i) => {
    const base = { index: i, number: i + 1 };
    if (s.kind === 'black') return { ...base, tag: t('blackStep'), text: '', chip: '■', hotkey: false };
    const slide = s.slide;
    if (slide.kind === 'lyrics') {
      const { chip, part = 0, parts = 1, label } = slide;
      return { ...base, tag: parts > 1 ? `${label} (${part + 1}/${parts})` : label, text: slide.text, group: slide.hymnTitle, chip: subIndexChip(chip, part, parts) };
    }
    if (slide.kind === 'title') return { ...base, tag: t('titleChip'), text: [slide.label, slide.subtitle].filter(Boolean).join(' · '), chip: 'T', hotkey: false };
    if (slide.kind === 'prayer') return { ...base, tag: slide.label, text: slide.text, chip: String(i + 1) };
    return { ...base, tag: slide.label, text: '', chip: String(i + 1) };
  });
}

/**
 * The Live lineup: every segment, done, current or to come. Each row lists the titles of the songs assigned to it, in sung order (one line per
 * song when a card chains several), so the operator sees the whole set list without opening a segment. On the current segment the song on the
 * projector is highlighted. A song segment with no song keeps its No song badge.
 */
function LiveLineup({ session, segment, hymns, playingHymn }: { session: PwSession; segment: number; hymns: Readonly<Record<number, { title: string } | undefined>>; playingHymn: number | null }) {
  const t = usePwT();
  return (
    <section aria-labelledby="pw-live-lineup" className="flex min-w-0 flex-col rounded-[10px] border border-line bg-panel p-4">
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 id="pw-live-lineup" className="text-lg font-bold tracking-tight">{t('lineup')}</h2>
        <span className="font-mono text-xs text-muted">{t('doneOf', { done: segment, total: session.segments.length })}</span>
      </div>
      <ol className="flex flex-col gap-1">
        {session.segments.map((s, i) => {
          const done = i < segment;
          const current = i === segment;
          const noSong = segmentStatus(s) === 'needs_song';
          const songs = lineupSongs(s, hymns);
          return (
            <li key={`${s.key}-${i}`}>
              <button
                type="button"
                onClick={() => jumpTo(i)}
                aria-current={current ? 'step' : undefined}
                className={`flex min-h-12 w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition ${
                  current ? 'border-accent bg-gradient-to-r from-accent/20 to-accent/5' : 'border-transparent hover:bg-fg/[0.06]'
                }`}
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full font-mono text-xs ${
                    done ? 'bg-ok text-canvas' : current ? 'bg-accent text-on-accent' : 'bg-panel-2 text-muted'
                  }`}
                >
                  {done ? <Check size={14} aria-label={t('done')} /> : pad2(i + 1)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`flex min-h-8 items-center text-[15px] leading-tight ${done ? 'text-muted' : 'font-semibold'}`}>{s.name}</span>
                  {/* Spans, not a list: a button may only hold phrasing content. The button's name still reads every title. */}
                  {songs.length > 0 && (
                    <span data-lineup-songs className="mt-0.5 flex flex-col gap-0.5">
                      {songs.map((song) => {
                        const onAir = current && song.id === playingHymn;
                        return (
                          <span
                            key={song.id}
                            data-on-air={onAir || undefined}
                            className={`flex min-w-0 items-center gap-1.5 text-[13px] leading-snug ${
                              onAir ? 'font-bold text-accent' : done ? 'text-muted' : 'text-fg/85'
                            }`}
                          >
                            {onAir ? (
                              <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />
                            ) : (
                              <Music size={12} aria-hidden className="shrink-0 opacity-70" />
                            )}
                            <span className="truncate" title={song.title}>{song.title}</span>
                            {onAir && <span className="sr-only"> ({t('songOnAir')})</span>}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </span>
                {noSong && <span className="flex min-h-8 shrink-0 items-center text-[11px] font-extrabold tracking-wide text-accent uppercase">{t('noSongBadge')}</span>}
                <span className="flex min-h-8 shrink-0 items-center font-mono text-xs text-muted">{runtimeOf(s)}m</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Praise & Worship's live console, in the broadcast layout shared with the Holy Mass console (src/golive/console): the header (segment
 * switcher, segment timer, output status) over the lineup and a two-column workspace. On the left, the program and preview monitors, the
 * transport and output bar, and Jump to Cue; on the right, the slide editor, Stage Typography & Backdrop, and the outputs. Every control drives
 * the real projector and lower third through the shared live state.
 */
export function LiveView() {
  const t = usePwT();
  const tg = useGoLiveT();
  const session = usePw((s) => s.session);
  // Subscribed so the deck is rebuilt when songs, prayers or the day's readings finish loading.
  const hymns = usePw((s) => s.hymns);
  usePw((s) => s.prayers);
  usePw((s) => s.day);
  const live = useLive((s) => s.state);
  const now = useNow().getTime();
  // The focus view counts only while this session is live: there is nothing to focus on before Go Live.
  const focused = usePw((s) => s.isGoLiveFocused) && Boolean(session && live.pw?.sessionId === session.id);
  useFocusEscape(focused);
  const pw = session && live.pw?.sessionId === session.id ? live.pw : null;
  // The position is found by key. Null when the live segment has been taken out of the lineup since it went live.
  const at = session && pw ? livePosition(session.segments, pw) : null;
  // The On air badge: the same answer as the Go Live console bar's Live button.
  const onAir = session ? runOnAir(live, 'pw', session.id) : false;
  const timer = useSegmentTimer('pw', session && at ? session.segments[at.segment]?.key ?? null : null, pw?.onAir === true);
  // B, L and H run Blackout, the Lower Third and Hide Text while the session is loaded (← → Space and 1–9 are the operator window's).
  useConsoleKeys((action) => consoleOutputActions[action](), pw !== null);
  if (!session) return <p className="rounded-[10px] border border-line bg-panel p-6 text-muted">{t('noSessions')}</p>;

  if (!pw) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-[10px] border border-line bg-panel p-6">
        <p className="text-muted">{t('notLive')}</p>
        <button
          type="button"
          className={BTN_ACCENT}
          onClick={() => {
            setGoLiveFocused(true);
            goLive();
          }}
        >
          <Play size={18} aria-hidden fill="currentColor" /> {t('goLive')}
        </button>
      </div>
    );
  }

  const deck = liveDeck(session);
  if (!at) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-[10px] border border-accent bg-panel p-6 text-accent">
        <p>{t('segmentGone')}</p>
        <p className="text-sm text-muted">{t('segmentGoneHint')}</p>
      </div>
    );
  }
  const segmentIndex = at.segment;
  // The slide after this one, across segments, as the Next key would reach it. Null at the end of the lineup.
  const nextAt = step(deck.map((d) => d.length), at, 1);
  const segment = session.segments[segmentIndex];
  const steps = deck[segmentIndex] ?? [];
  const group = session.groups.find((g) => g.key === segment?.group)?.name ?? '';
  const nowStep = steps[at.slide];
  const playingHymn = nowStep?.kind === 'slide' && nowStep.slide.kind === 'lyrics' ? nowStep.slide.hymnId : null;
  const planned = (segment ? runtimeOf(segment) : 0) * 60_000;
  const other = otherSourceOnAir(live);
  const nextSegment = session.segments[segmentIndex + 1];
  const { missingSongs } = readiness(session.segments);
  // The welcome screen or Blackout is up over the session: it stays on air at its place, and Next and Back always work, putting a slide back.
  const covered = welcomeOverPw(live) || blackoutOverPw(live);
  const atStart = !covered && segmentIndex === 0 && at.slide === 0;
  const atEnd = !covered && segmentIndex === deck.length - 1 && at.slide === steps.length - 1;
  const cues = pwCues(steps, t);
  const textCase = textCaseOf(live.settings.textCase);
  // Up next: the next slide's words, or, on the segment's last slide, the segment Next goes on to.
  const nextCue = nextAt && nextAt.segment === segmentIndex ? cues[nextAt.slide] : null;
  const upNext = !nextAt
    ? t('previewEnd')
    : nextCue
      ? tg('consoleUpNext', { text: cueText(nextCue.text, textCase) || nextCue.tag })
      : `${tg('consoleFinalSlide')} · ${tg('consoleUpNext', { text: session.segments[nextAt.segment]?.name ?? '' })}`;
  const lyricHymn = playingHymn !== null ? hymns[playingHymn] ?? null : null;
  const editTarget = lyricHymn ? pwSongTarget({ t, segmentIndex, steps, onAir: at.slide, hymn: lyricHymn }) : null;

  return (
    <div className="flex flex-col gap-5">
      <BroadcastHeader
        titleId="pw-live-title"
        live={onAir}
        at={segmentIndex}
        total={session.segments.length}
        role={group}
        options={session.segments.map((s, i) => ({ value: String(i), label: s.name }))}
        value={String(segmentIndex)}
        onPick={(v) => jumpTo(Number(v))}
        timer={{ elapsedMs: timer.elapsedMs, plannedMs: planned || null, running: timer.running, onToggle: timer.toggle, onReset: timer.reset }}
        status={outputStatus(live, onAir)}
        actions={
          <>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[11px] text-muted">{t('sessionTime')}</span>
              <span className="font-mono text-sm text-fg tabular-nums">{clock(pw.liveSince ? now - pw.liveSince : 0)}</span>
            </span>
            <IntroSlideToggle />
            <button type="button" className={`${BTN} hover:!border-danger/60 hover:!text-danger`} onClick={() => window.confirm(t('confirmEnd')) && endSession()}>
              {t('endSession')}
            </button>
            {focused ? (
              // Closes the focus view only: the lineup comes back, and the projector keeps what it shows.
              <button
                type="button"
                onClick={() => setGoLiveFocused(false)}
                aria-label={t('leaveFocus')}
                title={t('leaveFocusTip')}
                aria-keyshortcuts="Escape"
                className="grid size-9 shrink-0 place-items-center rounded-md border border-fg/25 bg-panel-2 text-fg transition hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
              >
                <X size={18} aria-hidden />
              </button>
            ) : (
              <button type="button" className={BTN} onClick={() => setGoLiveFocused(true)} title={t('focusViewTip')}>
                <Maximize2 size={15} aria-hidden /> {t('focusView')}
              </button>
            )}
          </>
        }
        alert={
          segment && segmentStatus(segment) === 'needs_song' ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-accent px-4 py-2 text-accent">
              <AlertTriangle size={18} aria-hidden />
              <span className="flex-1">{t('noSongBanner')}</span>
              <button type="button" className="min-h-9 font-semibold underline underline-offset-2" onClick={() => setPwState({ tab: 'plan', selected: segmentIndex, isGoLiveFocused: false })}>
                {t('fixInPlanner')}
              </button>
            </div>
          ) : null
        }
      />

      {/* Whichever took the projector last is on air. When it is not Praise & Worship, say so and offer to take over. */}
      {other && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-accent bg-panel-2 px-5 py-3">
          <span>{t('takeOverBanner', { source: other, segment: segment?.name ?? '' })}</span>
          <button type="button" className={BTN} onClick={() => showPosition(session, deck, at)}>
            {t('takeOver')}
          </button>
        </div>
      )}

      {/* In the focus view the lineup steps aside and the workspace takes its room; the header's switcher and Back and Next still walk it. */}
      <div className={`grid grid-cols-1 items-start gap-5 ${focused ? '' : '@4xl/pw:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]'}`}>
        {!focused && <LiveLineup session={session} segment={segmentIndex} hymns={hymns} playingHymn={playingHymn} />}

        {segment && (
          <div className="@container/work min-w-0">
            <div className="grid grid-cols-1 items-start gap-5 @4xl/work:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-5">
                <section aria-label={tg('consoleProgram')} className={`${CARD} flex flex-col gap-4 p-4`}>
                  {/* The current step and the next one, drawn with the projector's own face (PwSlideFace), case and size. */}
                  <StageMonitors
                    program={<PwStageFace shown={shownAt(session, deck, at)} />}
                    counter={tg('consoleSlideOf', { n: cuePad2(at.slide + 1), total: cuePad2(steps.length) })}
                    next={nextAt ? <PwStageFace shown={shownAt(session, deck, nextAt)} /> : null}
                    upNext={upNext}
                    onPushNext={atEnd ? null : () => void stepLive(1)}
                  />
                  <TransportBar
                    onBack={() => void stepLive(-1)}
                    onNext={() => void stepLive(1)}
                    backDisabled={atStart}
                    nextDisabled={atEnd}
                    counter={`${cuePad2(at.slide + 1)} / ${cuePad2(steps.length)}`}
                  />
                </section>
                <CueNavigator cues={cues} activeIndex={at.slide} onSelect={(i) => jumpTo(segmentIndex, i)} itemKey={segment.key} />
              </div>

              <aside className="flex min-w-0 flex-col gap-5">
                <SlideEditorCard
                  target={editTarget}
                  number={at.slide + 1}
                  emptyHint={tg('consoleEditNone')}
                  // Any other slide (a title card, a prayer, a reading, a picture) is edited by the card editor, in this lineup's own copy.
                  fallback={<CardSlideHotEdit t={t} segmentIndex={segmentIndex} steps={steps} onAir={at.slide} showButtons editRequest={null} onEditHandled={() => {}} />}
                />
                <TypographyCard />
                <section aria-labelledby="pw-outputs" className={`${CARD} flex flex-col gap-3 p-4`}>
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="pw-outputs" className="text-sm font-bold">{t('outputs')}</h2>
                    <DetachMonitorButton />
                  </div>
                  <span className="text-xs text-muted">{t('congregation')}</span>
                  <div className="relative aspect-video overflow-hidden rounded-lg border border-line">
                    <ProjectorView mirror embedded />
                  </div>
                  <span className="text-xs text-muted">{t('livestream')}</span>
                  <div data-theme="default" className="relative aspect-video overflow-hidden rounded-lg border border-line bg-canvas [container-type:size]">
                    {live.lowerThird.live ? (
                      <LowerThirdStage value={live.lowerThird.live} lyricBottomShare={lyricBottomOf(live.projector.live)} />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center px-3 text-center text-xs text-faint">{t('lowerThirdToggle')}: {t('off')}</div>
                    )}
                  </div>
                </section>
                <SecondaryControls />
                <section aria-labelledby="pw-next-up" className={`${CARD} flex flex-col gap-1 p-4`}>
                  <h2 id="pw-next-up" className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('nextUp')}</h2>
                  {nextSegment ? (
                    <>
                      <p className="text-xl font-bold tracking-tight">{nextSegment.name}</p>
                      <p className={`text-sm font-semibold ${STATUS_TONE[segmentStatus(nextSegment)]}`}>{t(`status_${segmentStatus(nextSegment)}`)}</p>
                    </>
                  ) : (
                    <p className="text-muted">{t('endOfLineup')}</p>
                  )}
                </section>
                <section aria-labelledby="pw-preflight" className={`${CARD} flex flex-col gap-2 p-4`}>
                  <h2 id="pw-preflight" className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('preflight')}</h2>
                  <p>{missingSongs === 0 ? t('preflightOk') : missingSongs === 1 ? t('preflightSongsOne') : t('preflightSongs', { n: missingSongs })}</p>
                  {missingSongs > 0 && (
                    <button type="button" className="min-h-11 self-start font-semibold text-accent underline underline-offset-2" onClick={() => setPwState({ tab: 'plan', isGoLiveFocused: false })}>
                      {t('fixInPlanner')}
                    </button>
                  )}
                </section>
              </aside>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
