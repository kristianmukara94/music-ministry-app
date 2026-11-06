import type { CSSProperties } from 'react';
import { useUi, type BoothPreset } from '../state/ui';

/**
 * The booth lighting layer over the operator window, from the preset chosen on the booth clock. It never takes a click (pointer-events: none)
 * and lives in the operator window only, so the projector, the TV, phones and the lower third are never tinted.
 *
 * Red-Shift Booth multiplies the console by a red-amber: blue and green light drop away and whites become a dim red, which keeps the
 * operator's night vision in a dark booth. High Contrast Day lifts contrast and brightness for a sunlit booth.
 */
const LAYER: Record<Exclude<BoothPreset, 'standard'>, CSSProperties> = {
  // The red channel is held below full too, so the whole console is dimmer as well as warmer.
  redShift: { backgroundColor: 'rgb(200 48 12)', mixBlendMode: 'multiply', opacity: 0.9 },
  highContrast: { backdropFilter: 'contrast(1.3) brightness(1.12) saturate(1.1)' },
};

export function BoothLighting() {
  const preset = useUi((s) => s.boothPreset);
  if (preset === 'standard') return null;
  return <div aria-hidden data-booth-preset={preset} className="pointer-events-none fixed inset-0 z-[9999]" style={LAYER[preset]} />;
}
