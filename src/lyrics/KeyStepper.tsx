import { Minus, Plus } from 'lucide-react';
import { MAX_TRANSPOSE, parseKey, transposeKey, transposeLabel } from '../../shared/setlist-tools.js';
import type { LyT } from './strings';

const STEP = 'grid size-6 place-items-center rounded border border-fg/15 bg-panel-2 text-fg/80 transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-30';

/**
 * The Live Cues key stepper: "Key: E [−] [+]". Each step moves the song a semitone for this setlist and session; the song's own key in
 * the library is left as it is. Pressing the shift (+2) puts the song back in its own key. A song with no key, or one that cannot be read,
 * shows its key with the steppers off.
 */
export function KeyStepper({ musicalKey, semitones, onChange, t }: { musicalKey: string; semitones: number; onChange: (next: number) => void; t: LyT }) {
  const readable = parseKey(musicalKey) !== null;
  const shown = readable ? transposeKey(musicalKey, semitones) : musicalKey.trim() || '—';
  const shift = transposeLabel(semitones);

  return (
    <span role="group" aria-label={t('keyStepper')} className="inline-flex items-center gap-1.5">
      <span className="text-muted">{t('keyLabel')}:</span>
      <span className={`min-w-6 font-mono text-sm font-bold ${shift ? 'text-accent' : 'text-fg'}`} aria-live="polite">
        {shown}
      </span>
      <button type="button" onClick={() => onChange(semitones - 1)} disabled={!readable || semitones <= -MAX_TRANSPOSE} aria-label={t('keyDown')} title={t('keyDown')} className={STEP}>
        <Minus size={11} aria-hidden />
      </button>
      <button type="button" onClick={() => onChange(semitones + 1)} disabled={!readable || semitones >= MAX_TRANSPOSE} aria-label={t('keyUp')} title={t('keyUp')} className={STEP}>
        <Plus size={11} aria-hidden />
      </button>
      {shift && (
        <button
          type="button"
          onClick={() => onChange(0)}
          title={t('keyReset', { key: musicalKey })}
          aria-label={t('keyReset', { key: musicalKey })}
          className="rounded-full border border-accent/40 bg-accent/10 px-1.5 font-mono text-[10px] font-bold text-accent hover:bg-accent/20"
        >
          {shift}
        </button>
      )}
    </span>
  );
}
