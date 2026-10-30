import { useEffect, useState } from 'react';
import { bridge } from '../live/bridge';
import type { ConfigState } from '../settings/types';

/**
 * Sidebar footer: app version and whether the database answered on boot.
 * Green = connected to the configured database. Red = error, or running on the local fallback copy.
 */
export function DatabaseStatus({ collapsed }: { collapsed: boolean }) {
  const [state, setState] = useState<ConfigState | null>(null);

  useEffect(() => {
    bridge.config.get().then(setState).catch(() => setState(null));
  }, []);

  const healthy = Boolean(state?.status.connected && !state.status.fallback);
  const label = state === null ? 'Checking database' : healthy ? 'Database connected' : 'Database error';
  const detail = state?.status.error ?? state?.databasePath ?? '';
  const pill =
    state === null
      ? 'border-transparent bg-fg/5 text-fg/50'
      : healthy
        ? 'border-transparent bg-transparent text-ok'
        : 'border-danger/40 bg-danger/10 text-danger';
  const dot = state === null ? 'bg-fg/30' : healthy ? 'bg-ok shadow-[0_0_8px_var(--color-ok)]' : 'bg-danger';

  return (
    <div className="mt-3 flex" title={`${label}\n${detail}`} role="status">
      <span className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold tracking-wide ${pill}`}>
        <span className={`size-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        {!collapsed && <span className="truncate">v{state?.version ?? __APP_VERSION__} - {healthy ? 'DB ok' : 'DB error'}</span>}
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );
}
