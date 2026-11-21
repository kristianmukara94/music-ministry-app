import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Maximize2, Music, Play, X } from 'lucide-react';
import { lineupSongs, livePosition, readiness, runtimeOf, segmentStatus, step } from '../../shared/pw.js';
import { blackoutOverPw, welcomeOverPw } from '../../shared/live.js';
import { useLive } from '../live/store';
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
import { runOnAir } from '../golive/onAir';
import { useGoLiveT } from '../golive/strings';
import { BroadcastHeader } from '../golive/console/BroadcastHeader';
import { StageMonitors } from '../golive/console/StageMonitors';
import { TransportBar, consoleOutputActions } from '../golive/console/TransportBar';
import { CueNavigator } from '../golive/console/CueNavigator';
import { SlideEditorCard } from '../golive/console/SlideEditorCard';
import { TypographyCard } from '../golive/console/TypographyCard';
import { pwCardTarget, pwSongTarget } from '../golive/console/editTargets';
import { SlideEditorModal, type EditorCue } from '../golive/console/SlideEditorModal';
import { FloatingProgram } from '../golive/console/FloatingProgram';
import { OutputsCard } from '../golive/console/OutputsCard';
import { useCueMeta } from '../golive/console/cueMeta';
import { pwLookKey } from '../../shared/slide-look.js';
import { useConsoleKeys, useSegmentTimer } from '../golive/console/hooks';
import { setPwState, usePw } from './store';
import { setGoLiveFocused, useFocusEscape } from './useGoLiveFocus';
import { usePwT, type PwT } from './strings';
import type { PwSession } from './types';

const BTN = 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
const BTN_ACCENT = 'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-ok bg-ok px-5 text-sm font-extrabold text-canvas shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const CARD = 'rounded-xl border border-line bg-panel';

/** One step as the preview shows it: its slide (with its look key, so its own look shows), or a black screen for the end-of-segment step. */
function shownAt(session: PwSession, deck: LiveStep[][], at: { segment: number; slide: number }): Shown {
  const seg = session.segments[at.segment];
  const s = deck[at.segment]?.[at.slide];
  if (s?.kind === 'slide') return { slide: s.slide, segmentName: seg.name, type: seg.type, index: s.index, total: s.total, lookKey: pwLookKey(seg.key, s.index) };
  return { slide: null, segmentName: seg?.name ?? '', type: seg?.type ?? 'song', index: 0, total: 1 };
}

