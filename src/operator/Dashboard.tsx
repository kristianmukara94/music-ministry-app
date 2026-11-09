import { ArrowRight, BookOpen, Eye, Film, ListOrdered, Megaphone, Monitor, MonitorPlay, Music, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Frame } from '../../shared/live.js';
import { frameKey } from '../../shared/stage-plan-row.js';
import { dispatch, useLive } from '../live/store';
import { LICENSE_LOCKED_TIP, useProjectionLocked } from '../live/license';
import { useT, type StringKey } from '../i18n/strings';
import { sundayCycle, weekdayCycle, liturgicalYear } from '../liturgy/lectionary';
import { setUi, type ViewKey } from '../state/ui';
import { BoothClock } from './BoothClock';
import { KeyboardMap } from './KeyboardMap';
import { PreServiceWidget } from './PreServiceWidget';
import { SystemHealthPanel } from './SystemHealthPanel';
import { massOnScreen, nextPlayable, stageNext, startMass, takeStaged, usePlanList } from './dashboardQueue';
import { useNow } from './useNow';

// ── Header ────────────────────────────────────────────────────────────────

function ConsoleHeader() {
  const t = useT();
  const today = useNow();
  return (
    <section className="flex shrink-0 items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-sm font-semibold tracking-wider text-accent uppercase">{t('head.eyebrow')}</div>
        <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">
          {t('head.welcomeTo')} APCCMMA
        </h1>
        <p className="mt-1 text-sm leading-relaxed font-normal text-fg/70">
          <span className="uppercase">{t('head.parish')}</span> - {t('head.tagline')}
        </p>
      </div>
      <dl className="hidden shrink-0 gap-3 text-center lg:flex">
        {[
          [t('head.liturgicalYear'), String(liturgicalYear(today))],
          [t('head.sundayCycle'), sundayCycle(today)],
          [t('head.weekdayCycle'), weekdayCycle(today)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-[88px] rounded-lg border border-accent/50 bg-panel px-3 py-2">
            <dt className="text-[10px] font-medium tracking-wide text-fg/75 uppercase">{label}</dt>
            <dd className="font-mono text-3xl leading-tight font-bold text-fg tabular-nums">{value}</dd>
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
      <h2 className="shrink-0 text-sm font-semibold tracking-wide text-fg/80 uppercase">{children}</h2>
      <span className="h-px flex-1 bg-line" aria-hidden />
    </div>
  );
}

// ── Status cards ──────────────────────────────────────────────────────────

type BadgeTone = 'live' | 'off' | 'paused' | 'warn' | 'empty';

/**
 * Status colours. LIVE is green, OFF is red, PAUSED and DISCONNECTED are amber, and EMPTY is slate blue.
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
};

function StatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider uppercase ${BADGE_TONE[tone].pill}`}>
      {label}
    </span>
  );
}

/** The card's button. `primary` is the solid cream call to action, used when the safe next step is to switch something on. */
const CARD_BUTTON = {
  primary: 'bg-fg text-canvas hover:brightness-110',
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
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-fg/10 bg-fg/[0.05] px-4 py-2">
        <div className="flex min-w-0 items-center gap-2.5 text-fg/70">
          <Icon size={16} aria-hidden className="shrink-0" />
          <span className="truncate text-xs font-semibold tracking-wide uppercase">{eyebrow}</span>
        </div>
        {!inlineBadge && <StatusBadge tone={tone} label={badge} />}
      </header>
      <div className="flex min-h-[84px] flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <div className="min-w-0 truncate text-2xl leading-tight font-bold text-fg xl:text-[28px]">
          {emphasis ? <EmphasisLast text={detail} tone={tone} /> : detail}
        </div>
        {inlineBadge && <StatusBadge tone={tone} label={badge} />}
        {sub && <div className="w-full min-w-0 truncate text-sm font-medium text-fg/70">{sub}</div>}
      </div>
      <div className="px-4 pb-4">
        {footer ?? (
          <button
            type="button"
            onClick={onAction}
            disabled={actionLocked}
            title={actionLocked ? LICENSE_LOCKED_TIP : undefined}
            className={`flex h-10 w-full items-center justify-center rounded-md text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${CARD_BUTTON[primary ? 'primary' : 'ghost']}`}
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
  const btn = 'flex h-10 min-w-0 flex-1 items-center justify-center truncate rounded-md px-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <StatusWidget icon={ListOrdered} eyebrow={t('card.queue')} tone={tone} badge={queue.length > 0 ? t('status.ready') : t('status.empty')}
      detail={`${queue.length} ${t('card.items')}`}
      sub={<span title={sub}>{sub}</span>}
      footer={
        // The primary action has the full width, so "Start Holy Mass" fits a narrow card. Stage Next and View Queue share the row below.
        <div className="flex flex-col gap-2">
          {pending ? (
            <button type="button" className={`${btn} w-full flex-none ${CARD_BUTTON.primary}`} disabled={busy} onClick={() => void onTake()}>{t('queue.takeStaged')}</button>
          ) : (
            <button type="button" className={`${btn} w-full flex-none ${CARD_BUTTON.primary}`} disabled={busy || playable === 0} onClick={() => void onStart()}>{t('queue.startMass')}</button>
          )}
          <div className="flex gap-2">
            <button type="button" className={`${btn} h-9 ${CARD_BUTTON.ghost}`} disabled={busy || next < 0} onClick={() => void onStageNext()}>{t('queue.stageNext')}</button>
            <button type="button" className={`${btn} h-9 ${CARD_BUTTON.ghost}`} onClick={() => setUi({ view: 'goLive' })}>{t('card.action.viewQueue')}</button>
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
    ? { tone: 'off', label: t('status.off') }
    : projector.paused
      ? { tone: 'paused', label: t('status.paused') }
      : { tone: 'live', label: t('status.live') };
  // Toggle only works once a lower third has been shown or staged. Until then, the button opens the editor that makes one.
  const lowerReady = lowerThird.live !== null || lowerThird.staged !== null;
  const locked = useProjectionLocked();
  const lowerBadge: { tone: BadgeTone; label: string } = lowerThird.live === null
    ? { tone: 'off', label: t('status.off') }
    : lowerThird.paused
      ? { tone: 'paused', label: t('status.paused') }
      : { tone: 'live', label: t('status.live') };
  const mirrorBadge: { tone: BadgeTone; label: string } = outputs.preview
    ? { tone: 'live', label: t('status.connected') }
    : { tone: 'warn', label: t('status.disconnected') };

  return (
    <div className="grid shrink-0 grid-cols-2 gap-4 xl:grid-cols-4">
      <StatusWidget icon={Monitor} eyebrow={t('card.congregation')} tone={projectorBadge.tone} badge={projectorBadge.label}
        detail={outputs.projector ? `${t('card.showing')}: ${showing}` : t('card.projectorOff')}
        emphasis={!outputs.projector}
        primary={!outputs.projector}
        action={outputs.projector ? t('card.action.projectorOff') : t('card.action.projectorOn')}
        actionLocked={locked && !outputs.projector}
        onAction={() => dispatch({ type: 'output/toggle', output: 'projector' })} />
      <StatusWidget icon={MonitorPlay} eyebrow={t('card.lowerThird')} tone={lowerBadge.tone} badge={lowerBadge.label}
        detail={lowerThird.live ? lowerThird.live.line1 : t('card.nothingShowing')}
        action={lowerReady ? t('card.action.lowerThird') : t('card.action.lowerThirdSetup')}
        actionLocked={locked && lowerReady && lowerThird.live === null}
        onAction={() => (lowerReady ? dispatch({ type: 'lowerThird/toggle' }) : setUi({ view: 'media' }))} />
      <StatusWidget icon={Eye} eyebrow={t('card.mirror')} tone={mirrorBadge.tone} badge={mirrorBadge.label} inlineBadge
        detail={t('card.preview')}
        action={outputs.preview ? t('card.action.mirrorClose') : t('card.action.mirrorOpen')}
        onAction={() => dispatch({ type: 'output/toggle', output: 'preview' })} />
      <QueueCard />
    </div>
  );
}

// ── Action center ─────────────────────────────────────────────────────────

/** `from` and `to` are the two ends of the card's 135-degree gradient. The cards are fully saturated, with a glassy icon tile. */
const ACTIONS: { icon: LucideIcon; title: StringKey; desc: StringKey; view: ViewKey; from: string; to: string }[] = [
  { icon: BookOpen, title: 'act.lectionary', desc: 'act.lectionaryDesc', view: 'lectionary', from: '#7c3aed', to: '#2563eb' },
  { icon: Music, title: 'act.hymns', desc: 'act.hymnsDesc', view: 'lyrics', from: '#d97706', to: '#78350f' },
  { icon: Megaphone, title: 'act.announcements', desc: 'act.announcementsDesc', view: 'announcements', from: '#e11d48', to: '#9f1239' },
  { icon: Film, title: 'act.media', desc: 'act.mediaDesc', view: 'media', from: '#0284c7', to: '#0369a1' },
];

function ActionCenter() {
  const t = useT();
  return (
    <section className="flex shrink-0 flex-col gap-3">
      <SectionHeading>{t('act.eyebrow')} / {t('act.title')}</SectionHeading>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {ACTIONS.map(({ icon: Icon, title, desc, view, from, to }) => (
          <button key={view} type="button" onClick={() => setUi({ view })}
            style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
            className="group flex min-h-[104px] items-center gap-4 rounded-[10px] border border-white/25 px-4 py-4 text-left shadow-lg shadow-black/30 transition hover:brightness-110">
            <span className="grid shrink-0 place-items-center rounded-xl bg-white/15 p-3 text-white ring-1 ring-white/25">
              <Icon size={30} strokeWidth={1.7} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xl leading-tight font-semibold text-white">{t(title)}</span>
              <span className="mt-1 block text-xs leading-snug font-normal text-white/80">{t(desc)}</span>
            </span>
            <ArrowRight size={20} className="shrink-0 text-white transition group-hover:translate-x-0.5" aria-hidden />
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
    <div className="flex min-h-full flex-col gap-5 p-5 pb-6">
      <ConsoleHeader />
      <PreServiceWidget />
      <section className="flex shrink-0 flex-col gap-3">
        <SectionHeading>{t('card.sectionTitle')}</SectionHeading>
        <StatusCards />
      </section>
      <ActionCenter />
      <div className="grid min-h-[264px] shrink-0 grid-cols-1 gap-4 min-[1180px]:flex-1 min-[1180px]:grid-cols-3">
        <BoothClock />
        <KeyboardMap />
        <SystemHealthPanel />
      </div>
    </div>
  );
}
