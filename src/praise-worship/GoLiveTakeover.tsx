import { ProjectorView } from '../output/ProjectorView';
import { LiveQuickControls } from '../lyrics/LiveQuickControls';
import { useLyT } from '../lyrics/strings';
import { QuickCuePanel } from './QuickCuePanel';
import type { QuickLive } from './useQuickLiveController';
import type { PwT } from './strings';

/**
 * The Go Live focus view of a song sent from search. It takes the whole Plan workspace: the stanza cards on the left, and on the right
 * what the congregation sees now, with Blackout, Clear text and the Lower 3rd at hand. The Library and Lineup are only hidden behind it,
 * so ✕ brings them straight back as they were.
 */
export function GoLiveTakeover({ quick, t }: { quick: QuickLive; t: PwT }) {
  const lt = useLyT();
  const notice = quick.notice;
  return (
    <div className="grid grid-cols-1 items-start gap-5 @4xl/pw:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
      <QuickCuePanel quick={quick} t={t} focused />

      <aside aria-labelledby="pw-focus-screen" className="flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-line bg-panel">
        {/* B and Escape are the cue panel's keys here; these buttons are for the mouse, so they bind none of their own. */}
        <LiveQuickControls hymn={quick.cue} keys={false} t={lt} />
        <div className="flex flex-col gap-2 p-4">
          <h2 id="pw-focus-screen" className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('onScreenNow')}</h2>
          <div className="relative aspect-video overflow-hidden rounded-lg border border-line">
            <ProjectorView mirror embedded />
          </div>
          {notice && (
            <p role="alert" className={`text-sm ${notice.kind === 'screen' ? 'text-warn' : 'text-danger'}`}>
              {notice.text}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
