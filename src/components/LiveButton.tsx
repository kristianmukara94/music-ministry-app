import { Radio, Zap } from 'lucide-react';

/** The compact LIVE button's look: red, small padding, so the row's title keeps its width. */
export const LIVE_BTN =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-extrabold tracking-wide uppercase transition focus-visible:ring-2 focus-visible:ring-danger/60 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60';

export interface LiveButtonLabels {
  /** The short label: LIVE. */
  live: string;
  /** The tooltip and the screen reader's name: Go Live Now. */
  hint: string;
  /** Shown while armed: Press again. */
  confirm: string;
  /** Shown while this row is on the projector: On screen. Optional. */
  showing?: string;
}

/**
 * The red LIVE button on a planner library row (songs, prayers, readings): it puts the row on the projector now, without adding it to the
 * plan. It reads LIVE with a lightning bolt; its tooltip and accessible name say Go Live Now. Armed, it pulses and asks for a second press;
 * on screen, it shows a quiet On screen state.
 */
export function LiveButton({
  title,
  labels,
  onPress,
  armed = false,
  pending = false,
  isLive = false,
}: {
  /** The row's title, for the accessible name: "Go Live Now: <title>". */
  title: string;
  labels: LiveButtonLabels;
  /** `immediate` is true for Shift + click, which skips the confirm. */
  onPress: (immediate: boolean) => void;
  armed?: boolean;
  pending?: boolean;
  isLive?: boolean;
}) {
  return (
    <button
      type="button"
      data-live-button
      disabled={pending}
      aria-label={`${labels.hint}: ${title}`}
      title={armed ? labels.confirm : `${labels.hint} (Shift + click)`}
      onClick={(e) => {
        e.stopPropagation();
        onPress(e.shiftKey);
      }}
      className={`${LIVE_BTN} ${
        isLive
          ? 'border-danger/60 bg-danger/15 text-danger hover:bg-danger/25'
          : armed
            ? 'animate-pulse border-warn bg-warn text-on-accent'
            : 'border-danger bg-danger text-white hover:brightness-110'
      }`}
    >
      {isLive ? <Radio size={13} aria-hidden /> : <Zap size={13} aria-hidden />}
      {isLive && labels.showing ? labels.showing : armed ? labels.confirm : labels.live}
    </button>
  );
}
