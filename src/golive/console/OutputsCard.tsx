import { MonitorOff, Tag } from 'lucide-react';
import { useLive } from '../../live/store';
import { ProjectorView } from '../../output/ProjectorView';
import { LowerThirdStage } from '../../output/LowerThirdView';
import { lyricBottomOf } from '../../../shared/lyric-area.js';
import { DetachMonitorButton } from '../../components/DetachMonitorButton';
import { usePwT } from '../../praise-worship/strings';
import { useGoLiveT } from '../strings';
import { CARD, MONITOR } from './styles';

/** The quiet placeholder a monitor shows while its output is off: an icon and a short line, never a blank or tinted box. */
function OffFace({ icon: Icon, text }: { icon: typeof Tag; text: string }) {
  return (
    // Opaque (surface-2, not the glass panel-2): the frame still held underneath must not show through the Off face.
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1.5 bg-surface-2 px-3 text-center text-xs text-muted">
      <Icon size={18} aria-hidden className="text-faint" />
      {text}
    </div>
  );
}

/**
 * What the congregation and the livestream see, side by side under the console's monitors (stacked on a narrow pane). Shared by the Praise &
 * Worship and Holy Mass consoles. An output that is off says so on a neutral face instead of showing an empty black or tinted frame.
 */
export function OutputsCard({ titleId }: { titleId: string }) {
  const tp = usePwT();
  const tg = useGoLiveT();
  const projectorOn = useLive((s) => s.state.outputs.projector);
  const band = useLive((s) => s.state.lowerThird.live);
  const lyricBottom = useLive((s) => lyricBottomOf(s.state.projector.live));
  return (
    <section aria-labelledby={titleId} className={`${CARD} @container/outputs flex flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-sm font-bold">
          {tp('outputs')}
        </h2>
        <DetachMonitorButton />
      </div>
      <div className="grid grid-cols-1 gap-4 @xl/outputs:grid-cols-2">
        <figure className="flex min-w-0 flex-col gap-1.5">
          <figcaption className="text-xs text-muted">{tp('congregation')}</figcaption>
          <div className={MONITOR}>
            <ProjectorView mirror embedded />
            {!projectorOn && <OffFace icon={MonitorOff} text={tg('consoleStatusOffAir')} />}
          </div>
        </figure>
        <figure className="flex min-w-0 flex-col gap-1.5">
          <figcaption className="text-xs text-muted">{tp('livestream')}</figcaption>
          {band ? (
            <div data-theme="default" className={MONITOR}>
              <LowerThirdStage value={band} lyricBottomShare={lyricBottom} />
            </div>
          ) : (
            <div className={MONITOR}>
              <OffFace icon={Tag} text={`${tp('lowerThirdToggle')}: ${tp('off')}`} />
            </div>
          )}
        </figure>
      </div>
    </section>
  );
}
