import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { bridge } from '../live/bridge';
import { usePwT } from '../praise-worship/strings';

/**
 * Detach Monitor, on a live console's Outputs panel: opens the congregation output in a window of its own (the operator mirror), for a booth
 * or stage screen. A plain browser has no second window, so the button is not drawn there.
 */
export function DetachMonitorButton() {
  const t = usePwT();
  const [busy, setBusy] = useState(false);
  if (!bridge.isElectron) return null;
  const open = () => {
    setBusy(true);
    void bridge.projector
      .openConfidenceWindow()
      .catch((err) => console.error('Could not open the confidence monitor:', err))
      .finally(() => setBusy(false));
  };
  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      title={t('detachMonitorHint')}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-fg/15 bg-panel-2 px-2.5 text-xs font-semibold text-fg/85 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      <ExternalLink size={14} aria-hidden /> {t('detachMonitor')}
    </button>
  );
}
