import { useMemo } from 'react';
import { remoteViewSnapshot } from '../../shared/remote-view.js';
import { useLive } from '../live/store';

/**
 * The Stage / Choir Mirror picture for Nearby TV Cast: the item title, the current slide large, and a smaller preview of the next slide. It
 * is drawn in a hidden 1920x1080 window (route `cast-stage`) and sent to TVs as a picture. It reads the same snapshot the Remote view phones
 * get, so it shows only words and titles, never the rest of the app.
 */
export function CastStageView() {
  const state = useLive((s) => s.state);
  const snap = useMemo(() => remoteViewSnapshot(state), [state]);
  const showing = snap.screen === 'live';
  const hidden = snap.screen === 'off' || snap.screen === 'blackout';
  const nextLines = snap.nextLines.length > 0 ? snap.nextLines : snap.next ? [snap.next] : [];

  return (
    <div className="grid h-screen w-screen grid-rows-[auto_1fr_auto] gap-6 bg-black px-[72px] py-12 text-white" style={{ visibility: hidden ? 'hidden' : 'visible' }}>
      <div className="flex items-baseline justify-between gap-8 text-[44px] font-bold text-[#f2c94c]">
        <span>{snap.title}</span>
        <span className="text-[34px] font-semibold text-[#aaa]">{showing ? (snap.position ?? '') : ''}</span>
      </div>
      <div className="flex flex-col items-center justify-center overflow-hidden text-center text-[92px] leading-[1.18] font-bold">
        {showing && snap.lines.map((line, i) => <p key={i}>{line === '' ? '\u00a0' : line}</p>)}
      </div>
      <div className="min-h-[150px] border-t-[3px] border-[#444] pt-5 text-[40px] leading-tight text-[#bbb]">
        {nextLines.length > 0 && (
          <>
            <b className="mb-1.5 block text-[28px] tracking-[0.12em] text-[#888] uppercase">{snap.nextLines.length > 0 ? 'Next slide' : 'Next'}</b>
            {nextLines.slice(0, 3).map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
