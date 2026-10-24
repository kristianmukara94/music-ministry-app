import type { ReactNode } from 'react';

/** Bottom-row panel chrome: eyebrow + title header, then content. */
export function Panel({ eyebrow, title, children, className = '' }: {
  eyebrow: string; title: string; children: ReactNode; className?: string;
}) {
  return (
    <section className={`flex flex-col overflow-hidden rounded-xl border border-line bg-panel ${className}`}>
      <header className="border-b border-line px-4 pt-3 pb-2">
        <div className="text-[10px] font-bold tracking-widest text-fg/50 uppercase">{eyebrow}</div>
        <h3 className="text-sm font-bold text-fg">{title}</h3>
      </header>
      <div className="relative flex-1">{children}</div>
    </section>
  );
}
