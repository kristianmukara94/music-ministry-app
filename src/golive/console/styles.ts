import type { OutputStatus } from '../../../shared/stage-cue.js';

// The console's look, shared by its cards. Theme tokens only (see the theme contrast engine): the accent is the console's gold, ok / warn /
// danger its emerald, amber and red.
export const CARD = 'rounded-xl border border-line bg-panel';
export const CARD_TITLE = 'text-sm font-bold text-fg';
export const EYEBROW = 'text-[11px] font-bold tracking-wider uppercase';
export const BTN =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-panel-2 px-3 text-xs font-medium text-fg/90 transition hover:border-fg/30 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
export const BTN_PRIMARY =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-accent bg-accent px-3 text-xs font-bold text-on-accent transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
export const BTN_ACTIVE = `${BTN} !border-accent !bg-accent/15 !text-accent`;
export const BTN_DANGER_ACTIVE = `${BTN} !border-danger !bg-danger/20 !text-danger`;
export const BTN_DANGER = `${BTN} text-danger hover:!border-danger/60 hover:!bg-danger/10 hover:!text-danger`;

/** The status pill's colours: emerald on air, amber with the words hidden, red under Blackout, quiet off air. */
export const STATUS_TONE: Record<OutputStatus, string> = {
  onAir: 'border-ok/40 bg-ok/10 text-ok',
  hidden: 'border-warn/50 bg-warn/15 text-warn',
  blackout: 'border-danger/50 bg-danger/15 text-danger',
  offAir: 'border-line bg-panel-2 text-muted',
};

/** A 16:9 monitor: the slide fills it, and every size inside is a share of it. */
export const MONITOR = 'relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-canvas [container-type:size]';