/** A step as the editor previews it: with the words being typed in place of the saved ones (a lyric or prayer slide; others have none). */
function withWords(shown: Shown, text: string): Shown {
  const slide = shown.slide;
  if (slide?.kind === 'lyrics') return { ...shown, slide: { ...slide, text } };
  // An empty prayer slot's words are drawn as words once typed, not in the placeholder's muted italic.
  if (slide?.kind === 'prayer') return { ...shown, slide: { ...slide, text, placeholder: Boolean(slide.placeholder) && !text.trim() } };
  return shown;
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
function LiveLineup({
  session,
  segment,
  hymns,
  playingHymn,
  selected,
  onPick,
}: {
  session: PwSession;
  segment: number;
  hymns: Readonly<Record<number, { title: string } | undefined>>;
  playingHymn: number | null;
  /** The segment selected to look at and edit, not on air, or null. */
  selected: number | null;
  /** Selects a segment: its slides show in the console to check and edit, and the projector keeps what it shows. */
  onPick: (index: number) => void;
}) {
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
          const picked = i === selected && !current;
          const noSong = segmentStatus(s) === 'needs_song';
          const songs = lineupSongs(s, hymns);
          return (
            <li key={`${s.key}-${i}`}>
              <button
                type="button"
                // Selects the segment without playing it: its slides show in the console, to check and edit, while the projector keeps what
                // it shows. Go live (or a slide of it) plays it.
                onClick={() => onPick(i)}
                aria-current={current ? 'step' : undefined}
                aria-pressed={picked}
                className={`flex min-h-12 w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition ${
                  current ? 'border-accent bg-gradient-to-r from-accent/20 to-accent/5' : picked ? 'border-dashed border-accent/70 bg-fg/[0.06]' : 'border-transparent hover:bg-fg/[0.06]'
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
                  {/* Under the name, not beside it, so a short column never squeezes the segment's name onto two lines. */}
                  {noSong && <span className="mt-0.5 self-start rounded-full border border-accent/40 bg-accent/10 px-2 py-px text-[10px] font-extrabold tracking-wide text-accent uppercase">{t('noSongBadge')}</span>}
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
  // The segment selected in the lineup to look at and edit without playing it (its key), or null for the segment on air.
  const [browse, setBrowse] = useState<string | null>(null);
  useEffect(() => setBrowse(null), [session?.id]);
  // The Output Preview Editor, open on step `slide` of the segment `segment` (its key), or null. It stays open while that segment is on air or
  // selected, so it closes when the lineup moves on from the segment on air, and goes on editing a selected segment put on air from it.
  const [editing, setEditing] = useState<{ segment: string; slide: number } | null>(null);
  useEffect(() => setEditing(null), [session?.id]);
  // The step on air, for E. Set below, once the position is known.
  const liveStep = useRef<number | null>(null);
  const monitorsRef = useRef<HTMLDivElement>(null);
  const cueMeta = useCueMeta((s) => s.meta);
  // B, L and H run Blackout, the Lower Third and Hide Text while the session is loaded, and E opens the editor on the slide on air (← → Space and
  // 1–9 are the operator window's).
  const editOnAir = () => liveStep.current !== null && pw?.segmentKey != null && setEditing({ segment: pw.segmentKey, slide: liveStep.current });
  useConsoleKeys((action) => (action === 'edit' ? editOnAir() : consoleOutputActions[action]()), pw !== null);
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
  // The inspector edits the slide on air, whatever it is: a song's stanza, or a prayer's or reading's page or a title slide in the card's own copy.
  const editTarget = lyricHymn
    ? pwSongTarget({ t, segmentIndex, steps, onAir: at.slide, hymn: lyricHymn })
    : pwCardTarget({ t, segmentIndex, steps, step: at.slide, onAir: at.slide });
  // The editor opens on any slide of a segment (the black step has nothing to edit). E opens it on the slide on air.
  const editableIn = (seg: number) => (i: number) => deck[seg]?.[i]?.kind === 'slide';
  const editable = editableIn(segmentIndex);
  liveStep.current = editable(at.slide) ? at.slide : null;
  const openEditor = (i: number) => segment && editable(i) && setEditing({ segment: segment.key, slide: i });
  const nextInSegment = nextAt && nextAt.segment === segmentIndex ? nextAt.slide : null;
  const liveNote = segment && editable(at.slide) ? cueMeta[pwLookKey(segment.key, at.slide)]?.notes ?? null : null;
  /**
   * The editor's view of step `i` of segment `seg`. Every slide with words can be edited: a song's slide (this service's own stanza), and a
   * prayer's or a reading's page or a title slide (the card's own copy, see pwCardTarget). A picture keeps its formatting and notes only.
   */
  const cueAtIn = (seg: number) => {
    const segSteps = deck[seg] ?? [];
    const segCues = seg === segmentIndex ? cues : pwCues(segSteps, t);
    return (i: number): EditorCue | null => {
      const s = segSteps[i];
      const own = session.segments[seg];
      if (!own || s?.kind !== 'slide') return null;
      const shown = shownAt(session, deck, { segment: seg, slide: i });
      const hymn = s.slide.kind === 'lyrics' ? hymns[s.slide.hymnId] ?? null : null;
      return {
        index: i,
        count: segSteps.length,
        lookKey: pwLookKey(own.key, s.index),
        target: hymn
          ? pwSongTarget({ t, segmentIndex: seg, steps: segSteps, onAir: i, hymn })
          : pwCardTarget({ t, segmentIndex: seg, steps: segSteps, step: i, onAir: seg === segmentIndex ? at.slide : null }),
        tag: segCues[i]?.tag ?? '',
        text: segCues[i]?.text ?? '',
        onAir: seg === segmentIndex && i === at.slide,
        preview: ({ text, look }) => <PwStageFace shown={withWords(shown, text)} look={look} />,
        goLive: () => jumpTo(seg, i),
      };
    };
  };
  // The segment selected in the lineup, when it is not the one on air: its slides show in Jump to Cue, and the projector keeps what it shows.
  const browseIndex = browse !== null ? session.segments.findIndex((s) => s.key === browse) : -1;
  const browsing = browseIndex >= 0 && browseIndex !== segmentIndex ? session.segments[browseIndex] : null;
  const browseCues = browsing ? pwCues(deck[browseIndex] ?? [], t) : [];
  /** Plays the selected segment (from step `slide`), and lets the selection go: the console then follows it on air. */
  const goLiveBrowsed = (slide = 0) => {
    if (!browsing) return;
    setBrowse(null);
    jumpTo(browseIndex, slide);
  };
  // The editor works on the segment it was opened on, while that segment is on air or selected.
  const editingIndex = editing ? session.segments.findIndex((s) => s.key === editing.segment) : -1;
  const editingOpen = editing !== null && editingIndex >= 0 && (editingIndex === segmentIndex || (browsing !== null && editingIndex === browseIndex));

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
        tools={
          <>
            <span className="flex items-baseline gap-1.5">
              <span className="text-[11px] text-muted">{t('sessionTime')}</span>
              <span className="font-mono text-sm text-fg tabular-nums">{clock(pw.liveSince ? now - pw.liveSince : 0)}</span>
            </span>
            <IntroSlideToggle />
          </>
        }
        actions={
          <>
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
      <div className={`grid grid-cols-1 items-start gap-5 ${focused ? '' : '@4xl/pw:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]'}`}>
        {!focused && <LiveLineup session={session} segment={segmentIndex} hymns={hymns} playingHymn={playingHymn} selected={browsing ? browseIndex : null} onPick={(i) => setBrowse(i === segmentIndex ? null : session.segments[i]?.key ?? null)} />}

        {segment && (
          <div className="@container/work min-w-0">
            <div className="grid grid-cols-1 items-start gap-5 @4xl/work:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-5">
                <section aria-label={tg('consoleProgram')} className={`${CARD} flex flex-col gap-4 p-4`}>
                  {/* The current step and the next one, drawn with the projector's own face (PwSlideFace), case and size. */}
                  <StageMonitors
                    boxRef={monitorsRef}
                    onEditLive={liveStep.current !== null ? () => openEditor(at.slide) : null}
                    onEditNext={nextInSegment !== null && editable(nextInSegment) ? () => openEditor(nextInSegment) : null}
                    cueNote={liveNote}
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
                {browsing ? (
                  <>
                    {/* A segment selected in the lineup: its slides, to check and edit, while the projector keeps the segment on air. */}
                    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-dashed border-accent/70 bg-panel-2 px-4 py-3">
                      <div className="flex min-w-0 flex-col">
                        <span className="text-[11px] font-semibold tracking-wider text-accent uppercase">{tg('consoleBrowsing')}</span>
                        <span className="truncate text-base font-bold" title={browsing.name}>{browsing.name}</span>
                        <span className="text-xs text-muted">{tg('consoleBrowseHint')}</span>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button type="button" className={BTN} onClick={() => setBrowse(null)}>
                          {tg('consoleBackToLive')}
                        </button>
                        <button type="button" className={BTN_ACCENT} onClick={() => goLiveBrowsed()}>
                          <Play size={15} aria-hidden fill="currentColor" /> {tg('consoleBrowseGoLive')}
                        </button>
                      </div>
                    </div>
                    <CueNavigator
                      cues={browseCues}
                      activeIndex={-1}
                      onSelect={(i) => goLiveBrowsed(i)}
                      itemKey={`browse:${browsing.key}`}
                      onEdit={(i) => editableIn(browseIndex)(i) && setEditing({ segment: browsing.key, slide: i })}
                      empty={tg('consoleBrowseNoSlides')}
                      keyTarget={{ cues, activeIndex: at.slide, onSelect: (i) => jumpTo(segmentIndex, i) }}
                    />
                  </>
                ) : (
                  <CueNavigator cues={cues} activeIndex={at.slide} onSelect={(i) => jumpTo(segmentIndex, i)} itemKey={segment.key} onEdit={openEditor} />
                )}
                {/* What the congregation and livestream see, then where the lineup goes next: under the stage, so the side column stays the
                    editing tools and neither column runs on far past the other. */}
                <OutputsCard titleId="pw-outputs" />
                <div className="grid grid-cols-1 gap-5 @2xl/work:grid-cols-2">
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
                </div>
              </div>

              <aside className="flex min-w-0 flex-col gap-5">
                <SlideEditorCard
                  target={editTarget}
                  onOpenEditor={liveStep.current !== null ? () => openEditor(at.slide) : null}
                  number={at.slide + 1}
                  emptyHint={tg('consoleEditNone')}
                  // A picture has no words: the card editor still offers a text slide after it, and Delete.
                  fallback={<CardSlideHotEdit t={t} segmentIndex={segmentIndex} steps={steps} onAir={at.slide} showButtons editRequest={null} onEditHandled={() => {}} />}
                />
                <TypographyCard />
                <SecondaryControls />
              </aside>
            </div>
          </div>
        )}
      </div>

      {/* Scrolled away from the monitors, the slide on air docks in the corner with Back, Next, Edit and Blackout. */}
      <FloatingProgram
        anchor={monitorsRef}
        live={onAir}
        program={<PwStageFace shown={shownAt(session, deck, at)} />}
        counter={`${cuePad2(at.slide + 1)} / ${cuePad2(steps.length)}`}
        onBack={() => void stepLive(-1)}
        onNext={() => void stepLive(1)}
        backDisabled={atStart}
        nextDisabled={atEnd}
        onEdit={liveStep.current !== null ? () => openEditor(at.slide) : null}
        suspended={editing !== null}
      />
      {editing !== null && editingOpen && (
        <SlideEditorModal
          index={editing.slide}
          cueAt={cueAtIn(editingIndex)}
          title={session.segments[editingIndex]?.name ?? ''}
          onIndex={(i) => (editableIn(editingIndex)(i) ? setEditing({ segment: editing.segment, slide: i }) : undefined)}
          onClose={() => setEditing(null)}
          backdrop
        />
      )}
    </div>
  );
}
