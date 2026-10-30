import type { ReactNode } from 'react';

/** Bottom-row panel chrome: a small uppercase label, an optional title, then content. `action` sits at the right of the header. */
export function Panel({ eyebrow, title, children, action, className = '' }: {
  eyebrow: string; title?: string; children: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <section className={`flex flex-col overflow-hidden rounded-[10px] border border-fg/[0.12] bg-panel ${className}`}>
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-fg/10 px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-xs font-semibold tracking-wide text-fg/70 uppercase">{eyebrow}</div>
          {title && <h3 className="text-lg leading-tight font-semibold text-fg">{title}</h3>}
        </div>
        {action}
      </header>
      <div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
