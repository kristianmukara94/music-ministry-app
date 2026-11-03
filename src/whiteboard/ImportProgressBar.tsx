import { importLabel } from '../../shared/import-progress';
import type { ImportProgress } from './types';

/**
 * How far a PowerPoint import has got: the percentage, what it is doing ("Importing 4 / 12 slides…"), and a bar. Shown in place of the static
 * "Importing…" while the import runs. Before the first report arrives it shows an empty bar at 0%.
 */
export function ImportProgressBar({ progress }: { progress: ImportProgress | null }) {
  const progressPercentage = progress?.percentage ?? 0;
  return (
    <div role="progressbar" aria-label="PowerPoint import" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercentage} aria-valuetext={`${progressPercentage}%, ${importLabel(progress)}`} className="flex min-w-0 items-center gap-3">
      <span className="w-10 shrink-0 text-right text-sm font-bold text-accent tabular-nums">{progressPercentage}%</span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="w-48 bg-gray-700 h-2 rounded-full overflow-hidden">
          <div className="bg-amber-500 h-full transition-all duration-300 ease-out" style={{ width: `${progressPercentage}%` }} />
        </div>
        <p className="truncate text-xs text-fg/70" aria-live="polite">{importLabel(progress)}</p>
      </div>
    </div>
  );
}
