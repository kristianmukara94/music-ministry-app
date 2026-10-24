import { useUi } from '../state/ui';
import { DATE_LOCALES, useT } from '../i18n/strings';
import { Panel } from './Panel';
import { useNow } from './useNow';

/**
 * The booth clock: one 12-hour readout with seconds, and the date beneath it. The time is shown once, so the
 * card never repeats itself. Digits are tabular, so the width does not shift as the seconds change.
 */
export function BoothClock() {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const now = useNow();
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const date = now.toLocaleDateString(DATE_LOCALES[lang], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <Panel eyebrow={t('clock.eyebrow')} title={t('clock.title')}>
      <div className="flex h-full flex-col justify-center gap-2 px-5 py-5">
        <time
          dateTime={now.toISOString()}
          className="font-mono text-[44px] leading-none font-extrabold tracking-tight text-fg tabular-nums drop-shadow-[0_0_12px_rgba(236,201,138,0.12)]"
          aria-live="off"
        >
          {time}
        </time>
        <div className="h-px w-16 bg-accent/50" aria-hidden />
        <div className="text-sm font-medium tracking-wide text-fg/70">{date}</div>
      </div>
    </Panel>
  );
}
