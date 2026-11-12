import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Image as WelcomeIcon, Megaphone, Monitor, MonitorOff, Pause, Play, Square, Tag, type LucideIcon } from 'lucide-react';
import { dispatch, useLive } from '../live/store';
import { LICENSE_LOCKED_TIP, useProjectionLocked } from '../live/license';
import { useT } from '../i18n/strings';
import { setUi, useUi } from '../state/ui';
import { displayCombo } from '../../shared/shortcuts.js';
import type { ShortcutActionId } from './shortcuts';
import { liveCommands, stepWelcomeSlide, welcomeSlidePosition } from './actions';

/**
 * The header is the window's drag area, because the native title bar is hidden (see main.js). Buttons opt
 * out so they still click. The right edge is left clear for the Windows minimise, maximise and close buttons.
 *
 * Three zones, left to right:
 *   A. Master output and safety transport: Blackout, Pause Projector, Pause Lower 3rd, Stop.
 *   B. Live outputs (Welcome Screen, Announcements, Lower 3rd) | workspace views (Preview).
 *   C. Hardware and connection switches: Remote, Projector.
 */
const DRAG = '[-webkit-app-region:drag]';
const NO_DRAG = '[-webkit-app-region:no-drag]';

const BASE =
  'relative flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';

type Tone = { idle: string; active: string };

/** Blackout: a solid gold button, the one control that must always be easy to find. Dark red and breathing while the screen is black. */
const EMERGENCY: Tone = {
  idle: 'rounded-md border border-accent/60 bg-accent px-3.5 py-1.5 text-sm font-extrabold tracking-wide text-on-accent uppercase shadow-[0_0_14px_color-mix(in_oklab,var(--color-accent)_35%,transparent)] hover:brightness-110',
  active: 'blackout-breathe rounded-md border border-danger bg-danger/20 px-3.5 py-1.5 font-extrabold tracking-wide uppercase text-danger',
};

/** The shared button chrome: a faint surface, a one-pixel border, icon and label. Every non-emergency control starts from it. */
const CHROME = 'rounded-md border border-line-strong bg-panel-2 px-3 py-1.5 text-fg/90 hover:border-fg/30 hover:bg-fg/[0.08] hover:text-fg';

/** Pause switches: amber while the output is frozen, so a paused screen never passes for a live one. */
const PAUSE: Tone = {
  idle: CHROME,
  active: 'rounded-md border border-warn/70 bg-warn/15 px-3 py-1.5 font-semibold text-warn ring-1 ring-warn/30 hover:bg-warn/25',
};

/** Stop: an ordinary button that warns in red on hover, because it clears the projector. */
const STOP: Tone = {
  idle: 'rounded-md border border-line-strong bg-panel-2 px-3 py-1.5 text-fg/90 hover:border-danger/60 hover:bg-danger/10 hover:text-danger',
  active: '',
};

/** Live outputs: the chrome until one is showing, then gold with a glow, so the operator sees at a glance what the congregation sees. */
const OUTPUT: Tone = {
  idle: CHROME,
  active:
    'rounded-md border border-accent/70 bg-accent/15 px-3 py-1.5 text-accent ring-1 ring-accent/30 shadow-[0_0_14px_color-mix(in_oklab,var(--color-accent)_45%,transparent)]',
};

/** Workspace views open a window or panel in the booth only. Lit in the info colour, not gold, because nothing goes on air. */
const VIEW: Tone = {
  idle: CHROME,
  active: 'rounded-md border border-info/60 bg-info/15 px-3 py-1.5 text-info hover:bg-info/25',
};

const DISABLED = 'cursor-not-allowed opacity-40 hover:bg-panel-2 hover:border-line-strong hover:text-fg/90';

/** A small status dot inside a button: the output is on air (green) or held (amber), or a view is open (blue). */
function Dot({ tone }: { tone: 'ok' | 'warn' | 'info' }) {
  const color = tone === 'ok' ? 'bg-ok shadow-[0_0_6px_var(--color-ok)]' : tone === 'warn' ? 'bg-warn' : 'bg-info';
  return <span className={`size-2 shrink-0 rounded-full ${color}`} aria-hidden />;
}

function ControlButton({
  icon: Icon,
  label,
  tone,
  title,
  active = false,
  toggle = true,
  disabled = false,
  onClick,
  children,
}: {
  icon: LucideIcon;
  label: string;
  tone: Tone;
  /** The tooltip. On a disabled control it says why the control is unavailable. */
  title?: string;
  active?: boolean;
  /** False for one-shot actions like Stop, which have no pressed state. */
  toggle?: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** Extra marks after the label, like a status dot. */
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={toggle ? active : undefined}
      className={`${BASE} ${NO_DRAG} ${active ? tone.active : tone.idle} ${disabled ? DISABLED : ''}`}
    >
      <Icon className="size-4 shrink-0" aria-hidden strokeWidth={2.25} />
      <span>{label}</span>
      {children}
    </button>
  );
}

