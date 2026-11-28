import { useCallback, useEffect, useRef, useState } from 'react';

/** How long "Copied" shows after a copy. */
const COPIED_MS = 2000;

/**
 * Copy to the clipboard with a short "Copied" confirmation. `copied` holds the text last copied while the confirmation shows, so a widget with
 * several values can tell which one it was. A refused clipboard leaves it null.
 */
export function useCopy(): { copied: string | null; copy: (text: string) => void } {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback((text: string) => {
    if (!text) return;
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(text);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(null), COPIED_MS);
      })
      .catch(() => undefined);
  }, []);
  return { copied, copy };
}
