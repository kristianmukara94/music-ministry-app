import { useLayoutEffect, useRef, useState } from 'react';
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

const BASE =
  'relative flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';

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

const DISABLED = 'cursor-not-allowed opacity-50';

function ControlButton({
  label,
  tone,
  title,
  active = false,
  disabled = false,
  onClick,
}: {
  /** Kept so call sites can say what the control is. The top bar shows text only. */
  icon?: LucideIcon;
  label: string;
  tone: { idle: string; active: string };
  /** The tooltip. On a disabled control it says why the control is unavailable. */
  title?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
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
  const t = useT();
  const state = on ? t('status.live') : t('status.off');
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
      {label} <span aria-hidden>•</span> <span className="uppercase">{state}</span>
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
      title={on ? t('top.tipProjectorLive') : t('top.tipProjectorOff')}
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
      title={on ? t('top.tipRemoteLive') : t('top.tipRemoteOff')}
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

  // In a narrower window the overlay toggles drop to a second row. The divider that groups the two clusters would then be left hanging
  // at the end of the first row, so it is shown only while both clusters share a row.
  const controls = useRef<HTMLDivElement>(null);
  const state = useRef<HTMLDivElement>(null);
  const overlays = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const box = controls.current;
    if (!box) return;
    const measure = () => {
      if (state.current && overlays.current) setStacked(overlays.current.offsetTop > state.current.offsetTop + 4);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [promptChoice]);

  return (
    // pr-[144px] keeps the master switch clear of the Windows caption buttons (about 46px each).
    <header className={`relative z-20 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line bg-canvas py-1.5 pr-[144px] pl-4 select-none ${DRAG}`}>
      {/* At narrow widths the controls scroll sideways rather than being clipped. The projector switch stays in place. */}
      <div ref={controls} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Cluster 1: emergency and state controls. */}
        <div ref={state} role="group" aria-label={t('top.groupState')} className="flex items-center gap-1.5">
          {promptChoice === 'skip' && (
            <span role="status" className="flex h-9 items-center gap-2 rounded-full border border-fg/30 bg-panel-2 px-3.5 text-[11px] font-bold tracking-wider text-fg/80 uppercase">
              {t('top.projectorSkipped')}
              <button
                type="button"
                onClick={() => setUi({ projectorPromptChoice: 'ask' })}
                title={t('top.tipAskAgain')}
                className={`${NO_DRAG} rounded text-accent underline underline-offset-2 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none`}
              >
                {t('top.askAgain')}
              </button>
            </span>
          )}
          <ControlButton icon={Moon} label={t('top.blackout')} title={t('top.tipBlackout')} tone={EMERGENCY} active={liveKind === 'blackout'} onClick={liveCommands.blackout} />
          <ControlButton
            icon={projector.paused ? PlayCircle : PauseCircle}
            label={projector.paused ? t('top.resumeProjector') : t('top.pauseProjector')}
            title={!outputs.projector ? t('top.tipProjectorRequired') : projector.paused ? t('top.tipResumeProjector') : t('top.tipPauseProjector')}
            tone={OVERRIDE}
            active={projector.paused}
            disabled={!outputs.projector}
            onClick={() => dispatch({ type: 'projector/pause' })}
          />
          <ControlButton
            icon={lowerThird.paused ? PlayCircle : PauseCircle}
            label={lowerThird.paused ? t('top.resumeLowerThird') : t('top.pauseLowerThird')}
            title={lowerThird.live === null ? t('top.tipLowerThirdRequired') : lowerThird.paused ? t('top.tipResumeLowerThird') : t('top.tipPauseLowerThird')}
            tone={OVERRIDE}
            active={lowerThird.paused}
            disabled={lowerThird.live === null}
            onClick={() => dispatch({ type: 'lowerThird/pause' })}
          />
          <ControlButton icon={CircleStop} label={t('top.stop')} title={t('top.tipStop')} tone={OVERRIDE} onClick={() => dispatch({ type: 'stop' })} />
        </div>

        {!stacked && <Divider />}

        {/* Cluster 2: quick overlay toggles. Lit gold while showing. */}
        <div ref={overlays} role="group" aria-label={t('top.groupOverlays')} className="flex items-center gap-2">
          <ControlButton icon={Megaphone} label={t('top.announcements')} tone={TOGGLE} active={liveKind === 'announcements'} onClick={liveCommands.announcements} />
          <ControlButton icon={House} label={t('top.welcome')} tone={TOGGLE} active={liveKind === 'welcome'} onClick={liveCommands.welcome} />
          <ControlButton
            icon={MonitorPlay}
            label={t('top.lowerThird')}
            tone={TOGGLE}
            title={lowerThird.live !== null || lowerThird.staged !== null ? undefined : t('top.tipOpenLowerThird')}
            active={lowerThird.live !== null}
            onClick={() =>
              lowerThird.live !== null || lowerThird.staged !== null ? dispatch({ type: 'lowerThird/toggle' }) : setUi({ view: 'media' })
            }
          />
          <ControlButton icon={Eye} label={t('top.preview')} tone={PREVIEW_TONE} active={previewOpen} onClick={() => setUi({ previewOpen: !previewOpen })} />
        </div>
      </div>

      {/* Stays on the first row, level with the state controls, even when the overlay toggles wrap to a second row below them. */}
      <div className="ml-auto flex h-9 shrink-0 items-center gap-2 self-start">
        <RemoteMaster />
        <ProjectorMaster />
      </div>
    </header>
  );
}
