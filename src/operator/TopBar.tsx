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

const BASE = 'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium transition-all duration-200';

/** Blackout: a solid gold button, the one control that must always be easy to find. Dark red and breathing while the screen is black. */
const EMERGENCY = {
  idle: 'rounded-md border border-accent/60 bg-accent px-4 py-1.5 text-sm font-extrabold tracking-wide text-on-accent uppercase shadow-[0_0_14px_color-mix(in_oklab,var(--color-accent)_35%,transparent)] hover:brightness-110',
  active: 'blackout-breathe rounded-md border border-danger bg-danger/20 px-4 py-1.5 font-extrabold tracking-wide uppercase text-danger',
};

/**
 * Overlay toggles: plain text until one is showing, then its border and glow light up gold, so the operator sees at a glance
 * what the congregation is seeing.
 */
const TOGGLE = {
  idle: 'rounded-md border border-transparent px-3 py-1.5 text-fg/85 hover:bg-fg/[0.07] hover:text-fg',
  active:
    'rounded-md border border-accent/70 bg-accent/15 px-3 py-1.5 text-accent ring-1 ring-accent/30 shadow-[0_0_14px_color-mix(in_oklab,var(--color-accent)_45%,transparent)]',
};

/** Playback overrides: dark ghost buttons that brighten on hover. */
const OVERRIDE = {
  idle: 'rounded-md border border-fg/15 bg-panel-2 px-3 py-1.5 text-fg/85 hover:bg-fg/10 hover:text-fg',
  active: 'rounded-md border border-accent/50 bg-panel-2 px-3 py-1.5 text-accent',
};

/** The Preview button: a gold outline and glow while the floating preview is open, the muted dark pill otherwise. */
const PREVIEW_TONE = {
  idle: 'rounded-md border border-transparent px-3 py-1.5 text-fg/85 hover:bg-fg/[0.07] hover:text-fg',
  active: 'rounded-md border border-accent/60 bg-accent/20 px-3 py-1.5 text-accent shadow-[0_0_12px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]',
};

const DISABLED = 'cursor-not-allowed opacity-40';

function ControlButton({
  label,
  tone,
  active = false,
  disabled = false,
  onClick,
}: {
  /** Kept so call sites can say what the control is. The top bar shows text only. */
  icon?: LucideIcon;
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
      <span>{label}</span>
    </button>
  );
}

/**
 * A master switch: a pill with a dot, green and LIVE when on, red and OFF when off. The Projector and Remote switches
 * both use it, so they look the same.
 */
function MasterSwitch({ on, label, title, onClick }: { on: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      onClick={onClick}
      className={`${BASE} ${NO_DRAG} rounded-full border px-3.5 py-1.5 tracking-wide ${
        on
          ? 'border-ok/50 bg-ok/15 text-ok hover:bg-ok/25'
          : 'border-danger/50 bg-danger/15 text-danger hover:bg-danger/25'
      }`}
    >
      <span
        className={`size-2 shrink-0 rounded-full ${on ? 'animate-pulse bg-ok shadow-[0_0_6px_var(--color-ok)]' : 'bg-danger'}`}
        aria-hidden
      />
      {label} • {on ? 'LIVE' : 'OFF'}
    </button>
  );
}

/** The projector switch: turning it on opens the local Projector window. */
function ProjectorMaster() {
  const on = useLive((s) => s.state.outputs.projector);
  const t = useT();
  return (
    <MasterSwitch
      on={on}
      label={t('top.projector')}
      title={on ? 'Projector is live. Click to turn off.' : 'Projector is off. Click to turn on.'}
      onClick={() => dispatch({ type: 'output/toggle', output: 'projector' })}
    />
  );
}

/**
 * The Remote switch: starts and stops the Secondary stream that TV and phone viewers on the network see. It never opens or closes
 * the local Projector window.
 */
function RemoteMaster() {
  const on = useLive((s) => s.state.display.targets.secondary.live);
  const t = useT();
  return (
    <MasterSwitch
      on={on}
      label={t('top.remote')}
      title={on ? 'Remote is live on the network. Click to stop.' : 'Remote is off. Click to send the screen to TV and phone viewers.'}
      onClick={() => dispatch({ type: 'display/live', value: !on })}
    />
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
    <header className={`relative z-20 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line bg-canvas py-1.5 pr-[144px] pl-4 select-none ${DRAG}`}>
      {/* At narrow widths the controls scroll sideways rather than being clipped. The projector switch stays in place. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Cluster 1: emergency and state controls. */}
        <div role="group" aria-label={t('top.groupState')} className="flex items-center gap-1.5">
          {promptChoice === 'skip' && (
            <span role="status" className="flex h-8 items-center gap-2 rounded-full border border-fg/30 bg-panel-2 px-3 text-[11px] font-bold tracking-wider text-fg/80 uppercase">
              Projector: skipped
              <button
                type="button"
                onClick={() => setUi({ projectorPromptChoice: 'ask' })}
                className="text-accent underline underline-offset-2 hover:brightness-110"
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

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <RemoteMaster />
        <ProjectorMaster />
      </div>
    </header>
  );
}
