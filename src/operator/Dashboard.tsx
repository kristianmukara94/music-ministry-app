import { ArrowRight, BookOpen, Eye, Film, ListOrdered, Megaphone, Monitor, MonitorPlay, Music, type LucideIcon } from 'lucide-react';
import type { Frame } from '../../shared/live.js';
import { dispatch, useLive } from '../live/store';
import { useT, type StringKey } from '../i18n/strings';
import { sundayCycle, weekdayCycle, liturgicalYear } from '../liturgy/lectionary';
import { setUi, type ViewKey } from '../state/ui';
import { BoothClock } from './BoothClock';
import { KeyboardMap } from './KeyboardMap';
import { Launchpad } from './Launchpad';
import { useNow } from './useNow';

// ── Header ────────────────────────────────────────────────────────────────

function Contours() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full text-fg opacity-[0.06]" viewBox="0 0 1200 200" preserveAspectRatio="none" aria-hidden>
      {Array.from({ length: 11 }, (_, i) => (
        <path key={i} fill="none" stroke="currentColor" strokeWidth="1"
          d={`M0 ${20 + i * 16} C 220 ${-20 + i * 22}, 430 ${130 + i * 6}, 660 ${40 + i * 15} S 1010 ${-30 + i * 24}, 1200 ${50 + i * 14}`} />
      ))}
    </svg>
  );
}

