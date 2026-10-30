import { useState } from 'react';
import { Check } from 'lucide-react';
import { useTheme } from '../theme/store';
import { THEMES, type ThemeGroup, type ThemeId, type ThemeInfo } from '../theme/themes';

const GROUPS: { id: ThemeGroup; title: string }[] = [
  { id: 'signature', title: 'Signature' },
  { id: 'dark', title: 'Dark' },
  { id: 'light', title: 'Light' },
];

/**
 * A small picture of the app in one theme. The card carries its own data-theme, so the
 * mockup is painted with that theme's colours and nothing else.
 */
function ThemeCard({ info, active, onPick }: { info: ThemeInfo; active: boolean; onPick: (id: ThemeId) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(info.id)}
      aria-pressed={active}
      aria-label={`${info.name}${active ? ' (in use)' : ''}`}
      className={`group flex w-full flex-col gap-2 rounded-xl border bg-panel p-2 text-left transition ${
        active ? 'border-accent ring-2 ring-accent' : 'border-line hover:border-fg/15'
      }`}
    >
      <div data-theme={info.id} className="relative w-full aspect-video overflow-hidden rounded-lg border border-line bg-canvas" aria-hidden>
        {/* Tiny sidebar */}
        <div className="absolute inset-y-0 left-0 w-[22%] border-r border-line bg-panel" />
        <div className="absolute top-[12%] left-[10%] h-[8%] w-[6%] rounded-sm bg-accent" />
        <div className="absolute top-[26%] left-[10%] h-[6%] w-[70%] rounded-sm bg-line-strong" />
        <div className="absolute top-[36%] left-[10%] h-[6%] w-[55%] rounded-sm bg-line-strong" />
        {/* Header bar */}
        <div className="absolute inset-x-[26%] top-[8%] h-[10%] rounded-sm bg-panel" />
        {/* Content: a card, an accent button, and text lines */}
        <div className="absolute inset-x-[26%] top-[24%] h-[34%] rounded-sm border border-line bg-panel" />
        <div className="absolute top-[64%] left-[30%] h-[10%] w-[22%] rounded-sm bg-accent" />
        <div className="absolute top-[80%] left-[30%] h-[4%] w-[60%] rounded-sm bg-fg/70" />
        <div className="absolute top-[88%] left-[30%] h-[4%] w-[45%] rounded-sm bg-muted/70" />
      </div>

      <div className="flex items-center justify-between gap-2 px-1">
        <span className="truncate text-sm font-semibold text-fg">{info.name}</span>
        {active && (
          <span className="flex shrink-0 items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-on-accent uppercase">
            <Check size={11} strokeWidth={3} aria-hidden /> IN USE
          </span>
        )}
      </div>
    </button>
  );
}

export function ThemeView() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const [error, setError] = useState<string | null>(null);

  const pick = (id: ThemeId) => {
    setError(null);
    setTheme(id).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <section aria-labelledby="theme-heading" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <h2 id="theme-heading" className="text-4xl leading-tight font-extrabold tracking-tight text-fg">Theme</h2>
          <p className="mt-2 text-[15px] text-muted">
            Colors for APCCMMA's own windows. Projected slides keep their own styles.
          </p>
        </div>
        <p className="flex items-center gap-2 text-xs font-semibold text-ok">
          <Check size={14} strokeWidth={3} aria-hidden /> Changes save automatically
        </p>
      </header>

      <p className="text-sm text-muted">Pick a theme to apply it right away. It also restyles phones and tablets connected to Remote view.</p>

      {error && (
        <div role="alert" className="rounded-md border border-danger/40 bg-panel px-4 py-2 text-sm text-danger">
          Could not save the theme: {error}
        </div>
      )}

      {GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-3">
          <h3 className="eyebrow">{group.title}</h3>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4 2xl:grid-cols-5">
            {THEMES.filter((t) => t.group === group.id).map((info) => (
              <ThemeCard key={info.id} info={info} active={info.id === theme} onPick={pick} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
