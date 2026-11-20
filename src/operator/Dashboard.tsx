import { ArrowRight, BookOpen, Eye, Film, ListOrdered, Megaphone, Monitor, MonitorPlay, Music, Play, SkipForward, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Frame } from '../../shared/live.js';
import { frameKey } from '../../shared/stage-plan-row.js';
import { dispatch, useLive } from '../live/store';
import { LICENSE_LOCKED_TIP, useProjectionLocked } from '../live/license';
import { DATE_LOCALES, useT, type StringKey } from '../i18n/strings';
import { sundayCycle, weekdayCycle, liturgicalYear } from '../liturgy/lectionary';
import { setUi, useUi, type ViewKey } from '../state/ui';
import { useChurchProfile } from '../context/ChurchProfileContext';
import { BoothClock } from './BoothClock';
import { KeyboardMap } from './KeyboardMap';
import { PreServiceWidget } from './PreServiceWidget';
import { SystemHealthPanel } from './SystemHealthPanel';
import { massOnScreen, nextPlayable, stageNext, startMass, takeStaged, usePlanList } from './dashboardQueue';
import { useNow } from './useNow';

// ── Header ────────────────────────────────────────────────────────────────

/** The greeting for the hour: morning to noon, afternoon to six, evening after. */
function greetingKey(hour: number): StringKey {
  return hour < 12 ? 'head.goodMorning' : hour < 18 ? 'head.goodAfternoon' : 'head.goodEvening';
}

