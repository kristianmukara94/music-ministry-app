import { useState } from 'react';
import { Radio } from 'lucide-react';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import type { GoLiveEntry } from '../../shared/golive.js';
import { loadMassPlanToQueue, openPwLive } from './goLive';
import type { GoLiveT } from './strings';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const BTN_GO =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-ok bg-ok px-5 text-sm font-extrabold tracking-wide text-canvas shadow-md transition hover:brightness-110';
const BTN =
  'inline-flex h-10 items-center justify-center rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10 hover:text-fg';

/**
 * The hub's Go Live for the selected entry. A Mass plan asks first, then loads into the Mass Queue, where the take happens.
 * A Praise & Worship session opens on its Live tab, where the module's own Go Live takes it live. Nothing here takes a
 * slide live.
 */
export function GoLiveAction({ entry, t }: { entry: GoLiveEntry; t: GoLiveT }) {
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectorOn = useLive((s) => s.state.outputs.projector);
  const projectorKind = useLive((s) => s.state.projector.live.kind);
  const queuePlanId = useLive((s) => s.state.queuePlanId);

  /** Reads the first item of the plan, then shows the confirm. Reads only. */
  const askMass = async () => {
    setError(null);
    try {
      const plan = await bridge.plans.get(entry.id);
      if (plan.items.length === 0) {
        setError(t('noItemsToGoLive'));
        return;
      }
      setFirst(plan.items[0].label);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const confirmMass = async () => {
    setError(null);
    try {
      await loadMassPlanToQueue(entry.id);
      setFirst(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const openPw = async () => {
    setError(null);
    try {
      await openPwLive(entry.id);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const projectorLine = !projectorOn ? t('projectorOff') : projectorKind === 'blackout' ? t('projectorBlackout') : t('projectorOn');

  if (entry.kind === 'pw') {
    return (
      <>
        <button type="button" className={BTN_GO} onClick={() => void openPw()}>
          <Radio size={15} aria-hidden /> {t('goLive')}
        </button>
        {error && (
          <p role="alert" className="w-full text-sm text-danger">
            {error}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {first === null ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN_GO} onClick={() => void askMass()}>
            <Radio size={15} aria-hidden /> {t('goLive')}
          </button>
        </div>
      ) : (
        <div role="group" aria-label={t('goLive')} className="flex max-w-xl flex-col gap-3 rounded-[10px] border border-accent/60 bg-accent/5 p-4">
          <p className="text-sm font-semibold text-fg">{t('confirmFirst', { label: first })}</p>
          <p className="text-sm text-fg/70">{projectorLine}</p>
          {queuePlanId != null && queuePlanId !== entry.id && <p className="text-sm text-warn">{t('replacesQueue')}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_GO} onClick={() => void confirmMass()}>
              {t('confirmLoad')}
            </button>
            <button type="button" className={BTN} onClick={() => setFirst(null)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
