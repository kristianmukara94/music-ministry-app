import { useMemo } from 'react';
import { Clock } from 'lucide-react';
import { useUi, setUi } from '../state/ui';
import { DATE_FORMATS, formatDayAndClock, timeZoneOptions, useSystemRegion, type DateFormat, type RegionMode, type RegionSettings as RegionChoice } from '../state/region';
import { useRegion } from '../state/useRegion';
import { useNow } from '../operator/useNow';

const SELECT = 'h-11 rounded-md border border-line-strong bg-canvas px-3 text-sm outline-none focus:border-accent';

/** The Region card: Auto follows the laptop, Manual sets the zone and formats by hand. Saved in the UI settings store. */
export function RegionSettings() {
  const choice = useUi((s) => s.region);
  const region = useRegion();
  const now = useNow();
  const zones = useMemo(() => timeZoneOptions(choice.timeZone), [choice.timeZone]);

  const update = (patch: Partial<RegionChoice>) => setUi({ region: { ...choice, ...patch } });

  const changeMode = (mode: RegionMode) => {
    if (mode === 'manual' && choice.mode === 'auto') {
      // Manual starts from what Auto is showing now, so switching does not change the clock by itself.
      const system = useSystemRegion.getState().system;
      update({ mode, timeZone: system.timeZone, hour12: system.hour12, dateFormat: system.dateFormat });
    } else {
      update({ mode });
    }
  };

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-line bg-panel p-5 backdrop-blur-md">
      <h2 className="mb-1 border-b border-line pb-2 text-xl font-black uppercase condensed">Region</h2>

      <label className="flex flex-col gap-2">
        <span className="eyebrow flex items-center gap-2">
          <Clock size={14} aria-hidden /> Time and date
        </span>
        <select value={choice.mode} onChange={(e) => changeMode(e.target.value as RegionMode)} className={SELECT}>
          <option value="auto">Auto (follow this laptop)</option>
          <option value="manual">Manual</option>
        </select>
      </label>

      {choice.mode === 'manual' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-2 sm:col-span-3">
            <span className="eyebrow">Time zone</span>
            <select value={choice.timeZone} onChange={(e) => update({ timeZone: e.target.value })} className={SELECT}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>{zone}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="eyebrow">Clock</span>
            <select value={choice.hour12 ? '12' : '24'} onChange={(e) => update({ hour12: e.target.value === '12' })} className={SELECT}>
              <option value="12">12-hour</option>
              <option value="24">24-hour</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 sm:col-span-2">
            <span className="eyebrow">Date format</span>
            <select value={choice.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as DateFormat })} className={SELECT}>
              {DATE_FORMATS.map((format) => (
                <option key={format} value={format}>{format}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <p aria-live="polite" className="rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-sm text-fg">
        {`${region.mode === 'auto' ? 'Auto' : 'Manual'} · ${region.timeZone} · ${formatDayAndClock(now, region)}`}
      </p>
      <p className="text-xs text-muted">
        Auto follows this laptop&apos;s time zone. Use Manual if the laptop&apos;s clock is set to the wrong region.
      </p>
    </section>
  );
}
