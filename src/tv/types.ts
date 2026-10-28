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
  /** The slide font the operator chose (a key of TEXT_FONTS), or null to keep each slide's own face. */
  font: string | null;
  /** How large the text is drawn, as a share of its normal size: 0.7 to 1.5. 1 is normal. */
  fontScale: number;
}

/** The payload of `/api/remote/stream` for the Secondary display: whether it is on air, and the frame it shows. */
export interface SecondarySnapshot {
  live: boolean;
  frame: SecondaryFrame;
  updatedAt: number;
}
