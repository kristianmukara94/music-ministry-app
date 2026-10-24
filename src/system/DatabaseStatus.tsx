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
      ? 'border-white/10 bg-white/5 text-fg/50'
      : healthy
        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
        : 'border-danger/40 bg-danger/10 text-danger';
  const dot = state === null ? 'bg-white/30' : healthy ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-danger';

  return (
    <div className="mt-3 flex" title={`${label}\n${detail}`} role="status">
      <span className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs font-bold tracking-wide ${pill}`}>
        <span className={`size-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        {!collapsed && <span className="truncate">v{state?.version ?? __APP_VERSION__} · {healthy ? 'DB ok' : 'DB error'}</span>}
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );
}
