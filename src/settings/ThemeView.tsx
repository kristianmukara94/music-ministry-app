import { useState } from 'react';
import { CalendarDays, Check } from 'lucide-react';
import { seasonOf } from '../../shared/liturgical-season.js';
import { useTheme } from '../theme/store';
import { THEMES, resolvedTheme, type ThemeGroup, type ThemeId, type ThemeInfo } from '../theme/themes';

const GROUPS: { id: ThemeGroup; title: string; note?: string }[] = [
  { id: 'seasonal', title: 'Church calendar', note: 'The colours of the liturgical year. Choose one for any season, or let APCCMMA follow the calendar for you.' },
  { id: 'signature', title: 'Signature' },
  { id: 'dark', title: 'Dark' },
  { id: 'light', title: 'Light' },
];

const SEASON_NAME = Object.fromEntries(THEMES.filter((t) => t.group === 'seasonal').map((t) => [t.id, t.name])) as Record<string, string>;

/** A small picture of the app in one theme. The picture carries its own data-theme, so it is painted with that theme's colours and nothing else. */
function Mockup({ theme }: { theme: string }) {
  return (
    <div data-theme={theme} className="relative w-full aspect-video overflow-hidden rounded-lg border border-line bg-canvas" aria-hidden>
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
  );
}

function ThemeCard({ info, active, now, onPick }: { info: ThemeInfo; active: boolean; now: boolean; onPick: (id: ThemeId) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(info.id)}
      aria-pressed={active}
      aria-label={`${info.name}${info.detail ? `, ${info.detail}` : ''}${now ? ', the current season' : ''}${active ? ' (in use)' : ''}`}
      className={`group flex w-full flex-col gap-2 rounded-xl border bg-panel p-2 text-left transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
        active ? 'border-accent ring-2 ring-accent' : 'border-line hover:border-fg/15'
      }`}
    >
      <Mockup theme={info.id} />

      <div className="flex flex-col gap-0.5 px-1 pb-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-fg">{info.name}</span>
          <span className="flex shrink-0 items-center gap-1">
            {now && <span className="rounded border border-accent/50 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-accent uppercase">Now</span>}
            {active && (
              <span className="flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-on-accent uppercase">
                <Check size={11} strokeWidth={3} aria-hidden /> In use
              </span>
            )}
          </span>
        </div>
        {info.detail && <span className="text-xs leading-snug text-muted">{info.detail}</span>}
      </div>
    </button>
  );
}

/** The Automatic choice: a wide card that shows which season it is painting today. */
function AutoCard({ active, season, onPick }: { active: boolean; season: string; onPick: (id: ThemeId) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick('season-auto')}
      aria-pressed={active}
      aria-label={`Automatic, follows the Church calendar. Today is ${SEASON_NAME[season] ?? season}${active ? ' (in use)' : ''}`}
      className={`group flex w-full items-center gap-4 rounded-xl border bg-panel p-3 text-left transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none sm:max-w-2xl ${
        active ? 'border-accent ring-2 ring-accent' : 'border-line hover:border-fg/15'
      }`}
    >
      <div className="w-40 shrink-0">
        <Mockup theme={season} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <CalendarDays size={16} className="shrink-0 text-accent" aria-hidden />
          <span className="text-base font-bold text-fg">Automatic</span>
          {active && (
            <span className="flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-on-accent uppercase">
              <Check size={11} strokeWidth={3} aria-hidden /> In use
            </span>
          )}
        </div>
        <p className="text-sm text-muted">Follows the Church calendar and changes colour with each season, at midnight, with no restart.</p>
        <p className="text-xs font-semibold text-accent">Today: {SEASON_NAME[season] ?? season}</p>
      </div>
    </button>
  );
}

export function ThemeView() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const [error, setError] = useState<string | null>(null);

  const season = seasonOf(new Date());
  const painting = resolvedTheme(theme);

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
          <div>
            <h3 className="eyebrow">{group.title}</h3>
            {group.note && <p className="mt-1 text-sm text-muted">{group.note}</p>}
          </div>
          {group.id === 'seasonal' && <AutoCard active={theme === 'season-auto'} season={season} onPick={pick} />}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4 2xl:grid-cols-5">
            {THEMES.filter((t) => t.group === group.id).map((info) => (
              // "In use" marks only a theme chosen by hand. In Automatic mode the Auto card carries it and the season card says Now.
              <ThemeCard key={info.id} info={info} active={info.id === theme} now={group.id === 'seasonal' && info.id === season && (theme === 'season-auto' || painting === info.id)} onPick={pick} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
