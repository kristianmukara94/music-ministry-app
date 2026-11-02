import { useEffect, useMemo, useRef } from 'react';
import { createDebouncedWriter } from '../../shared/debounced-writer.js';
import type { ProjectorSettings } from '../../shared/projector-settings.js';
import { dispatch } from '../live/store';

/** How long a dragged control waits, after it last moved, before the setting is written to the settings file. */
export const SETTING_SAVE_DELAY_MS = 300;

/**
 * An output setting that follows a control as it is dragged (a colour picker) without writing the settings file on every step.
 *
 * Each change goes straight into the live state, which the main process sends to the projector, the mirror and the previews at once, so the
 * screen keeps up with the drag. Writing it to disk waits until the control has been still for 300 ms, and only the last value is written.
 * Leaving the page, closing the window, or calling `flush` writes a waiting change at once, so a change is never lost. `cancel` drops it,
 * for when a click saves another value straight away and the waiting one must not overwrite it.
 */
export function useInstantSetting(save: (patch: Partial<ProjectorSettings>) => unknown) {
  // The latest save, so the writer made once below never calls an old one.
  const saveRef = useRef(save);
  saveRef.current = save;
  const writer = useMemo(() => createDebouncedWriter<Partial<ProjectorSettings>>({ delay: SETTING_SAVE_DELAY_MS, write: (patch) => saveRef.current(patch) }), []);

  useEffect(() => {
    const flush = () => writer.flush();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [writer]);

  return useMemo(
    () => ({
      /** Shows the change now, and writes it once the control is still. */
      set(patch: Partial<ProjectorSettings>) {
        dispatch({ type: 'settings/projector', value: patch });
        writer.push(patch);
      },
      flush: () => writer.flush(),
      cancel: () => writer.cancel(),
    }),
    [writer],
  );
}
