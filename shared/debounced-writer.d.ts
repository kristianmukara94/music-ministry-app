export interface DebouncedWriter<P extends object> {
  push(patch: P): void;
  flush(): unknown;
  cancel(): void;
  hasPending(): boolean;
}

export function createDebouncedWriter<P extends object>(options: {
  delay: number;
  write: (patch: P) => unknown;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: any) => void;
}): DebouncedWriter<P>;
