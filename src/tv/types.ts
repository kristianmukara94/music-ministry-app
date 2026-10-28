/** One frame of the Secondary display, as the Secondary port sends it. Text is plain text, and the media is named by its library id. */
export interface SecondaryFrame {
  kind: 'slide' | 'blackout' | 'idle' | 'off';
  title: string;
  lines: string[];
  /** The background colour, or null to keep the screen's own dark colour. */
  color: string | null;
  /** The Media Library id of the background picture or video, or null. */
  mediaId: string | null;
  mediaKind: 'image' | 'video' | null;
  fit: 'cover' | 'contain' | null;
  loop: boolean | null;
  shade: boolean;
}

/** The payload of `/api/remote/stream` for the Secondary display: whether it is on air, and the frame it shows. */
export interface SecondarySnapshot {
  live: boolean;
  frame: SecondaryFrame;
  updatedAt: number;
}
