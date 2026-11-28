export function pollWhileVisible(
  run: () => unknown,
  ms: number,
  options?: {
    doc?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (timer: any) => void;
  },
): () => void;

export function createSharedPoll<T>(options: {
  read: () => Promise<T>;
  intervalMs: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: any) => void;
}): {
  refresh: () => Promise<void>;
  subscribe: (listener: (value: T | null) => void) => () => void;
};
