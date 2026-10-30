import type { ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';

/** Building blocks shared by the Settings pages that are laid out as a header and a stack of cards. */

export const FOCUS = 'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
export const HEADING = 'text-[11px] font-semibold tracking-wider text-fg/70 uppercase';
export const SUB = 'text-xs text-fg/60';
export const SECONDARY = `flex items-center gap-2 rounded-lg border border-fg/20 bg-panel-2 px-3 py-2 text-xs font-bold tracking-wider whitespace-nowrap text-fg/90 uppercase transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`;
export const PRIMARY = `flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-bold tracking-wider whitespace-nowrap text-on-accent uppercase shadow-md shadow-black/40 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${FOCUS}`;

/** A page title block: the section name, the title, a sentence about the page, and the auto-save note. */
export function PageHeader({ eyebrow, title, description, autoSave = true }: { eyebrow: string; title: string; description: string; autoSave?: boolean }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-[11px] font-bold tracking-[0.2em] text-fg/50 uppercase">{eyebrow}</div>
        <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">{title}</h1>
        <p className="mt-2 max-w-xl text-sm text-fg/60">{description}</p>
      </div>
      {autoSave && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-panel-2/80 px-3 py-1 text-xs font-semibold text-accent/90 shadow-sm">
          <CheckCircle2 size={13} aria-hidden /> Changes save automatically
        </span>
      )}
    </header>
  );
}

/** A titled card. `action` sits at the right of the title, for a reset or a refresh. */
export function Card({ id, title, detail, action, children }: { id: string; title: string; detail?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-panel-2/60 p-5 shadow-lg" aria-labelledby={id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id} className={HEADING}>{title}</h2>
          {detail && <p className={`mt-1 ${SUB}`}>{detail}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A number and what it counts. `warn` lights it amber while it is above zero, for things that need attention. */
export function Stat({ label, value, tone = 'normal' }: { label: string; value: number | string; tone?: 'normal' | 'warn' }) {
  const lit = tone === 'warn' && Number(value) > 0;
  return (
    <div className={`rounded-lg border px-4 py-3 ${lit ? 'border-warn/50 bg-warn/10' : 'border-line bg-panel/60'}`}>
      <div className={`font-mono text-2xl font-extrabold tabular-nums ${lit ? 'text-warn' : 'text-fg'}`}>{value}</div>
      <div className="text-xs text-fg/60">{label}</div>
    </div>
  );
}

/** One row of a breakdown: a name, a bar sized to its share of the whole, and the count. */
export function Bar({ name, count, total, warn = false }: { name: string; count: number; total: number; warn?: boolean }) {
  const share = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="w-32 shrink-0 truncate text-fg/90" title={name}>{name}</span>
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10" aria-hidden>
        <span className={`block h-full rounded-full ${warn ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${share}%` }} />
      </span>
      <span className="w-8 shrink-0 text-right font-mono text-xs text-fg/70 tabular-nums">{count}</span>
    </li>
  );
}
