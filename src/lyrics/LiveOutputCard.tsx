import { MonitorOff, Projector } from 'lucide-react';
import type { Frame } from '../../shared/live.js';
import { lyricsOnAir } from '../../shared/lyrics-live.js';
import { useLive } from '../live/store';
import type { LyT } from './strings';

/**
 * The Song Lyrics status badge in the page header: 🔴 LIVE with the song's title while a song stanza is on the projector, Blackout while it is held
 * behind a blackout, Ready while the projector output is switched off, and Standby when no song is on air.
 */
export function LiveStatusBadge({ t }: { t: LyT }) {
  const projector = useLive((s) => s.state.projector);
  const outputOn = useLive((s) => s.state.outputs.projector);
  const song = lyricsOnAir(projector);
  const frame = song?.blackout ? projector.beforeBlackout : projector.live;
  const title = frame?.kind === 'lyrics' ? frame.title : '';
  const state = !song ? 'standby' : song.blackout ? 'blackout' : outputOn ? 'live' : 'ready';
  const tone = {
    live: 'border-danger bg-crimson text-white shadow-[0_0_18px_color-mix(in_oklab,var(--color-danger)_45%,transparent)]',
    blackout: 'border-warn/70 bg-warn/15 text-warn',
    ready: 'border-warn/60 bg-panel-2 text-warn',
    standby: 'border-fg/15 bg-panel-2 text-fg/70',
  }[state];
  const label = { live: t('statusLive'), blackout: t('statusBlackout'), ready: t('statusReady'), standby: t('statusStandby') }[state];
  return (
    <div role="status" aria-live="polite" data-live-state={state} className={`flex h-10 max-w-full min-w-0 items-center gap-2 rounded-full border px-4 text-xs font-extrabold tracking-wider uppercase ${tone}`}>
      <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${state === 'live' ? 'animate-pulse bg-white' : state === 'standby' ? 'bg-fg/40' : 'bg-warn'}`} />
      <span className="shrink-0">{label}</span>
      {title && state !== 'standby' && <span className="min-w-0 truncate font-semibold tracking-normal normal-case opacity-90">· {title}</span>}
    </div>
  );
}

/** The words a frame puts on the screen, with the small label above them. Null for a frame that carries no text of its own. */
function frameWords(frame: Frame | null | undefined): { label: string; text: string } | null {
  if (!frame) return null;
  if (frame.kind === 'lyrics') return { label: frame.label, text: frame.text };
  if (frame.kind === 'text') return { label: frame.headline ?? frame.title, text: frame.text };
  if (frame.kind === 'psalm') return { label: frame.title, text: `${frame.pages[frame.index] ?? ''}\n\n${frame.response}`.trim() };
  if (frame.kind === 'deck') return { label: frame.labels?.[frame.index] ?? frame.title, text: (frame.slides[frame.index] ?? []).map((l) => l.text).join('\n') };
  return null;
}

/**
 * What the congregation's projector shows right now, as plain high-contrast text, read from the live frame every window shares. While the
 * screen is black it shows the slide held behind the blackout, dimmed, so the operator still knows their place.
 */
export function LiveOutputCard({ t }: { t: LyT }) {
  const projector = useLive((s) => s.state.projector);
  const outputOn = useLive((s) => s.state.outputs.projector);
  const blackout = projector.live.kind === 'blackout';
  const frame = blackout ? projector.beforeBlackout : projector.live;
  const words = frameWords(frame);
  const live = outputOn && !blackout && words !== null;

  return (
    <section aria-label={t('outputPreview')} aria-live="polite" className="shrink-0 border-b border-line p-3">
      <div className="mb-1.5 flex items-center gap-2">
        {blackout ? <MonitorOff size={13} className="text-warn" aria-hidden /> : <Projector size={13} className={live ? 'text-danger' : 'text-muted'} aria-hidden />}
        <span className="text-[10px] font-bold tracking-wider text-muted uppercase">{t('outputPreview')}</span>
        {live && <span aria-hidden className="ml-auto size-2 animate-pulse rounded-full bg-danger shadow-[0_0_6px_var(--color-danger)]" />}
      </div>
      <div
        className={`rounded-lg border bg-black px-4 py-3 text-center shadow-inner ${live ? 'border-danger/60 ring-1 ring-danger/30' : 'border-fg/15'} ${
          blackout ? 'opacity-60' : ''
        }`}
      >
        {blackout && <p className="mb-1 text-[11px] font-semibold text-warn">{t('outputBlack')}</p>}
        {words ? (
          <>
            {words.label && <p className="mb-1 font-mono text-[10px] font-bold tracking-wider text-amber uppercase">{words.label}</p>}
            <p className="line-clamp-6 text-[15px] leading-snug font-semibold whitespace-pre-line text-white">{words.text}</p>
          </>
        ) : (
          <p className="py-2 text-xs text-white/70">
            {!frame || frame.kind === 'idle' ? t('outputIdle') : t('outputOther', { kind: frame.kind })}
          </p>
        )}
      </div>
    </section>
  );
}
