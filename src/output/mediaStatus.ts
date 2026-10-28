import { useSyncExternalStore } from 'react';

/**
 * The background files that would not load in this window, with the reason, so the setting that chose one can say so. Keyed by the file's
 * address: a file that loads later (or a new file) is not reported.
 */
const failed = new Map<string, string>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export function reportMediaFailed(src: string, reason: string) {
  if (failed.get(src) === reason) return;
  failed.set(src, reason);
  emit();
}

export function clearMediaFailed(src: string) {
  if (failed.delete(src)) emit();
}

/** Why the given background file could not be shown in this window, or null when it has not failed. */
export function useMediaFailed(src: string | null): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (src !== null ? failed.get(src) ?? null : null),
  );
}
