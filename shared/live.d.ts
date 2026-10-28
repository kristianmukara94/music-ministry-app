import type { TextStyle } from './text-style';
import type { ProjectorSettings } from './projector-settings';
import type { WelcomeSettings } from './welcome-settings';
import type { LowerThirdStyle } from './lower-third-style';
import type { WhiteboardDesign } from './whiteboard';
import type { PwSlide, PwType } from './pw';
export type Lang = 'en' | 'tl' | 'ceb';

export type DisplayMode = 'dual' | 'independent';
export interface DisplayTarget {
  live: boolean;
  frame: Frame;
  staged: Frame;
  layout: 'screen-16x9';
}
export interface DisplayState {
  mode: DisplayMode;
  targets: { secondary: DisplayTarget };
}

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
export type ProjectionSource = 'MASS_QUEUE' | 'DIRECT_DECK' | 'PW_SESSION';

/** The frame an output shows for a live frame: the intro slide is a solid black screen in black mode. */
export function presentedFrame(frame: Frame, introSlideMode: 'title' | 'black'): Frame;

/** True when the projector or the Secondary display is live. The projector prompt asks only when this is false. */
export function isAnyOutputLive(state: LiveState): boolean;

/** The look the audience sees: the look captured at the pause while the projector is paused, else the working look. */
export interface OutputLook {
  slideFont: string | null;
  slideFontScale: number;
  introSlideMode: LiveState['introSlideMode'];
  welcome: LiveState['welcome'];
}
export function outputLookOf(state: LiveState): OutputLook;

/** The state with the on-air look in place of the working one. The same object when the two looks are the same. */
export function applyLook(state: LiveState): LiveState;

export type Frame =
  | { kind: 'idle' }
  | { kind: 'blackout' }
  /** A solid black screen: an intro slide shown as black. Nothing is drawn on it. */
  | { kind: 'black' }
  | { kind: 'welcome'; lang: Lang }
  | { kind: 'announcements'; lang: Lang }
  | { kind: 'deck'; title: string; slides: SlideLine[][]; index: number; passage?: PassageMark; style?: TextStyle | null }
  /** `notes` are the presenter's cues (for a PDF page, the page's text). Only the operator's windows show them. */
  | { kind: 'image'; title: string; src: string; notes?: string }
  /** `notes` are the presenter's cues. Only the operator's windows show them. The projector never renders them. */
  /** `headline` is the large title above the body. Absent for manual text slides, which show `text` alone. */
  | { kind: 'text'; title: string; headline?: string; text: string; bg: string | null; notes?: string; style?: TextStyle | null; page?: { index: number; total: number }; key?: string; top?: number; centred?: boolean }
  | { kind: 'lyrics'; title: string; label: string; text: string; style?: TextStyle | null; key?: string; song?: { hymnId: number; position: number; count: number } }
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
  | { kind: 'whiteboard'; slide: { title: string; content: string; design: WhiteboardDesign } }
  /** One Praise & Worship slide, drawn by PwSlideFace. `index` and `total` count the segment's slides. */
  | { kind: 'pw'; slide: PwSlide; segmentName: string; type: PwType; index: number; total: number; footer?: string };

/** A background layer item: an image or a looping video. */
export interface MediaFrame {
  kind: 'media';
  mediaType: 'image' | 'video';
  src: string;
  title: string;
}

/** The lower-third layouts. An absent template means the nameplate, which is what older lower thirds used. */
export type LowerThirdTemplate = 'nameplate' | 'intention' | 'response' | 'segment';

export interface LowerThird {
  template?: LowerThirdTemplate;
  line1: string;
  line2?: string;
  /** The small tag above the bar on the `segment` template: the Praise & Worship segment's name. */
  tag?: string;
}

/** The Praise & Worship session loaded for live use. */
export interface PwLive {
  sessionId: number;
  /** The live segment's key. Null at the start of the lineup. Held by key so reordering the lineup does not move it. */
  segmentKey: string | null;
  slide: number;
  /** When the current segment went on air (ms since epoch), for the segment timer. Null before it has. */
  startedAt: number | null;
  /** When the session first went on air, for the session clock. */
  liveSince: number | null;
  /** True while the projector shows this session. Anything else taking the projector clears it. */
  onAir: boolean;
}

/** One entry in the Service Queue: a Mass plan item, routed back to its module when opened. */
export interface QueueItem {
  id: string;
  label: string;
  block: 'introductory' | 'word' | 'eucharist' | 'communion' | 'concluding';
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
  /** The operator's choice for the intro slide: its Title Card, or a solid black screen. */
  introSlideMode: 'title' | 'black';
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
  /** The operator's last choice for the Lower 3rd: 'on' or 'off' once pressed, null before. Slide cues do not change it. */
  lowerThird: { live: LowerThird | null; staged: LowerThird | null; paused: boolean; choice: 'on' | 'off' | null };
  /** The secondary display (the TV). `mode` dual mirrors the projector; independent shows the secondary's own frame. */
  display: DisplayState;
  queue: QueueItem[];
  /** The Mass plan the queue was loaded from; persisted so the queue survives a restart. */
  queuePlanId: number | null;
  /** Index of the item last opened from the queue, or -1 before the first. */
  queueCursor: number;
  pw: PwLive | null;
}

export type LiveAction =
  | { type: 'output/toggle'; output: OutputKey }
  | { type: 'output/set'; output: OutputKey; on: boolean }
  /** A direct show ends the Mass Queue's selection. Overlays from the operator's buttons pass DIRECT_DECK. */
  | { type: 'projector/show'; frame: Frame; source?: ProjectionSource }
  /** Replaces the live (and staged) slide whose `key` matches, when its song or prayer was edited. Nothing else changes. */
  | { type: 'projector/refresh'; key: string; frame: Frame }
  | { type: 'projector/stage'; frame: Frame }
  | { type: 'projector/take'; source?: ProjectionSource }
  | { type: 'background/stage'; media: MediaFrame }
  | { type: 'background/take' }
  | { type: 'background/clear' }
  | { type: 'projector/clear' }
  | { type: 'projector/blackout' }
  | { type: 'projector/pause'; paused?: boolean }
  | { type: 'projector/step'; delta: number }
  | { type: 'display/mode'; value: DisplayState['mode'] }
  | { type: 'display/live'; value: boolean }
  | { type: 'display/show'; frame: Frame }
  | { type: 'lowerThird/show'; value: LowerThird }
  | { type: 'lowerThird/clear' }
  | { type: 'lowerThird/toggle' }
  | { type: 'lowerThird/stage'; value: LowerThird }
  | { type: 'settings/projector'; value: Partial<ProjectorSettings> }
  | { type: 'settings/welcome'; value: Partial<WelcomeSettings> }
  | { type: 'calibration/toggle' }
  | { type: 'introSlide/set'; value: 'title' | 'black' }
  | { type: 'counter/set'; counter: SlideCounter | null }
  | { type: 'noteOverlay/show'; value: NoteOverlay }
  | { type: 'noteOverlay/clear' }
  | { type: 'lowerStyle/set'; value: Partial<LowerThirdStyle> }
  | { type: 'lowerThird/pause'; paused?: boolean }
  | { type: 'stop' }
  | { type: 'queue/set'; items: QueueItem[]; planId?: number | null }
  | { type: 'queue/cursor'; index: number }
  | { type: 'pw/load'; sessionId: number }
  | { type: 'pw/cursor'; segmentKey: string; slide: number; now: number }
  | { type: 'pw/end' };

export const OUTPUTS: OutputKey[];
export function initialLiveState(): LiveState;
export function liveReducer(state: LiveState, action: LiveAction): LiveState;
