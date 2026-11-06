import { Moon, Sun } from 'lucide-react';
import { BOOTH_PRESETS, setUi, useUi, type BoothPreset } from '../state/ui';
import { formatClock, formatDay, formatWeekday } from '../state/region';
import { useRegion } from '../state/useRegion';
import { DATE_LOCALES, useT, type StringKey } from '../i18n/strings';
import { Panel } from './Panel';
import { useNow } from './useNow';

const PRESET_LABEL: Record<BoothPreset, StringKey> = {
  standard: 'booth.standard',
  redShift: 'booth.redShift',
  highContrast: 'booth.highContrast',
};

/** The clock's own colours per preset. The window-wide wash is BoothLighting; these keep the readout legible under it. */
const CLOCK_TONE: Record<BoothPreset, { text: string; glow: string }> = {
  standard: {
    text: 'text-accent',
    glow: '[text-shadow:0_0_20px_color-mix(in_oklab,var(--color-accent)_45%,transparent),0_0_40px_color-mix(in_oklab,var(--color-accent)_15%,transparent)]',
  },
  redShift: { text: 'text-[#ff5a3c]', glow: '[text-shadow:0_0_18px_rgb(255_60_30/0.35)]' },
  highContrast: { text: 'text-fg', glow: '' },
};

/** Standard Dark, Red-Shift Booth and High Contrast Day, as a segmented switch. The choice is saved with the operator's preferences. */
function PresetSwitch() {
  const t = useT();
  const preset = useUi((s) => s.boothPreset);
  return (
    <div role="radiogroup" aria-label={t('booth.preset')} className="flex flex-wrap justify-center gap-1 rounded-lg border border-fg/10 bg-fg/[0.04] p-1">
      {BOOTH_PRESETS.map((p) => (
        <button key={p} type="button" role="radio" aria-checked={preset === p} onClick={() => setUi({ boothPreset: p })}
          className={`rounded-md px-2.5 py-1 text-[11px] font-bold tracking-wide whitespace-nowrap transition ${
            preset === p ? 'bg-fg text-canvas' : 'text-fg/70 hover:bg-fg/10 hover:text-fg'
          }`}>
          {t(PRESET_LABEL[p])}
        </button>
      ))}
    </div>
  );
}

/**
 * The booth clock: one readout with seconds, and the date beneath it. The time is shown once, so the
 * card never repeats itself. Digits are tabular, so the width does not shift as the seconds change.
 * The zone, clock style and date format come from the Region setting. Below it, the booth lighting presets.
 */
export function BoothClock() {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const preset = useUi((s) => s.boothPreset);
  const region = useRegion();
  const now = useNow();
  const time = formatClock(now, region, { seconds: true });
  const date = `${formatWeekday(now, region, DATE_LOCALES[lang])}, ${formatDay(now, region)}`;
  // Sun by day, moon by night, from the hour the clock itself shows. It is a readout, not a switch.
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: region.timeZone }).format(now));
  const night = hour < 6 || hour >= 18;
  const tone = CLOCK_TONE[preset];

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
        <div className={`text-lg font-medium ${tone.text}`}>{t('clock.title')}</div>
        <time
          dateTime={now.toISOString()}
          className={`font-mono text-5xl leading-none font-bold tracking-tight xl:text-[64px] tabular-nums ${tone.text} ${tone.glow}`}
          aria-live="off"
        >
          {time}
        </time>
        <div className={`mt-2 text-lg font-medium tracking-wide ${tone.text}`}>{date}</div>
        <div className="mt-4">
          <PresetSwitch />
        </div>
      </div>
    </Panel>
  );
}