function ConsoleHeader() {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const today = useNow();
  // "Thursday, 20 November 2026": the day the operator is preparing for, in the console's language.
  const dateLine = today.toLocaleDateString(DATE_LOCALES[lang], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // The parish and its ministry, from the profile. A save in Settings or the setup wizard shows here at once.
  const { churchName, ministryName } = useChurchProfile();
  const parishLine = [churchName, ministryName].filter(Boolean).join(' • ');
  return (
    <section className="flex shrink-0 items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-sm font-semibold tracking-wider text-accent uppercase short:text-xs">
          {t('head.eyebrow')}
          <span aria-hidden className="mx-2 text-faint">·</span>
          <span className="text-fg/85">{dateLine}</span>
        </div>
        {/* A greeting for the hour. The APCCMMA name already heads the sidebar, so the page title speaks to the operator instead. */}
        <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px] short:mt-0 short:text-[26px] short:xl:text-[28px]">
          {t(greetingKey(today.getHours()))}
        </h1>
        <p className="mt-1 text-sm leading-relaxed font-normal text-fg/70 short:mt-0 short:text-xs">
          <span className="font-semibold tracking-wide text-fg/85 uppercase">{parishLine}</span>
          <span aria-hidden className="mx-2 text-faint">·</span>
          {t('head.tagline')}
        </p>
      </div>
      <dl className="hidden shrink-0 gap-3 text-center lg:flex">
        {[
          [t('head.liturgicalYear'), String(liturgicalYear(today))],
          [t('head.sundayCycle'), sundayCycle(today)],
          [t('head.weekdayCycle'), weekdayCycle(today)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-[88px] rounded-lg border border-accent/50 bg-panel px-3 py-2 short:py-1">
            <dt className="text-[10px] font-medium tracking-wide text-fg/75 uppercase">{label}</dt>
            <dd className="font-mono text-3xl leading-tight font-bold text-fg tabular-nums short:text-2xl">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A section title with a hairline running out to the right edge. */
function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <h2 className="shrink-0 text-sm font-semibold tracking-wide text-fg/80 uppercase short:text-xs">{children}</h2>
      <span className="h-px flex-1 bg-line" aria-hidden />
    </div>
  );
}

// ── Status cards ──────────────────────────────────────────────────────────

type BadgeTone = 'live' | 'off' | 'paused' | 'warn' | 'empty' | 'idle';

/**
 * Status colours. LIVE is green, OFF is red, PAUSED and needs-action are amber, EMPTY is slate blue, and IDLE is quiet: an output that is
 * off and needs nothing (a lower third not in use, the mirror closed) does not glow beside the one that needs the operator.
 * `pill` is the outlined badge, `card` the tinted, glowing card around it and `word` the emphasised word of the main text.
 * The colours are theme tokens (ok, danger, warn, info), so each theme supplies a version that reads on its own background.
 */
const BADGE_TONE: Record<BadgeTone, { pill: string; card: string; word: string }> = {
  live: {
    pill: 'border-ok/60 bg-ok/15 text-ok',
    card: 'border-ok/60 bg-ok/[0.07] shadow-lg shadow-ok/10',
    word: 'text-ok',
  },
  off: {
    pill: 'border-danger/60 bg-danger/15 text-danger',
    card: 'border-danger/60 bg-danger/[0.07] shadow-lg shadow-danger/10',
    word: 'text-danger',
  },
  paused: {
    pill: 'border-warn/60 bg-warn/15 text-warn',
    card: 'border-warn/60 bg-warn/[0.07] shadow-lg shadow-warn/10',
    word: 'text-warn',
  },
  warn: {
    pill: 'border-warn/60 bg-warn/15 text-warn',
    card: 'border-warn/60 bg-warn/[0.07] shadow-lg shadow-warn/10',
    word: 'text-warn',
  },
  empty: {
    pill: 'border-info/60 bg-info/15 text-info',
    card: 'border-info/60 bg-info/[0.07] shadow-lg shadow-info/10',
    word: 'text-info',
  },
  idle: {
    pill: 'border-line bg-panel-2 text-muted',
    card: 'border-line bg-panel',
    word: 'text-muted',
  },
};

function StatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider uppercase ${BADGE_TONE[tone].pill}`}>
      {label}
    </span>
  );
}

/** The card's button. `primary` is the solid accent call to action, used when the safe next step is to switch something on. */
const CARD_BUTTON = {
  primary: 'bg-accent text-on-accent shadow-sm hover:brightness-110',
  ghost: 'border border-fg/15 bg-panel-2 text-fg hover:bg-fg/10',
};

/** The last word of a status line, set in the status colour: "Projector is off" with "off" in red. */
function EmphasisLast({ text, tone }: { text: string; tone: BadgeTone }) {
  const cut = text.lastIndexOf(' ');
  if (cut < 0) return <span className={BADGE_TONE[tone].word}>{text}</span>;
  return (
    <>
      {text.slice(0, cut + 1)}
      <span className={BADGE_TONE[tone].word}>{text.slice(cut + 1)}</span>
    </>
  );
}

/**
 * An interactive status widget: a header band with the name and a state badge, what the output is doing, and one action that
 * changes it. With `inlineBadge` the badge sits beside the main text instead of in the header.
 */
function StatusWidget({ icon: Icon, eyebrow, tone, badge, detail, emphasis = false, inlineBadge = false, action, onAction, actionLocked = false, primary = false, sub, footer }: {
  icon: LucideIcon; eyebrow: string; tone: BadgeTone; badge: string; detail: string; emphasis?: boolean; inlineBadge?: boolean;
  action?: string; onAction?: () => void; primary?: boolean;
  /** An expired license has closed this action. */
  actionLocked?: boolean;
  /** A line under the main text, such as the slide on screen. */
  sub?: ReactNode;
  /** Replaces the single action button, for a card with more than one action. */
  footer?: ReactNode;
}) {
  return (
    <article className={`flex flex-col overflow-hidden rounded-[10px] border ${BADGE_TONE[tone].card}`}>
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-fg/10 bg-fg/[0.05] px-4 py-2 short:min-h-8 short:py-1">
        <div className="flex min-w-0 items-center gap-2.5 text-fg/70">
          <Icon size={16} aria-hidden className="shrink-0" />
          <span className="truncate text-xs font-semibold tracking-wide uppercase">{eyebrow}</span>
        </div>
        {!inlineBadge && <StatusBadge tone={tone} label={badge} />}
      </header>
      <div className="flex min-h-[84px] flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 short:min-h-0 short:gap-y-0.5 short:py-2">
        <div className="min-w-0 truncate text-2xl leading-tight font-bold text-fg xl:text-[28px] short:text-xl short:xl:text-[22px]">
          {emphasis ? <EmphasisLast text={detail} tone={tone} /> : detail}
        </div>
        {inlineBadge && <StatusBadge tone={tone} label={badge} />}
        {sub && <div className="w-full min-w-0 truncate text-sm font-medium text-fg/70">{sub}</div>}
      </div>
      <div className="px-4 pb-4 short:pb-3">
        {footer ?? (
          <button
            type="button"
            onClick={onAction}
            disabled={actionLocked}
            title={actionLocked ? LICENSE_LOCKED_TIP : undefined}
            className={`flex h-10 w-full items-center justify-center rounded-md text-sm font-bold transition short:h-9 disabled:cursor-not-allowed disabled:opacity-50 ${CARD_BUTTON[primary ? 'primary' : 'ghost']}`}
          >
            {action}
          </button>
        )}
      </div>
    </article>
  );
}

const FRAME_LABEL: Record<Exclude<Frame['kind'], 'deck' | 'image' | 'text' | 'lyrics' | 'psalm' | 'rosary' | 'whiteboard' | 'pw'>, StringKey> = {
  idle: 'frame.idle',
  blackout: 'frame.blackout',
  // A black intro slide is a blank projector, so it shows the same label as a blackout.
  black: 'frame.blackout',
  welcome: 'frame.welcome',
  announcements: 'frame.announcements',
};

/** What a frame shows, in a few words: a slide's title, the Rosary's section, or the name of a screen (Blackout, Welcome). */
export function frameTitle(frame: Frame, t: (key: StringKey) => string): string {
  return frame.kind === 'deck' || frame.kind === 'image' || frame.kind === 'text' || frame.kind === 'lyrics' || frame.kind === 'psalm'
    ? frame.title
    : frame.kind === 'rosary'
      ? frame.section
      : frame.kind === 'whiteboard'
        ? frame.slide.title
        : frame.kind === 'pw'
          ? frame.segmentName
          : t(FRAME_LABEL[frame.kind]);
}

/**
 * The Holy Mass Queue card: how many items are loaded, the slide on screen (or staged) below that, and the Mass's own controls. Start Mass puts
 * the first item on screen and Stage Next stages the item after the queue's place, which Take Staged then puts up.
 */
function QueueCard() {
  const t = useT();
  const live = useLive((s) => s.state);
  const plans = usePlanList();
  const [busy, setBusy] = useState(false);
  // The item Stage Next staged, with the slide it staged. Take Staged is offered while that slide is still waiting under the live one.
  const [staged, setStaged] = useState<{ index: number; key: string } | null>(null);
  const { queue, queueCursor, projector } = live;
  const playable = queue.filter((q) => !q.stale).length;
  const onScreen = massOnScreen(live);
  const stagedKey = frameKey(projector.staged);
  const pending = staged !== null && staged.index === queueCursor && staged.key === stagedKey && stagedKey !== frameKey(projector.live);
  const next = nextPlayable(live);
  const planName = plans?.find((p) => p.id === live.queuePlanId)?.name ?? null;

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onStart = () =>
    run(async () => {
      const state = useLive.getState().state;
      if (massOnScreen(state)) {
        if (!window.confirm(t('queue.confirmRestart'))) return;
      } else if (state.outputs.projector && state.projector.live.kind !== 'idle' && state.projector.source !== 'MASS_QUEUE') {
        if (!window.confirm(t('queue.confirmReplace'))) return;
      }
      setStaged(null);
      await startMass(planName);
    });
  const onStageNext = () =>
    run(async () => {
      setStaged(await stageNext());
    });
  const onTake = () =>
    run(async () => {
      if (!staged) return;
      await takeStaged(staged.index);
      setStaged(null);
    });

  // The slide preview: the one on screen while the Mass has it, else the one staged, else where the queue stands.
  const current = queue[queueCursor];
  const sub = onScreen
    ? `${t('queue.onScreen')}: ${frameTitle(projector.live, t) || current?.label || ''}`
    : pending
      ? `${t('queue.staged')}: ${frameTitle(projector.staged, t) || current?.label || ''}`
      : queue.length > 0
        ? `${t('queue.next')}: ${next >= 0 ? queue[next].label : t('queue.endOfQueue')}`
        : t('queue.notStarted');

  const tone: BadgeTone = queue.length > 0 ? 'live' : 'empty';
  const btn = 'flex h-10 min-w-0 flex-1 items-center justify-center truncate rounded-md px-2 text-sm font-bold transition short:h-9 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <StatusWidget icon={ListOrdered} eyebrow={t('card.queue')} tone={tone} badge={queue.length > 0 ? t('status.ready') : t('status.empty')}
      detail={`${queue.length} ${t('card.items')}`}
      sub={<span title={sub}>{sub}</span>}
      footer={
        // The primary action has the full width, so "Start Holy Mass" fits a narrow card. Stage Next and View Queue share the row below.
        <div className="flex flex-col gap-2 short:gap-1.5">
          {pending ? (
            <button type="button" className={`${btn} w-full flex-none ${CARD_BUTTON.primary}`} disabled={busy} onClick={() => void onTake()}><Play size={14} aria-hidden fill="currentColor" className="mr-1.5 shrink-0" />{t('queue.takeStaged')}</button>
          ) : (
            <button type="button" className={`${btn} w-full flex-none ${CARD_BUTTON.primary}`} disabled={busy || playable === 0} onClick={() => void onStart()}><Play size={14} aria-hidden fill="currentColor" className="mr-1.5 shrink-0" />{t('queue.startMass')}</button>
          )}
          <div className="flex gap-2">
            <button type="button" className={`${btn} h-9 short:h-8 ${CARD_BUTTON.ghost}`} disabled={busy || next < 0} onClick={() => void onStageNext()}><SkipForward size={14} aria-hidden className="mr-1.5 shrink-0" />{t('queue.stageNext')}</button>
            <button type="button" className={`${btn} h-9 short:h-8 ${CARD_BUTTON.ghost}`} onClick={() => setUi({ view: 'goLive' })}>{t('card.action.viewQueue')}</button>
          </div>
        </div>
      } />
  );
}

function StatusCards() {
  const t = useT();
  const { outputs, projector, lowerThird } = useLive((s) => s.state);
  const showing = frameTitle(projector.live, t);

  const projectorBadge: { tone: BadgeTone; label: string } = !outputs.projector
    ? { tone: 'warn', label: t('status.off') }
    : projector.paused
      ? { tone: 'paused', label: t('status.paused') }
      : { tone: 'live', label: t('status.live') };
  // Toggle only works once a lower third has been shown or staged. Until then, the button opens the editor that makes one.
  const lowerReady = lowerThird.live !== null || lowerThird.staged !== null;
  const locked = useProjectionLocked();
  const lowerBadge: { tone: BadgeTone; label: string } = lowerThird.live === null
    ? { tone: 'idle', label: t('status.off') }
    : lowerThird.paused
      ? { tone: 'paused', label: t('status.paused') }
      : { tone: 'live', label: t('status.live') };
  const mirrorBadge: { tone: BadgeTone; label: string } = outputs.preview
    ? { tone: 'live', label: t('status.connected') }
    : { tone: 'idle', label: t('status.disconnected') };

  return (
    <div className="grid shrink-0 grid-cols-2 gap-4 xl:grid-cols-4 short:gap-3">
      <StatusWidget icon={Monitor} eyebrow={t('card.congregation')} tone={projectorBadge.tone} badge={projectorBadge.label}
        detail={outputs.projector ? `${t('card.showing')}: ${showing}` : t('card.projectorOff')}
        sub={outputs.projector ? undefined : t('card.hint.projectorOff')}
        emphasis={!outputs.projector}
        primary={!outputs.projector}
        action={outputs.projector ? t('card.action.projectorOff') : t('card.action.projectorOn')}
        actionLocked={locked && !outputs.projector}
        onAction={() => dispatch({ type: 'output/toggle', output: 'projector' })} />
      <StatusWidget icon={MonitorPlay} eyebrow={t('card.lowerThird')} tone={lowerBadge.tone} badge={lowerBadge.label}
        detail={lowerThird.live ? lowerThird.live.line1 : t('card.nothingShowing')}
        sub={lowerThird.live ? undefined : lowerReady ? t('card.hint.lowerThirdReady') : t('card.hint.lowerThirdNone')}
        action={lowerReady ? t('card.action.lowerThird') : t('card.action.lowerThirdSetup')}
        actionLocked={locked && lowerReady && lowerThird.live === null}
        onAction={() => (lowerReady ? dispatch({ type: 'lowerThird/toggle' }) : setUi({ view: 'media', pendingFocus: { kind: 'lowerThird' } }))} />
      <StatusWidget icon={Eye} eyebrow={t('card.mirror')} tone={mirrorBadge.tone} badge={mirrorBadge.label}
        detail={t('card.preview')}
        sub={outputs.preview ? t('card.hint.mirrorOpen') : t('card.hint.mirrorClosed')}
        action={outputs.preview ? t('card.action.mirrorClose') : t('card.action.mirrorOpen')}
        onAction={() => dispatch({ type: 'output/toggle', output: 'preview' })} />
      <QueueCard />
    </div>
  );
}

// ── Action center ─────────────────────────────────────────────────────────

/**
 * `hue` marks each destination: its icon tile and the stripe down the card's left edge. The card itself is the theme's panel, so the four
 * read as one set in every theme (light ones included) and the console's gold stays the only loud colour on the page.
 */
const ACTIONS: { icon: LucideIcon; title: StringKey; desc: StringKey; view: ViewKey; hue: string }[] = [
  { icon: BookOpen, title: 'act.lectionary', desc: 'act.lectionaryDesc', view: 'lectionary', hue: '#8b5cf6' },
  { icon: Music, title: 'act.hymns', desc: 'act.hymnsDesc', view: 'lyrics', hue: '#d97706' },
  { icon: Megaphone, title: 'act.announcements', desc: 'act.announcementsDesc', view: 'announcements', hue: '#e11d48' },
  { icon: Film, title: 'act.media', desc: 'act.mediaDesc', view: 'media', hue: '#0284c7' },
];

function ActionCenter() {
  const t = useT();
  return (
    <section className="flex shrink-0 flex-col gap-3 short:gap-1.5">
      <SectionHeading>{t('act.eyebrow')} / {t('act.title')}</SectionHeading>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4 short:gap-3">
        {/* Every title is one line (whitespace-nowrap, cut with an ellipsis only if a translation is too long) and every description
            takes the same fixed number of lines, so all four cards share their title and description baselines. */}
        {ACTIONS.map(({ icon: Icon, title, desc, view, hue }) => (
          <button key={view} type="button" onClick={() => setUi({ view })} title={`${t(title)} — ${t(desc)}`}
            style={{ borderLeftColor: hue }}
            className="group flex min-h-[88px] items-center gap-3 rounded-[10px] border border-l-4 border-line bg-panel px-3.5 py-3 text-left transition hover:-translate-y-px hover:border-accent/50 hover:bg-panel-2 hover:shadow-lg hover:shadow-black/20 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none short:min-h-0 short:py-2.5">
            <span className="grid shrink-0 place-items-center rounded-xl p-2.5 short:p-2" style={{ color: hue, background: `color-mix(in oklab, ${hue} 16%, transparent)` }}>
              <Icon size={24} strokeWidth={1.7} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span data-testid="action-title" className="block truncate text-[15px] leading-tight font-semibold whitespace-nowrap text-fg 2xl:text-base">{t(title)}</span>
              <span className="mt-0.5 line-clamp-2 h-[2lh] text-xs leading-snug font-normal text-muted short:line-clamp-1 short:h-[1lh]">{t(desc)}</span>
            </span>
            {/* The arrow only where the card has room for it beside a one-line title. */}
            <ArrowRight size={18} className="hidden shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-accent 2xl:block" aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export function Dashboard() {
  const t = useT();
  return (
    // On a 900px-or-shorter window (1366x768, 1440x820) the `short:` spacing keeps all four tiers, the bottom row included, on screen.
    <div className="flex min-h-full flex-col gap-5 p-5 pb-6 short:gap-2 short:px-4 short:pt-1 short:pb-2">
      <ConsoleHeader />
      <PreServiceWidget />
      <section className="flex shrink-0 flex-col gap-3 short:gap-1.5">
        <SectionHeading>{t('card.sectionTitle')}</SectionHeading>
        <StatusCards />
      </section>
      <ActionCenter />
      <div className="grid min-h-[264px] shrink-0 grid-cols-1 gap-4 min-[1180px]:flex-1 min-[1180px]:grid-cols-3 short:min-h-[152px] short:gap-3">
        <BoothClock />
        <KeyboardMap />
        <SystemHealthPanel />
      </div>
    </div>
  );
}
