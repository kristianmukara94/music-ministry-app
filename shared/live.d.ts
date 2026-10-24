import type { TextStyle } from './text-style';
import type { ProjectorSettings } from './projector-settings';
import type { WelcomeSettings } from './welcome-settings';
import type { LowerThirdStyle } from './lower-third-style';
import type { WhiteboardDesign } from './whiteboard';
export type Lang = 'en' | 'tl' | 'ceb';

export type OutputKey = 'projector' | 'lowerThird' | 'preview';

/** How a line is styled on the projector (e.g. congregation responses stand out). */
export type LineRole = 'priest' | 'all' | 'reader' | 'cantor' | 'response' | 'cite' | 'plain';

export interface SlideLine {
  role: LineRole;
  text: string;
}

/** Which verses a scripture slide shows. The Bible deck reads it to badge the verses that are live or staged. */
export interface PassageMark {
  translationId: string;
  bookNumber: number;
  chapter: number;
  verses: number[];
}

/** Who sent the frame now on the projector: a Mass Queue item, or a direct projection from a module deck. */
export type ProjectionSource = 'MASS_QUEUE' | 'DIRECT_DECK';

export type Frame =
  | { kind: 'idle' }
  | { kind: 'blackout' }
  | { kind: 'welcome'; lang: Lang }
  | { kind: 'announcements'; lang: Lang }
  | { kind: 'deck'; title: string; slides: SlideLine[][]; index: number; passage?: PassageMark; style?: TextStyle | null }
  /** `notes` are the presenter's cues (for a PDF page, the page's text). Only the operator's windows show them. */
  | { kind: 'image'; title: string; src: string; notes?: string }
  /** `notes` are the presenter's cues. Only the operator's windows show them. The projector never renders them. */
  /** `headline` is the large title above the body. Absent for manual text slides, which show `text` alone. */
  | { kind: 'text'; title: string; headline?: string; text: string; bg: string | null; notes?: string; style?: TextStyle | null }
  | { kind: 'lyrics'; title: string; label: string; text: string; style?: TextStyle | null }
  /** Responsorial psalm: the congregation response stays pinned while the verses change. */
  | { kind: 'psalm'; title: string; response: string; pages: string[]; index: number; style?: TextStyle | null }
  /**
   * One step of the Rosary Guide. `text` is the meditation on an announcement step and the prayer
   * on a prayer step. `bead` lights the Hail Mary indicator (1 to 10) and is null otherwise.
   */
  | {
      kind: 'rosary';
      section: string;
      decade: string;
      mystery: string;
      scripture: string;
      prayer: string;
      text: string;
      bead: number | null;
      stage: 'announce' | 'prayer';
      /** Which slide of a long prayer this is, 1-based. Absent when the text fits on one slide. */
      part?: { index: number; total: number };
      style?: TextStyle | null;
    }
  /** A whiteboard slide, drawn from its design. */
  | { kind: 'whiteboard'; slide: { title: string; content: string; design: WhiteboardDesign } };

/** A background layer item: an image or a looping video. */
export interface MediaFrame {
  kind: 'media';
  mediaType: 'image' | 'video';
  src: string;
  title: string;
}

/** The lower-third layouts. An absent template means the nameplate, which is what older lower thirds used. */
export type LowerThirdTemplate = 'nameplate' | 'intention' | 'response';

export interface LowerThird {
  template?: LowerThirdTemplate;
  line1: string;
  line2?: string;
}

/** One entry in the Service Queue: a Mass plan item, routed back to its module when opened. */
export interface QueueItem {
  id: string;
  label: string;
  block: 'introductory' | 'word' | 'eucharist' | 'concluding';
  module: 'lyrics' | 'lectionary' | 'announcements' | 'media' | 'mass_order' | 'bible' | 'custom' | 'notes';
  sourceId: string;
  /** The source was deleted after the plan was saved. Shown flagged; cannot be opened. */
  stale?: boolean;
}

/** A short note sent to the projector from the Bible module. The colours are the chosen text and accent colours. */
export interface NoteOverlay {
  text: string;
  prefix: string | null;
  textColor: string;
  accent: string;
  /** The verse the note is for, for example "2 Kings 1:2". Shown beneath the note. */
  citation?: string | null;
}

/** Slide position in the Announcements deck. `show` says whether the projector draws it. */
export interface SlideCounter {
  show: boolean;
  index: number;
  total: number;
}

export interface LiveState {
  rev: number;
  /** Projector output settings: aspect, fit, idle screen, fade speed. Saved in config.json. */
  settings: ProjectorSettings;
  /** Welcome screen content and style. Saved in config.json, and shown when the welcome screen is live. */
  welcome: WelcomeSettings;
  /** The calibration grid is shown on the projector. */
  calibration: boolean;
  /** The Announcements deck's counter while it is open; null when no deck is. */
  counter: SlideCounter | null;
  /** A note overlay sent from the Bible module, or null. */
  noteOverlay: NoteOverlay | null;
  /** The lower third's look. */
  lowerStyle: LowerThirdStyle;
  outputs: Record<OutputKey, boolean>;
  projector: {
    live: Frame;
    staged: Frame;
    paused: boolean;
    beforeBlackout: Frame | null;
    background: { live: MediaFrame | null; staged: MediaFrame | null };
    /** Where the frame on the projector came from. Null when nothing is live. */
    source: ProjectionSource | null;
  };
  lowerThird: { live: LowerThird | null; staged: LowerThird | null; paused: boolean };
  queue: QueueItem[];
  /** The Mass plan the queue was loaded from; persisted so the queue survives a restart. */
  queuePlanId: number | null;
  /** Index of the item last opened from the queue, or -1 before the first. */
  queueCursor: number;
}

export type LiveAction =
  | { type: 'output/toggle'; output: OutputKey }
  | { type: 'output/set'; output: OutputKey; on: boolean }
  /** A direct show ends the Mass Queue's selection. Overlays from the operator's buttons pass DIRECT_DECK. */
  | { type: 'projector/show'; frame: Frame; source?: ProjectionSource }
  | { type: 'projector/stage'; frame: Frame }
  | { type: 'projector/take'; source?: ProjectionSource }
  | { type: 'background/stage'; media: MediaFrame }
  | { type: 'background/take' }
  | { type: 'background/clear' }
  | { type: 'projector/clear' }
  | { type: 'projector/blackout' }
  | { type: 'projector/pause'; paused?: boolean }
  | { type: 'projector/step'; delta: number }
  | { type: 'lowerThird/show'; value: LowerThird }
  | { type: 'lowerThird/clear' }
  | { type: 'lowerThird/toggle' }
  | { type: 'lowerThird/stage'; value: LowerThird }
  | { type: 'settings/projector'; value: Partial<ProjectorSettings> }
  | { type: 'settings/welcome'; value: Partial<WelcomeSettings> }
  | { type: 'calibration/toggle' }
  | { type: 'counter/set'; counter: SlideCounter | null }
  | { type: 'noteOverlay/show'; value: NoteOverlay }
  | { type: 'noteOverlay/clear' }
  | { type: 'lowerStyle/set'; value: Partial<LowerThirdStyle> }
  | { type: 'lowerThird/pause'; paused?: boolean }
  | { type: 'stop' }
  | { type: 'queue/set'; items: QueueItem[]; planId?: number | null }
  | { type: 'queue/cursor'; index: number };

export const OUTPUTS: OutputKey[];
export function initialLiveState(): LiveState;
export function liveReducer(state: LiveState, action: LiveAction): LiveState;
