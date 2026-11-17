import { create } from 'zustand';
import { textCaseOf, type TextCase } from '../../shared/text-fit.js';

const KEY = 'apcc.plannerTextCase';

function read(): TextCase {
  try {
    return textCaseOf(window.localStorage.getItem(KEY));
  } catch {
    return 'original';
  }
}

/**
 * The Planner's text case (Aa / AA / aa): how the lineup titles, the inline lyrics drawers and the printed lineup read in the Holy Mass
 * Planner and the Praise & Worship workspace. One choice for both planners, remembered on this computer. It is the operator's view only:
 * the projector has its own case in the Live Quick Controls, and nothing in the library is changed.
 */
export const usePlannerTextCase = create<{ mode: TextCase; set: (mode: TextCase) => void }>((set) => ({
  mode: read(),
  set: (mode) => {
    const next = textCaseOf(mode);
    set({ mode: next });
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // A blocked store only means the choice is not kept for next time.
    }
  },
}));

/** The Tailwind class that shows text in `mode` on screen: CSS only, so the words underneath (and copy and paste) stay as typed. */
export function textCaseClass(mode: TextCase): string {
  return mode === 'uppercase' ? 'uppercase' : mode === 'lowercase' ? 'lowercase' : '';
}
