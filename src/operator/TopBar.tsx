import { CircleStop, Eye, House, Megaphone, Moon, MonitorPlay, PauseCircle, PlayCircle, type LucideIcon } from 'lucide-react';
import { dispatch, useLive } from '../live/store';
import { useT } from '../i18n/strings';
import { setUi, useUi } from '../state/ui';
import { liveCommands } from './actions';

/**
 * The header is the window's drag area, because the native title bar is hidden (see main.js). Buttons opt
 * out so they still click. The right edge is left clear for the Windows minimise, maximise and close buttons.
 */
const DRAG = '[-webkit-app-region:drag]';
const NO_DRAG = '[-webkit-app-region:no-drag]';

const BASE = 'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold transition-all duration-200';

/** Blackout: a dark red accent when the screen is black, so it reads as a state and not as a warning. */
const EMERGENCY = {
  idle: 'rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-red-400 hover:bg-red-500/20',
  active: 'blackout-breathe rounded-full border border-red-900 bg-red-950/80 px-3 py-1.5 text-red-300 shadow-[inset_0_0_12px_rgba(127,29,29,0.6)]',
};

/**
 * Overlay toggles. While one is showing, its border and glow light up gold, so the operator sees at a glance
 * what the congregation is seeing.
 */
const TOGGLE = {
  idle: 'rounded-md border border-line bg-white/5 px-3 py-1.5 text-fg/80 hover:bg-white/10',
  active:
    'rounded-md border border-accent/70 bg-accent/15 px-3 py-1.5 text-accent ring-1 ring-accent/30 shadow-[0_0_14px_color-mix(in_oklab,var(--color-accent)_45%,transparent)]',
};

/** Playback overrides: muted text that brightens on hover. */
const OVERRIDE = {
  idle: 'rounded-md px-3 py-1.5 text-fg/60 hover:text-fg',
  active: 'rounded-md px-3 py-1.5 text-accent',
};

/** The Preview button: a gold outline and glow while the floating preview is open, the muted dark pill otherwise. */
const PREVIEW_TONE = {
  idle: 'rounded-md border border-stone-800 bg-stone-900 px-3 py-1.5 text-stone-300 hover:text-stone-100',
  active: 'rounded-md border border-amber-500/50 bg-amber-500/20 px-3 py-1.5 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.35)]',
};

const DISABLED = 'cursor-not-allowed opacity-40';

function ControlButton({
  icon: Icon,
  label,
  tone,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  tone: { idle: string; active: string };
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`${BASE} ${NO_DRAG} ${active ? tone.active : tone.idle} ${disabled ? DISABLED : ''}`}
    >
      <Icon size={13} strokeWidth={2.25} aria-hidden className="shrink-0" />
      <span>{label}</span>
    </button>
  );
}

/** The master gatekeeper: the projector switch, flush right. Green dot and LIVE when on, muted grey and OFF when off. */
function ProjectorMaster() {
  const on = useLive((s) => s.state.outputs.projector);
  const t = useT();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={on ? 'Projector is live. Click to turn off.' : 'Projector is off. Click to turn on.'}
      onClick={() => dispatch({ type: 'output/toggle', output: 'projector' })}
      className={`${BASE} ${NO_DRAG} rounded-full border px-3.5 py-1.5 tracking-wide ${
        on
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_14px_rgba(16,185,129,0.3)]'
          : 'border-line bg-white/5 text-fg/50 hover:text-fg/70'
      }`}
    >
      <span
        className={`size-2 shrink-0 rounded-full ${on ? 'animate-pulse bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]' : 'bg-zinc-500'}`}
        aria-hidden
      />
      {t('top.projector')} · {on ? 'LIVE' : 'OFF'}
    </button>
  );
}

/** A thin vertical rule between the two clusters. Subtle on purpose: it groups, it does not decorate. */
const Divider = () => <span className="h-5 w-px shrink-0 bg-fg/10" aria-hidden />;

export function TopBar() {
  const t = useT();
  const { outputs, projector, lowerThird } = useLive((s) => s.state);
  const liveKind = projector.live.kind;
  const previewOpen = useUi((s) => s.previewOpen);
  const promptChoice = useUi((s) => s.projectorPromptChoice);

  return (
    // pr-[144px] keeps the master switch clear of the Windows caption buttons (about 46px each).
    <header className={`relative z-20 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line bg-canvas/80 py-1.5 pr-[144px] pl-4 backdrop-blur-md select-none ${DRAG}`}>
      {/* At narrow widths the controls scroll sideways rather than being clipped. The projector switch stays in place. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Cluster 1: emergency and state controls. */}
        <div role="group" aria-label={t('top.groupState')} className="flex items-center gap-1.5">
          {promptChoice === 'skip' && (
            <span role="status" className="flex h-8 items-center gap-2 rounded-full border border-stone-600 bg-stone-900/80 px-3 text-[11px] font-bold tracking-wider text-stone-300 uppercase">
              Projector: skipped
              <button
                type="button"
                onClick={() => setUi({ projectorPromptChoice: 'ask' })}
                className="text-amber-300 underline underline-offset-2 hover:text-amber-200"
              >
                Ask again
              </button>
            </span>
          )}
          <ControlButton icon={Moon} label={t('top.blackout')} tone={EMERGENCY} active={liveKind === 'blackout'} onClick={liveCommands.blackout} />
          <ControlButton
            icon={projector.paused ? PlayCircle : PauseCircle}
            label={projector.paused ? t('top.resumeProjector') : t('top.pauseProjector')}
            tone={OVERRIDE}
            active={projector.paused}
            disabled={!outputs.projector}
            onClick={() => dispatch({ type: 'projector/pause' })}
          />
          <ControlButton
            icon={lowerThird.paused ? PlayCircle : PauseCircle}
            label={lowerThird.paused ? t('top.resumeLowerThird') : t('top.pauseLowerThird')}
            tone={OVERRIDE}
            active={lowerThird.paused}
            disabled={lowerThird.live === null}
            onClick={() => dispatch({ type: 'lowerThird/pause' })}
          />
          <ControlButton icon={CircleStop} label={t('top.stop')} tone={OVERRIDE} onClick={() => dispatch({ type: 'stop' })} />
        </div>

        <Divider />

        {/* Cluster 2: quick overlay toggles. Lit gold while showing. */}
        <div role="group" aria-label={t('top.groupOverlays')} className="flex items-center gap-2">
          <ControlButton icon={Megaphone} label={t('top.announcements')} tone={TOGGLE} active={liveKind === 'announcements'} onClick={liveCommands.announcements} />
          <ControlButton icon={House} label={t('top.welcome')} tone={TOGGLE} active={liveKind === 'welcome'} onClick={liveCommands.welcome} />
          <ControlButton
            icon={MonitorPlay}
            label={t('top.lowerThird')}
            tone={TOGGLE}
            active={lowerThird.live !== null}
            onClick={() => dispatch({ type: 'lowerThird/toggle' })}
          />
          <ControlButton icon={Eye} label={t('top.preview')} tone={PREVIEW_TONE} active={previewOpen} onClick={() => setUi({ previewOpen: !previewOpen })} />
        </div>
      </div>

      <div className="ml-auto shrink-0">
        <ProjectorMaster />
      </div>
    </header>
  );
}
