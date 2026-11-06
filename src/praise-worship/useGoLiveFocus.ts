import { useEffect } from 'react';
import { setPwState } from './store';
import { isTextEntry } from './textEntry';

/** Turns Go Live focus on or off. Only the layout changes: the projector, the lineup's place and the cue song are left as they are. */
export function setGoLiveFocused(on: boolean) {
  setPwState({ isGoLiveFocused: on });
}

/**
 * While `active`, a plain Escape leaves Go Live focus. It stands down while typing, while `blocked` (a stanza being edited), under a
 * dialog, and for a key another control has already handled. Shift + Escape is left to Quick Live's own exit.
 */
export function useFocusEscape(active: boolean, blocked = false) {
  useEffect(() => {
    if (!active || blocked) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.repeat) return;
      if (isTextEntry(e.target) || document.querySelector('[role="dialog"], dialog[open]')) return;
      e.preventDefault();
      e.stopPropagation();
      setGoLiveFocused(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, blocked]);
}
