// The Go Live console's broadcast layout (Holy Mass and Praise & Worship): the pure rules behind its header, cue navigator, slide editor and
// keys. The React components in src/golive/console/ draw them; nothing here touches the live state or the database, so every rule is tested
// on its own (shared/stage-cue.test.js).
import { applyTextCase } from './text-fit.js';

/** Two digits, as every counter in the console reads: 01, 02 … 99, then 100. */
export const pad2 = (n) => String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, '0');

/** mm:ss of a number of seconds (h:mm:ss past an hour). Negative and missing values read 00:00. */
export function clockOf(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${pad2(m)}:${pad2(s)}`;
  return h ? `${pad2(h)}:${mmss}` : mmss;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The segment timer: a stopwatch per segment, with Start / Pause and Reset. `since` is when it last started (ms), null while paused.

/** A stopped timer at zero. */
export const TIMER_ZERO = Object.freeze({ key: null, since: null, banked: 0 });

/** Milliseconds on the timer at `now`. */
export function timerElapsed(timer, now) {
  if (!timer) return 0;
  return Math.max(0, (timer.banked || 0) + (timer.since == null ? 0 : Math.max(0, now - timer.since)));
}

/**
 * The timer after one action at `now`. `start` and `pause` are idempotent; `toggle` flips; `reset` puts it to zero and stops it; `segment`
 * moves it to another segment: zero again, and running when `run` is set (a run on air times its new segment from its first slide).
 */
export function timerReducer(timer, action, now) {
  const t = timer ?? TIMER_ZERO;
  switch (action.type) {
    case 'start':
      return t.since != null ? t : { ...t, since: now };
    case 'pause':
      return t.since == null ? t : { ...t, since: null, banked: timerElapsed(t, now) };
    case 'toggle':
      return timerReducer(t, { type: t.since == null ? 'start' : 'pause' }, now);
    case 'reset':
      return { ...t, since: null, banked: 0 };
    case 'segment':
      if (action.key === t.key) return action.run && t.since == null && t.banked === 0 ? { ...t, since: now } : t;
      return { key: action.key ?? null, since: action.run ? now : null, banked: 0 };
    default:
      return t;
  }
}

/** How full the progress track is (0–100) and whether the segment ran over its planned length. No plan: an empty track, never over. */
export function timerProgress(elapsedMs, plannedMs) {
  if (!(plannedMs > 0)) return { percent: 0, over: false };
  return { percent: Math.min(100, Math.max(0, (elapsedMs / plannedMs) * 100)), over: elapsedMs > plannedMs };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The output status pill.

/**
 * What the congregation sees now, in one word: 'blackout' (red), 'hidden' (amber: the words are hidden, the background stays), 'onAir'
 * (green: this run's slides are up) or 'offAir' (something else has the screen, or nothing does). Blackout wins over Hide Text.
 */
export function outputStatus(live, runOnAir) {
  const p = live?.projector;
  if (p?.live?.kind === 'blackout') return 'blackout';
  if (p?.textHidden === true) return 'hidden';
  return runOnAir ? 'onAir' : 'offAir';
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Jump to Cue: the cue cards, their search and their tabs. A cue is { index, number, tag, text, group?, hotkey? }: `index` is the step it goes
// to, `number` the 1-based slide number shown on the card, `tag` its section (Verse 1, Chorus, Slide 3), `group` the song it belongs to.

/** The text a cue card previews, in the projector's case, on one line. */
export function cueText(text, textCase) {
  return applyTextCase(String(text ?? ''), textCase).replace(/\s+/g, ' ').trim();
}

/** The filter tabs: All, then each song title and each section tag in the order they first come. A tag used once still gets its tab. */
export function cueTabs(cues) {
  const tabs = [];
  const seen = new Set();
  const add = (value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    tabs.push(value);
  };
  for (const cue of cues) add(cue.group);
  for (const cue of cues) add(baseTag(cue.tag));
  return tabs;
}

/** A tag without its part ("Verse 1 (2/3)" is "Verse 1"), so the parts of one stanza share a tab. */
export function baseTag(tag) {
  return String(tag ?? '').replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
}

/**
 * The cues a search and a tab leave. The search matches the words (in any case), the tag, or the slide number: "#7" or "7" finds slide 7
 * (and any slide whose words contain 7). `tab` null (or 'All') keeps every cue; otherwise a cue whose song or tag is the tab.
 */
export function filterCues(cues, { query = '', tab = null } = {}) {
  const q = String(query).trim().toLowerCase();
  const number = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
  return cues.filter((cue) => {
    if (tab && tab !== 'All' && cue.group !== tab && baseTag(cue.tag) !== tab) return false;
    if (!q) return true;
    if (number !== null && cue.number === number) return true;
    const words = `${cue.text ?? ''} ${cue.tag ?? ''} ${cue.group ?? ''}`.toLowerCase();
    return words.includes(q.replace(/^#/, ''));
  });
}

/** The number key (1–9) each cue answers to: the first nine cues that take one (a song's title card and the black step take none). */
export function cueKeys(cues) {
  const keys = new Map();
  for (const cue of cues) {
    if (cue.hotkey === false) continue;
    if (keys.size >= 9) break;
    keys.set(cue.index, keys.size + 1);
  }
  return keys;
}

/** Where a cue sits against the slide on air: 'live', 'next' (the one Next goes to) or null. */
export function cueState(cue, activeIndex) {
  if (cue.index === activeIndex) return 'live';
  if (activeIndex >= 0 && cue.index === activeIndex + 1) return 'next';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The slide editor: Staged Draft (safe, the default) or Live Sync. Its state is
//   { mode: 'staged' | 'live', key, base: { text, tag }, draft: { text, tag }, confirmDelete }
// `base` is the slide as it is on air; `draft` what the operator typed. In Staged Draft a change waits for Apply to Live; in Live Sync the
// console applies it as soon as the typing pauses (shouldApplyLive).

export const EDITOR_MODES = ['staged', 'live'];

/** A fresh editor on one slide. */
export function editorInit(slide, mode = 'staged') {
  const base = { text: slide?.text ?? '', tag: slide?.tag ?? null };
  return { mode: mode === 'live' ? 'live' : 'staged', key: slide?.key ?? null, base, draft: base, confirmDelete: false, adding: false };
}

/** True while the draft differs from the slide on air. */
export const editorDirty = (state) => state.draft.text !== state.base.text || state.draft.tag !== state.base.tag;

/** In Live Sync with a change typed: the console should apply it now. Never in Staged Draft, never while a new slide is being written. */
export const shouldApplyLive = (state) => state.mode === 'live' && !state.adding && editorDirty(state);

/** Whether Apply to Live and Discard are shown: a change waits in Staged Draft, or a new slide is being written. */
export const draftPending = (state) => state.adding || (state.mode === 'staged' && editorDirty(state));

/**
 * The editor after one action:
 * - `slide` { slide }: the slide on air changed. Another slide (a new key) starts a fresh draft and drops any change and any delete question,
 *   so a draft can never land on the wrong slide. The same slide with new words (saved here or elsewhere) moves the base, and the draft too
 *   when nothing was typed.
 * - `edit` { text?, tag? }: the operator typed.
 * - `applied`: the change was saved; the base is the draft now.
 * - `discard`: back to the slide on air.
 * - `mode` { mode? }: Staged Draft / Live Sync (toggled when absent).
 * - `add`: + Add Slide After: an empty draft for a new slide, with the tag of the slide on air. `discard` or `applied` ends it.
 * - `askDelete` / `cancelDelete`: the two-step Delete Slide. `askDelete` does nothing when `canDelete` is false.
 */
export function editorReducer(state, action) {
  switch (action.type) {
    case 'slide': {
      const next = { text: action.slide?.text ?? '', tag: action.slide?.tag ?? null };
      const key = action.slide?.key ?? null;
      if (key !== state.key) return { ...editorInit(action.slide, state.mode) };
      if (next.text === state.base.text && next.tag === state.base.tag) return state;
      if (state.adding) return { ...state, base: next };
      return { ...state, base: next, draft: editorDirty(state) ? state.draft : next };
    }
    case 'edit':
      return {
        ...state,
        confirmDelete: false,
        draft: { text: action.text ?? state.draft.text, tag: action.tag !== undefined ? action.tag : state.draft.tag },
      };
    case 'applied':
      return state.adding ? { ...state, adding: false, draft: state.base } : { ...state, base: state.draft };
    case 'discard':
      return { ...state, adding: false, draft: state.base, confirmDelete: false };
    case 'mode': {
      const mode = action.mode ?? (state.mode === 'live' ? 'staged' : 'live');
      return mode === state.mode ? state : { ...state, mode };
    }
    case 'add':
      return { ...state, adding: true, confirmDelete: false, draft: { text: '', tag: state.base.tag } };
    case 'askDelete':
      return action.canDelete === false ? state : { ...state, confirmDelete: true };
    case 'cancelDelete':
      return state.confirmDelete ? { ...state, confirmDelete: false } : state;
    default:
      return state;
  }
}

/** Delete Slide is offered only while the item has more than one slide, so an item is never emptied from air. */
export const canDeleteSlide = (count) => Number.isInteger(count) && count > 1;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The console's own keys. ← → Space and 1–9 are already the operator window's and the cue navigator's (OperatorApp, useChipKeys); the
// console adds B (Blackout), L (Lower Third) and H (Hide Text). None of them fire while the operator is typing.

const CONSOLE_KEYS = { b: 'blackout', l: 'lowerThird', h: 'hideText' };

/** True when focus is in a field: an input, a textarea, a select or an editable element. Keys there are the field's. */
export function isTypingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = String(target.tagName ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable === true) return true;
  return typeof target.closest === 'function' && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/** The action a key press runs on the console, or null. A key with Ctrl, Alt, Meta or Shift, a repeat, or a key typed in a field runs none. */
export function consoleKeyAction(e) {
  if (!e || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  if (isTypingTarget(e.target)) return null;
  return CONSOLE_KEYS[String(e.key ?? '').toLowerCase()] ?? null;
}

/** The key legend under the program monitor, in key order. */
export const CONSOLE_SHORTCUTS = ['← / → / Space', '1–9', 'B', 'L', 'H'];

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Stage backdrop quick themes: one click sets the Live slide background to a dark colour. Hex, because the slide background takes a colour.

export const BACKDROP_THEMES = Object.freeze([
  { id: 'burgundy', color: '#2A0C10' },
  { id: 'obsidian', color: '#15161B' },
  { id: 'ember', color: '#291C0C' },
  { id: 'midnight', color: '#0F172A' },
]);

/** The quick theme the Live slide background shows now, or null (a picture, a video, or a colour of the operator's own). */
export function backdropThemeOf(slideBackground) {
  if (!slideBackground || slideBackground.backgroundType !== 'COLOR') return null;
  const color = String(slideBackground.backgroundColor ?? '').toUpperCase();
  return BACKDROP_THEMES.find((t) => t.color === color)?.id ?? null;
}

/** The Live slide background with a quick theme's colour: a plain colour background, the operator's picture and video files kept for later. */
export function withBackdropTheme(slideBackground, id) {
  const theme = BACKDROP_THEMES.find((t) => t.id === id);
  if (!theme) return slideBackground;
  return { ...(slideBackground ?? {}), backgroundType: 'COLOR', backgroundUrl: null, backgroundColor: theme.color };
}