function ConsoleHeader() {
  const t = useT();
  const today = useNow();
  return (
    <section className="relative shrink-0 overflow-hidden rounded-xl border border-line bg-panel backdrop-blur-md px-5 pt-4 pb-3">
      <Contours />
      <div className="relative flex items-end justify-between gap-6">
        <div>
          <div className="text-[10px] font-bold tracking-widest text-accent/80 uppercase">{t('head.eyebrow')}</div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-fg">
            {t('head.welcomeTo')} <span className="text-accent">APCC</span>MMA
          </h1>
          <p className="mt-1 text-[11px] font-bold tracking-widest text-fg/50 uppercase">{t('head.parish')}</p>
          <p className="mt-1 text-xs leading-relaxed font-normal text-fg/60">{t('head.tagline')}</p>
        </div>
        <dl className="hidden shrink-0 gap-2 text-right xl:flex">
          {[
            [t('head.liturgicalYear'), String(liturgicalYear(today))],
            [t('head.sundayCycle'), sundayCycle(today)],
            [t('head.weekdayCycle'), weekdayCycle(today)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line-strong bg-canvas/60 px-3 py-2">
              <dt className="text-[9px] font-bold tracking-wider text-fg/40 uppercase">{label}</dt>
              <dd className="font-mono text-lg font-bold text-fg tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// ── Status cards ──────────────────────────────────────────────────────────

type BadgeTone = 'live' | 'off' | 'paused' | 'warn';

/** A status pill. LIVE glows green, OFF is grey, PAUSED is amber, DISCONNECTED is a muted amber. */
const BADGE_TONE: Record<BadgeTone, { dot: string; pill: string }> = {
  live: { dot: 'animate-pulse bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]', pill: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]' },
  off: { dot: 'bg-zinc-500', pill: 'border-white/10 bg-white/5 text-fg/50' },
  paused: { dot: 'bg-amber-300', pill: 'border-amber-400/40 bg-amber-400/15 text-amber-300' },
  warn: { dot: 'bg-amber-500/70', pill: 'border-amber-500/25 bg-amber-500/10 text-amber-400/80' },
};

function StatusBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold tracking-[0.14em] uppercase ${BADGE_TONE[tone].pill}`}>
      <span className={`size-1.5 rounded-full ${BADGE_TONE[tone].dot}`} aria-hidden />
      {label}
    </span>
  );
}

/** An interactive status widget: a state badge, what it is doing, and one action that changes it. */
function StatusWidget({ icon: Icon, eyebrow, tone, badge, detail, action, onAction }: {
  icon: LucideIcon; eyebrow: string; tone: BadgeTone; badge: string; detail: string; action: string; onAction: () => void;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-panel backdrop-blur-md px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid size-9 place-items-center rounded-md border border-line-strong">
          <Icon size={16} aria-hidden />
        </div>
        <StatusBadge tone={tone} label={badge} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold tracking-widest text-fg/50 uppercase">{eyebrow}</div>
        <div className="mt-1 truncate text-sm font-semibold text-fg/90">{detail}</div>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="mt-auto flex h-8 items-center justify-center rounded-md border border-line-strong bg-canvas/60 text-xs font-bold text-fg/80 transition hover:border-accent/60 hover:text-accent"
      >
        {action}
      </button>
    </article>
  );
}

const FRAME_LABEL: Record<Exclude<Frame['kind'], 'deck' | 'image' | 'text' | 'lyrics' | 'psalm' | 'rosary' | 'whiteboard' | 'pw'>, StringKey> = {
  idle: 'frame.idle',
  blackout: 'frame.blackout',
  welcome: 'frame.welcome',
  announcements: 'frame.announcements',
};

function StatusCards() {
  const t = useT();
  const { outputs, projector, lowerThird, queue } = useLive((s) => s.state);
  const showing =
    projector.live.kind === 'deck' || projector.live.kind === 'image' || projector.live.kind === 'text' || projector.live.kind === 'lyrics' || projector.live.kind === 'psalm'
      ? projector.live.title
      : projector.live.kind === 'rosary'
        ? projector.live.section
        : projector.live.kind === 'whiteboard'
          ? projector.live.slide.title
          : projector.live.kind === 'pw'
            ? projector.live.segmentName
            : t(FRAME_LABEL[projector.live.kind]);

  const projectorBadge: { tone: BadgeTone; label: string } = !outputs.projector
    ? { tone: 'off', label: t('status.off') }
    : projector.paused
      ? { tone: 'paused', label: t('status.paused') }
      : { tone: 'live', label: t('status.live') };
  const lowerBadge: { tone: BadgeTone; label: string } = lowerThird.live === null
    ? { tone: 'off', label: t('status.off') }
    : lowerThird.paused
      ? { tone: 'paused', label: t('status.paused') }
      : { tone: 'live', label: t('status.live') };
  const mirrorBadge: { tone: BadgeTone; label: string } = outputs.preview
    ? { tone: 'live', label: t('status.connected') }
    : { tone: 'warn', label: t('status.disconnected') };
  const queueBadge: { tone: BadgeTone; label: string } = queue.length > 0
    ? { tone: 'live', label: t('status.ready') }
    : { tone: 'off', label: t('status.empty') };

  return (
    <div className="grid shrink-0 grid-cols-2 gap-4 xl:grid-cols-4">
      <StatusWidget icon={Monitor} eyebrow={t('card.congregation')} tone={projectorBadge.tone} badge={projectorBadge.label}
        detail={outputs.projector ? `${t('card.showing')}: ${showing}` : t('card.projectorOff')}
        action={outputs.projector ? t('card.action.projectorOff') : t('card.action.projectorOn')}
        onAction={() => dispatch({ type: 'output/toggle', output: 'projector' })} />
      <StatusWidget icon={MonitorPlay} eyebrow={t('card.lowerThird')} tone={lowerBadge.tone} badge={lowerBadge.label}
        detail={lowerThird.live ? lowerThird.live.line1 : t('card.nothingShowing')}
        action={t('card.action.lowerThird')}
        onAction={() => dispatch({ type: 'lowerThird/toggle' })} />
      <StatusWidget icon={Eye} eyebrow={t('card.mirror')} tone={mirrorBadge.tone} badge={mirrorBadge.label}
        detail={t('card.preview')}
        action={outputs.preview ? t('card.action.mirrorClose') : t('card.action.mirrorOpen')}
        onAction={() => dispatch({ type: 'output/toggle', output: 'preview' })} />
      <StatusWidget icon={ListOrdered} eyebrow={t('card.queue')} tone={queueBadge.tone} badge={queueBadge.label}
        detail={`${queue.length} ${t('card.items')}`}
        action={t('card.action.viewQueue')}
        onAction={() => setUi({ queueOpen: true })} />
    </div>
  );
}

// ── Action center ─────────────────────────────────────────────────────────

const ACTIONS: { icon: LucideIcon; title: StringKey; desc: StringKey; view: ViewKey }[] = [
  { icon: BookOpen, title: 'act.lectionary', desc: 'act.lectionaryDesc', view: 'lectionary' },
  { icon: Music, title: 'act.hymns', desc: 'act.hymnsDesc', view: 'lyrics' },
  { icon: Megaphone, title: 'act.announcements', desc: 'act.announcementsDesc', view: 'announcements' },
  { icon: Film, title: 'act.media', desc: 'act.mediaDesc', view: 'media' },
];

function ActionCenter() {
  const t = useT();
  return (
    <section className="shrink-0">
      <div className="text-[10px] font-bold tracking-widest text-fg/50 uppercase">{t('act.eyebrow')}</div>
      <h2 className="mb-2.5 text-sm font-bold text-fg">{t('act.title')}</h2>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {ACTIONS.map(({ icon: Icon, title, desc, view }) => (
          <button key={view} type="button" onClick={() => setUi({ view })}
            className="group flex min-h-24 items-center gap-4 rounded-xl border border-line bg-panel backdrop-blur-md px-5 py-4 text-left transition hover:border-line-strong hover:bg-panel-2">
            <Icon size={26} strokeWidth={1.6} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-fg transition-colors group-hover:text-accent">{t(title)}</span>
              <span className="mt-0.5 block text-xs leading-relaxed font-normal text-fg/60">{t(desc)}</span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export function Dashboard() {
  return (
    <div className="flex min-h-full flex-col gap-4 p-5">
      <ConsoleHeader />
      <StatusCards />
      <ActionCenter />
      <div className="grid min-h-[264px] shrink-0 grid-cols-1 gap-4 min-[1180px]:flex-1 min-[1180px]:grid-cols-[1.1fr_1fr_1.55fr]">
        <BoothClock />
        <KeyboardMap />
        <Launchpad />
      </div>
    </div>
  );
}
