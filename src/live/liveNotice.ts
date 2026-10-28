import { create } from 'zustand';

/** A notice about what is on the projector, shown in the operator console until the operator dismisses it. */
export interface LiveNotice {
  /** 'deleted': the song or prayer on screen was deleted, and stays on screen until the operator clears it. 'moved': the operator's place moved. */
  kind: 'deleted' | 'moved';
  text: string;
}

interface LiveNoticeState {
  notice: LiveNotice | null;
  show: (notice: LiveNotice) => void;
  clear: () => void;
}

/** The one notice the operator console shows. Not saved: it describes the live screen of this session only. */
export const useLiveNotice = create<LiveNoticeState>()((set) => ({
  notice: null,
  show: (notice) => set({ notice }),
  clear: () => set({ notice: null }),
}));
