export function prefetchWhenIdle(
  loaders: ReadonlyArray<() => Promise<unknown>>,
  options: {
    delayMs?: number;
    idle: (callback: () => void) => number;
    cancelIdle?: (handle: number) => void;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (timer: any) => void;
  },
): () => void;
