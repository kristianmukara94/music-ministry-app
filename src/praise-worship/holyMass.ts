import type { LiveState } from '../../shared/live.js';
import { useLive } from '../live/store';

/**
 * Whether the Holy Mass is what is on air: the Mass Queue has a place and it was the last to take the projector. The order of the Mass is
 * fixed liturgy, so changing a song's words or adding a slide while it is on air is closed (see useLiveHotEditor): a song edited now would
 * also replace the words on the Holy Mass slide. Praise & Worship and Quick Live are not the Holy Mass, so they keep their live editing.
 */
export const holyMassOnAir = (state: LiveState): boolean => state.queueCursor >= 0 && state.projector.source === 'MASS_QUEUE' && state.projector.live.kind !== 'idle';

export const useHolyMassOnAir = (): boolean => useLive((s) => holyMassOnAir(s.state));

/** What an edit that was attempted anyway is told. The controls are hidden, so this is only the last line of defence. */
export const HOLY_MASS_LOCKED = 'Editing slides on air is turned off while the Holy Mass is on air.';
