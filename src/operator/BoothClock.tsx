import { Moon, Sun } from 'lucide-react';
import { useUi } from '../state/ui';
import { formatClock, formatDay, formatWeekday } from '../state/region';
import { useRegion } from '../state/useRegion';
import { DATE_LOCALES, useT } from '../i18n/strings';
import { Panel } from './Panel';
import { useNow } from './useNow';

/**
 * The booth clock: one readout with seconds, and the date beneath it. The time is shown once, so the
 * card never repeats itself. Digits are tabular, so the width does not shift as the seconds change.
 * The zone, clock style and date format come from the Region setting.
 */
export function BoothClock() {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const region = useRegion();
  const now = useNow();
  const time = formatClock(now, region, { seconds: true });
  const date = `${formatWeekday(now, region, DATE_LOCALES[lang])}, ${formatDay(now, region)}`;
  // Sun by day, moon by night, from the hour the clock itself shows. It is a readout, not a switch.
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: region.timeZone }).format(now));
  const night = hour < 6 || hour >= 18;

  return (
    <Panel
      eyebrow={t('clock.eyebrow')}
      action={
        <span className="flex shrink-0 items-center gap-2" title={night ? 'Night' : 'Day'} role="img" aria-label={night ? 'Night' : 'Day'}>
          <Moon size={18} aria-hidden className={night ? 'text-accent' : 'text-fg/45'} />
          <Sun size={18} aria-hidden className={night ? 'text-fg/45' : 'text-accent'} />
        </span>
      }
    >
      <div className="flex h-full flex-col items-center justify-center gap-1 px-5 py-5 text-center">
        <div className="text-lg font-medium text-accent">{t('clock.title')}</div>
        <time
          dateTime={now.toISOString()}
          className="font-mono text-5xl leading-none font-bold tracking-tight xl:text-[64px] text-accent tabular-nums [text-shadow:0_0_20px_color-mix(in_oklab,var(--color-accent)_45%,transparent),0_0_40px_color-mix(in_oklab,var(--color-accent)_15%,transparent)]"
          aria-live="off"
        >
          {time}
        </time>
        <div className="mt-2 text-lg font-medium tracking-wide text-accent">{date}</div>
      </div>
    </Panel>
  );
}