/** The operator's key for an action, like "F10", or null when none is set. Rebinding a shortcut updates the tooltips with it. */
function useShortcutKey(actionId: ShortcutActionId): string | null {
  const key = useUi((s) => s.shortcuts.find((sc) => sc.actionId === actionId && sc.key !== '')?.key);
  return key ? displayCombo(key) : null;
}

/** A tooltip with the shortcut appended: "Black out the screen (F11)". */
function withKey(tip: string, key: string | null): string {
  return key ? `${tip} (${key})` : tip;
}

/**
 * The live welcome slide, re-read whenever a timed slide is due to move on by itself, so the counter keeps pace with the projector
 * without polling.
 */
function useWelcomePosition() {
  const live = useLive((s) => s.state.projector.live);
  const slides = useLive((s) => s.state.welcome.slides);
  const [now, setNow] = useState(() => Date.now());
  // A new frame (the operator stepped, or the screen just went up) resets the clock the position is read against.
  useEffect(() => setNow(Date.now()), [live, slides]);
  const position = welcomeSlidePosition(live, slides, now);
  const remaining = position?.remainingMs ?? null;
  useEffect(() => {
    if (remaining === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => window.clearTimeout(timer);
  }, [remaining, now]);
  return position;
}

/**
 * The Welcome Screen control. Off, it is one button. Live, it lights gold; with two or more slides it becomes one connected capsule whose
 * second half steps the welcome carousel and shows which slide is up. The stepper lives inside the capsule so it can never be mistaken for
 * advancing the Holy Mass queue or song lyrics.
 */
function WelcomeControl() {
  const t = useT();
  const live = useLive((s) => s.state.projector.live.kind === 'welcome');
  const position = useWelcomePosition();
  const key = useShortcutKey('welcome');
  const tip = withKey(live ? t('top.tipWelcomeLive') : t('top.tipWelcome'), key);

  if (!live) return <ControlButton icon={WelcomeIcon} label={t('top.welcome')} tone={OUTPUT} title={tip} active={false} onClick={liveCommands.welcome} />;

  const stepper = position !== null && position.count > 1;
  const counter = position ? `${position.index + 1}/${position.count}` : '';
  return (
    <div
      role="group"
      aria-label={t('top.welcome')}
      data-testid="welcome-compound"
      className={`${NO_DRAG} flex h-9 shrink-0 items-stretch overflow-hidden rounded-md border border-accent/70 bg-accent/15 text-[13px] font-medium whitespace-nowrap text-accent ring-1 ring-accent/30 shadow-[0_0_14px_color-mix(in_oklab,var(--color-accent)_45%,transparent)]`}
    >
      <button
        type="button"
        onClick={liveCommands.welcome}
        title={tip}
        aria-pressed
        className="flex items-center gap-1.5 px-3 transition-colors hover:bg-accent/15 focus-visible:bg-accent/20 focus-visible:outline-none"
      >
        <WelcomeIcon className="size-4 shrink-0" aria-hidden strokeWidth={2.25} />
        <span>{t('top.welcome')}</span>
        {!stepper && (
          <span className="text-[11px] font-bold tracking-wider uppercase">
            <span aria-hidden>· </span>
            {t('status.live')}
          </span>
        )}
      </button>
      {stepper && (
        <>
          <span className="my-1.5 w-px shrink-0 bg-accent/40" aria-hidden />
          <button
            type="button"
            onClick={stepWelcomeSlide}
            title={t('top.tipWelcomeNext')}
            aria-label={`${t('top.welcomeNext')} (${counter})`}
            data-testid="welcome-next"
            className="flex items-center gap-1.5 px-3 transition-colors hover:bg-accent/15 focus-visible:bg-accent/20 focus-visible:outline-none"
          >
            {/* The full label on wide screens, a compact one on 1280px and 1366px booth laptops. */}
            <span className="hidden 2xl:inline">{t('top.welcomeNext')}</span>
            <span className="2xl:hidden">{t('top.welcomeNextShort')}</span>
            <span className="rounded bg-accent/20 px-1.5 py-px text-[11px] font-bold tabular-nums" aria-hidden>
              {counter}
            </span>
            <ChevronRight className="size-4 shrink-0" aria-hidden strokeWidth={2.5} />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A master switch: a pill with a dot, green and LIVE when on, red and OFF when off. The Projector and Remote switches
 * both use it, so they look the same.
 */
function MasterSwitch({ on, label, title, onClick }: { on: boolean; label: string; title: string; onClick: () => void }) {
  const t = useT();
  const state = on ? t('status.live') : t('status.off');
  // Only the way on is closed. A switch that is live can always be turned off.
  const locked = useProjectionLocked() && !on;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={locked ? LICENSE_LOCKED_TIP : title}
      onClick={onClick}
      disabled={locked}
      className={`${BASE} ${NO_DRAG} rounded-full border px-3.5 py-1.5 tracking-wide ${locked ? DISABLED : ''} ${
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

/** A thin vertical rule between zones. Subtle on purpose: it groups, it does not decorate. */
const Divider = () => <span className="h-6 w-px shrink-0 bg-line-strong" aria-hidden />;

export function TopBar() {
  const t = useT();
  const { outputs, projector, lowerThird } = useLive((s) => s.state);
  const liveKind = projector.live.kind;
  const previewOpen = useUi((s) => s.previewOpen);
  const promptChoice = useUi((s) => s.projectorPromptChoice);
  const lowerLocked = useProjectionLocked() && lowerThird.live === null;
  const keys = {
    blackout: useShortcutKey('blackout'),
    pauseProjector: useShortcutKey('pauseProjector'),
    pauseLowerThird: useShortcutKey('pauseLowerThird'),
    stop: useShortcutKey('stop'),
    announcements: useShortcutKey('announcements'),
    lowerThird: useShortcutKey('lowerThird'),
  };

  const lowerOnAir = lowerThird.live !== null;
  const lowerReady = lowerOnAir || lowerThird.staged !== null;
  const lowerTip = lowerLocked
    ? LICENSE_LOCKED_TIP
    : withKey(lowerOnAir ? t('top.tipLowerThirdLive') : lowerReady ? t('top.tipLowerThirdReady') : t('top.tipOpenLowerThird'), keys.lowerThird);

  // In a narrower window the live outputs drop to a second row. The divider that groups the zones would then be left hanging
  // at the end of the first row, so it is shown only while both zones share a row.
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
      <div ref={controls} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Zone A: master output and safety transport. */}
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
          <ControlButton
            icon={MonitorOff}
            label={t('top.blackout')}
            title={withKey(t('top.tipBlackout'), keys.blackout)}
            tone={EMERGENCY}
            active={liveKind === 'blackout'}
            onClick={liveCommands.blackout}
          />
          <ControlButton
            icon={projector.paused ? Play : Pause}
            label={projector.paused ? t('top.projectorPaused') : t('top.pauseProjector')}
            title={
              !outputs.projector
                ? t('top.tipProjectorRequired')
                : withKey(projector.paused ? t('top.tipResumeProjector') : t('top.tipPauseProjector'), keys.pauseProjector)
            }
            tone={PAUSE}
            active={projector.paused}
            disabled={!outputs.projector}
            onClick={() => dispatch({ type: 'projector/pause' })}
          />
          <ControlButton
            icon={lowerThird.paused ? Play : Pause}
            label={lowerThird.paused ? t('top.lowerThirdPaused') : t('top.pauseLowerThird')}
            title={
              !lowerOnAir
                ? t('top.tipLowerThirdRequired')
                : withKey(lowerThird.paused ? t('top.tipResumeLowerThird') : t('top.tipPauseLowerThird'), keys.pauseLowerThird)
            }
            tone={PAUSE}
            active={lowerThird.paused}
            disabled={!lowerOnAir}
            onClick={() => dispatch({ type: 'lowerThird/pause' })}
          />
          <ControlButton icon={Square} label={t('top.stop')} title={withKey(t('top.tipStop'), keys.stop)} tone={STOP} toggle={false} onClick={() => dispatch({ type: 'stop' })} />
        </div>

        {!stacked && <Divider />}

        {/* Zone B: what is on air over the projector, then the booth-only views. */}
        <div ref={overlays} className="flex items-center gap-2">
          <div role="group" aria-label={t('top.groupOverlays')} className="flex items-center gap-1.5">
            <WelcomeControl />
            <ControlButton
              icon={Megaphone}
              label={t('top.announcements')}
              title={withKey(liveKind === 'announcements' ? t('top.tipAnnouncementsLive') : t('top.tipAnnouncements'), keys.announcements)}
              tone={OUTPUT}
              active={liveKind === 'announcements'}
              onClick={liveCommands.announcements}
            />
            <ControlButton
              icon={Tag}
              label={t('top.lowerThird')}
              tone={OUTPUT}
              title={lowerTip}
              active={lowerOnAir}
              disabled={lowerLocked}
              onClick={() => (lowerReady ? dispatch({ type: 'lowerThird/toggle' }) : setUi({ view: 'media', pendingFocus: { kind: 'lowerThird' } }))}
            >
              {lowerOnAir && <Dot tone={lowerThird.paused ? 'warn' : 'ok'} />}
            </ControlButton>
          </div>
          <Divider />
          <div role="group" aria-label={t('top.groupViews')} className="flex items-center gap-1.5">
            <ControlButton
              icon={Monitor}
              label={t('top.preview')}
              title={previewOpen ? t('top.tipPreviewOpen') : t('top.tipPreview')}
              tone={VIEW}
              active={previewOpen}
              onClick={() => setUi({ previewOpen: !previewOpen })}
            >
              {previewOpen && <Dot tone="info" />}
            </ControlButton>
          </div>
        </div>
      </div>

      {/* Zone C: stays on the first row, level with the transport controls, even when the live outputs wrap to a second row below them. */}
      <div role="group" aria-label={t('top.groupConnections')} className="ml-auto flex h-9 shrink-0 items-center gap-2 self-start">
        <RemoteMaster />
        <ProjectorMaster />
      </div>
    </header>
  );
}
