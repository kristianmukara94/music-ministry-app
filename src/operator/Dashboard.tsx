import { ArrowRight, BookOpen, Eye, Film, ListOrdered, Megaphone, Monitor, MonitorPlay, Music, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
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
function StatusWidget({ icon: Icon, eyebrow, tone, badge, detail, emphasis = false, inlineBadge = false, action, onAction, primary = false }: {
  icon: LucideIcon; eyebrow: string; tone: BadgeTone; badge: string; detail: string; emphasis?: boolean; inlineBadge?: boolean;
  action: string; onAction: () => void; primary?: boolean;
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
      </div>
      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={onAction}
          className={`flex h-10 w-full items-center justify-center rounded-md text-sm font-bold transition ${CARD_BUTTON[primary ? 'primary' : 'ghost']}`}
        >
          {action}
        </button>
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
    : { tone: 'empty', label: t('status.empty') };

  return (
    <div className="grid shrink-0 grid-cols-2 gap-4 xl:grid-cols-4">
      <StatusWidget icon={Monitor} eyebrow={t('card.congregation')} tone={projectorBadge.tone} badge={projectorBadge.label}
        detail={outputs.projector ? `${t('card.showing')}: ${showing}` : t('card.projectorOff')}
        emphasis={!outputs.projector}
        primary={!outputs.projector}
        action={outputs.projector ? t('card.action.projectorOff') : t('card.action.projectorOn')}
        onAction={() => dispatch({ type: 'output/toggle', output: 'projector' })} />
      <StatusWidget icon={MonitorPlay} eyebrow={t('card.lowerThird')} tone={lowerBadge.tone} badge={lowerBadge.label}
        detail={lowerThird.live ? lowerThird.live.line1 : t('card.nothingShowing')}
        action={t('card.action.lowerThird')}
        onAction={() => dispatch({ type: 'lowerThird/toggle' })} />
      <StatusWidget icon={Eye} eyebrow={t('card.mirror')} tone={mirrorBadge.tone} badge={mirrorBadge.label} inlineBadge
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
      <section className="flex shrink-0 flex-col gap-3">
        <SectionHeading>{t('card.sectionTitle')}</SectionHeading>
        <StatusCards />
      </section>
      <ActionCenter />
      <div className="grid min-h-[264px] shrink-0 grid-cols-1 gap-4 min-[1180px]:flex-1 min-[1180px]:grid-cols-3">
        <BoothClock />
        <KeyboardMap />
        <Launchpad />
      </div>
    </div>
  );
}
