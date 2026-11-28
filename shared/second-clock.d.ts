export function createSecondClock(options?: {
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: any) => void;
}): {
  subscribe: (listener: () => void) => () => void;
  read: () => number;
};
