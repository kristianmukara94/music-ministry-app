import { create } from 'zustand';
import { hymnAfterChange, withHymn } from '../../shared/hymn-cache.js';
import { persist } from 'zustand/middleware';
import { addLineupCard, chainAssignment, chainOf, groupOrdered, newLineupCard, removeLineupCard, type PwHymnTag, type PwResolved, type PwSegment, type PwType } from '../../shared/pw.js';
import type { LibraryDragBatch } from '../../shared/pw-attach.js';
import { arrangementWithSplit } from '../../shared/pw-hot-edit.js';
import { bridge } from '../live/bridge';
import { liveLyrics } from '../live/liveSongEdits';
import type { Hymn } from '../lyrics/types';
import type { Note } from '../notes/types';
import type { LectionaryDay } from '../lectionary/types';
import type { PwSession, PwSessionSummary, PwTemplate } from './types';

export type PwTab = 'plan' | 'live' | 'outputs';

/** Waiting for an edit to settle before saving, so typing in a field saves once, not per key. */
const SAVE_DELAY_MS = 400;

interface PwState {
  /** Persisted: the view and the session the operator last had open. */
  tab: PwTab;
  sessionId: number | null;
  sessions: PwSessionSummary[];
  templates: PwTemplate[];
  /** The open session. Its segments are always in group order, so an index means the same row everywhere. */
  session: PwSession | null;
  selected: number;
  tags: PwHymnTag[];
  /** Hymns with their stanzas, loaded as segments need them. */
  hymns: Record<number, Hymn>;
  /** Prayers that can be projected (operator-only notes are left out). */
  prayers: Note[];
  /** The Lectionary for the session date, for the Gospel Acclamation. */
  day: LectionaryDay | null;
  /** The Whiteboard's PowerPoint pictures, by their Announcements slide id, for the decks a card chains. */
  pictures: Record<number, { title: string; src: string }>;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
  /** Set by Replace: the next Add from the library replaces this song instead of adding one. */
  replacing: { segment: number; hymnId: number | null } | null;
  /** The Library item (song, prayer or reading) being dragged, while it is dragged. Lineup cards read it to show where it can go. */
  libDrag: LibraryDragBatch | null;
  /** Bumped when a song changes in Song Lyrics, so the song list reloads. */
  libraryRevision: number;
  /** The lineup slot whose item is being dragged within the lineup, or null. */
  slotDrag: number | null;
  /**
   * Go Live focus: the live controls take the whole workspace while the Library and Lineup step aside. They stay mounted, so nothing
   * typed or selected there is lost. Not persisted. Entering or leaving it never touches the projector.
   */
  isGoLiveFocused: boolean;
}

export const usePw = create<PwState>()(
  persist(
    (): PwState => ({
      tab: 'plan',
      sessionId: null,
      sessions: [],
      templates: [],
      session: null,
      selected: 0,
      tags: [],
      hymns: {},
      prayers: [],
      day: null,
      pictures: {},
      saveState: 'idle',
      error: null,
      replacing: null,
      libDrag: null,
      libraryRevision: 0,
      slotDrag: null,
      isGoLiveFocused: false,
    }),
    { name: 'apccmma.pw', partialize: ({ tab, sessionId }) => ({ tab, sessionId }) },
  ),
);

const setPw = usePw.setState;
const api = bridge.pw;
export const errorText = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));

/**
 * A song changed in Song Lyrics, in any window. A song the planner has loaded is read again, so the lineup and the projector use
 * the new lyrics, and a deleted song leaves the cache. The song list reloads either way.
 */
async function songChanged(id: number) {
  if (usePw.getState().hymns[id]) {
    try {
      const fresh = await liveLyrics.getHymn(id);
      setPw((s) => ({ hymns: withHymn(s.hymns, id, hymnAfterChange(fresh)) }));
    } catch {
      // Left as it was. The next change, or a restart, reads it again.
    }
  }
  setPw((s) => ({ libraryRevision: s.libraryRevision + 1 }));
}
liveLyrics.onChanged((id) => void songChanged(id));

/** Loads the hymns these segments use and are not cached yet. */
async function loadHymns(segments: PwSegment[]) {
  const have = usePw.getState().hymns;
  const ids = [...new Set(segments.flatMap((s) => s.content.hymnIds))].filter((id) => !have[id]);
  if (ids.length === 0) return;
  const loaded = await Promise.all(ids.map((id) => liveLyrics.getHymn(id)));
  setPw((s) => ({ hymns: { ...s.hymns, ...Object.fromEntries(loaded.filter((h): h is Hymn => Boolean(h)).map((h) => [h.id, h])) } }));
}

async function loadDay(date: string) {
  try {
    setPw({ day: await bridge.lectionary.getDay(date) });
  } catch {
    setPw({ day: null });
  }
}

/** Libraries that change outside this module: prayers and tags. Called on open and when the view regains focus. */
export async function refreshLibraries() {
  const [notes, tags] = await Promise.all([bridge.notes.list(), api.listTags()]);
  setPw({ prayers: notes.filter((n) => n.display !== 'operator'), tags });
  await refreshPictures();
}

/** The Whiteboard's PowerPoint pictures, read again after a change there, so a chained deck shows its slides as they are now. */
export async function refreshPictures() {
  try {
    const slides = await bridge.whiteboard.list();
    const pictures: PwState['pictures'] = {};
    for (const s of slides) if (s.slideId != null && s.image) pictures[s.slideId] = { title: s.title, src: s.image };
    setPw({ pictures });
  } catch {
    // Kept as they were. A deck whose pictures are not loaded shows nothing until the next read.
  }
}

function showSession(session: PwSession) {
  const segments = groupOrdered(session.segments, session.groups);
  setPw((s) => ({
    session: { ...session, segments },
    sessionId: session.id,
    selected: Math.min(s.sessionId === session.id ? s.selected : 0, Math.max(segments.length - 1, 0)),
  }));
  // Resolves once the songs and the day's readings are loaded, so a caller can build slides straight after.
  return Promise.all([loadHymns(segments), loadDay(session.liturgicalDate)]);
}

/** First load: the lists, then the session last open (or the newest one). */
export async function initPw() {
  try {
    const [sessions, templates] = await Promise.all([api.listSessions(), api.listTemplates()]);
    setPw({ sessions, templates, error: null });
    await refreshLibraries();
    const wanted = usePw.getState().sessionId;
    const id = sessions.some((s) => s.id === wanted) ? wanted : sessions[0]?.id ?? null;
    if (id == null) setPw({ session: null, sessionId: null });
    else await openSession(id);
  } catch (err) {
    setPw({ error: errorText(err) });
  }
}

export async function openSession(id: number) {
  setPw({ replacing: null });
  await showSession(await api.getSession(id));
}

/** Makes a session and opens it. Resolves to the new session, so the Planner can mark it as the plan it has open. */
export async function createSession(input: { name: string; liturgicalDate: string; templateId?: number }) {
  const session = await api.createSession(input);
  setPw({ sessions: await api.listSessions(), selected: 0 });
  await showSession(session);
  return session;
}

/** Reads the session list again, for the Planner's calendar. Leaves the open session as it is. */
export async function refreshSessions() {
  setPw({ sessions: await api.listSessions() });
}

/** A saved session, read without opening it: the Planner's calendar counts its ready slots. */
export function readSession(id: number) {
  return api.getSession(id);
}

export async function deleteSession(id: number) {
  await api.deleteSession(id);
  setPw({ sessions: await api.listSessions(), session: null, sessionId: null });
  await initPw();
}

export async function saveAsTemplate(name: string) {
  const { session } = usePw.getState();
  if (!session) return null;
  await flushSave();
  const template = await api.saveAsTemplate(session.id, name);
  setPw({ templates: await api.listTemplates() });
  return template;
}

let saveTimer: number | undefined;
/** Counts edits, so a save that returns after a newer edit does not overwrite it. */
let editSerial = 0;

async function saveNow() {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  const { session } = usePw.getState();
  if (!session) return;
  const serial = editSerial;
  setPw({ saveState: 'saving' });
  try {
    const saved = await api.saveSession(session.id, { name: session.name, liturgicalDate: session.liturgicalDate, segments: session.segments });
    if (serial === editSerial) {
      setPw({ saveState: 'saved', error: null });
      // Keeps the server's stale flags and ids without disturbing the selection.
      setPw((s) => (s.session?.id === saved.id ? { session: { ...saved, segments: groupOrdered(saved.segments, saved.groups) } } : {}));
    }
    setPw({ sessions: await api.listSessions() });
  } catch (err) {
    // The database refused the change: show why and go back to what is saved.
    setPw({ saveState: 'error', error: errorText(err) });
    void showSession(await api.getSession(session.id));
  }
}

/** Writes any pending edit now. Used before leaving the session or saving a template. */
export async function flushSave() {
  if (saveTimer !== undefined) await saveNow();
}

/** Replaces the open session's segments (already in group order) and schedules a save. */
export function commitSegments(segments: PwSegment[], selected?: number) {
  const { session } = usePw.getState();
  if (!session) return;
  editSerial += 1;
  setPw((s) => ({ session: { ...session, segments }, selected: selected ?? s.selected, saveState: 'saving' }));
  void loadHymns(segments);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveNow(), SAVE_DELAY_MS);
}

/**
 * A stanza of a song was split in two (see the library's splitStanza). The open lineup's cards that sing the song in their own order get the
 * second half after the first, as the saved lineups already have, so the lineup's next save keeps it rather than writing the old order back.
 */
export function applySplitToSession(hymnId: number, firstId: number, secondId: number) {
  const segments = usePw.getState().session?.segments;
  if (!segments) return;
  let changed = false;
  const next = segments.map((segment) => {
    const arrangement = arrangementWithSplit(segment.arrangement, hymnId, firstId, secondId);
    if (arrangement === segment.arrangement) return segment;
    changed = true;
    return { ...segment, arrangement };
  });
  if (changed) commitSegments(next);
}

/** Changes one segment. */
export function updateSegment(index: number, patch: Partial<PwSegment>) {
  const segments = usePw.getState().session?.segments;
  if (!segments?.[index]) return;
  commitSegments(segments.map((s, i) => (i === index ? { ...s, ...patch } : s)));
}

/** Adds an empty card of `type` straight after the selected one, in its group, and selects it. */
export function addCard(type: PwType, name: string) {
  const { session, selected } = usePw.getState();
  if (!session) return;
  // A key is only held by one card for good, so the time it was made keeps it unique within the lineup.
  const key = `custom_${Date.now().toString(36)}`;
  const result = addLineupCard(session.segments, session.groups, selected, newLineupCard({ key, name, type }));
  commitSegments(result.segments, result.index);
}

/** Removes the card at `index`. The selection moves to the card that takes its place. A pending Replace is cleared, since it points at an index. */
export function removeCard(index: number) {
  const { session } = usePw.getState();
  if (!session) return;
  const result = removeLineupCard(session.segments, session.groups, index);
  setPw({ replacing: null });
  commitSegments(result.segments, result.index);
}

export function updateSession(patch: { name?: string; liturgicalDate?: string }) {
  const { session } = usePw.getState();
  if (!session) return;
  setPw({ session: { ...session, ...patch } });
  commitSegments(usePw.getState().session!.segments);
  if (patch.liturgicalDate) void loadDay(patch.liturgicalDate);
}

/**
 * Chains PowerPoint decks (each its pictures' slide ids, in order) after the last item of a card in a Praise & Worship session. The open
 * session changes through the planner, so its editor and the live lineup follow; any other session is saved straight away. A deck already
 * on the card, or one past the card's limit, is left out. Nothing before the new slides moves, so a slide on air stays where it is.
 * Resolves to how many decks were added.
 */
export async function chainPicturesInto(sessionId: number, segmentKey: string, decks: number[][]): Promise<number> {
  const open = usePw.getState().session?.id === sessionId;
  const session = open ? usePw.getState().session! : await api.getSession(sessionId);
  const index = session.segments.findIndex((s) => s.key === segmentKey);
  if (index < 0) throw new Error('That card is not in the session any more. Choose another.');
  let segment = session.segments[index];
  let added = 0;
  for (const slideIds of decks) {
    const patch = chainAssignment(segment, { kind: 'pictures', slideIds, minutes: 0 });
    if (!patch) continue;
    segment = { ...segment, ...patch };
    added += 1;
  }
  if (added === 0) return 0;
  const segments = session.segments.map((s, i) => (i === index ? segment : s));
  await refreshPictures();
  if (open) {
    commitSegments(segments);
    await flushSave();
  } else {
    await api.saveSession(sessionId, { name: session.name, liturgicalDate: session.liturgicalDate, segments });
  }
  return added;
}

export async function setTag(hymnId: number, segmentKey: string, on: boolean) {
  setPw({ tags: await api.setTag(hymnId, segmentKey, on) });
}

/** What a segment's slides are built from, out of the loaded libraries. */
export function resolvedFor(segment: PwSegment, state: Pick<PwState, 'hymns' | 'prayers' | 'day'> & Partial<Pick<PwState, 'pictures'>>): PwResolved {
  const c = segment.content;
  // Every card resolves its songs, whatever its first item is.
  const hymns = c.hymnIds
    .map((id) => state.hymns[id])
    .filter((h): h is Hymn => Boolean(h))
    .map((h) => ({ id: h.id, title: h.title, category: h.category, stanzas: h.stanzas, style: h.style ?? null }));
  // The chained items resolve in the same order as the chain, so each entry lines up with its item.
  const more = chainOf(segment).map((item) => {
    if (item.kind === 'prayer') return { prayer: prayerFor(item.noteId, state) };
    if (item.kind === 'pictures') return { pictures: item.slideIds.flatMap((id) => (state.pictures?.[id] ? [state.pictures[id]] : [])) };
    return { reading: readingFor(item.readingType, state) };
  });
  if (c.kind === 'prayer') return { hymns, prayer: c.noteId != null ? prayerFor(c.noteId, state) : null, more };
  if (c.kind === 'lectionary') return { hymns, reading: readingFor(c.readingType, state), more };
  return { hymns, more };
}

/** A prayer from Notes & Prayers, as slides read it. Null when the note is gone or not loaded. */
function prayerFor(noteId: number, state: Pick<PwState, 'prayers'>): PwResolved['prayer'] {
  const note = state.prayers.find((n) => n.id === noteId);
  return note ? { title: note.title, body: note.body, split: note.split ?? null, align: note.style?.textAlign ?? 'center' } : null;
}

/** A day's reading from the lectionary. Null until the day is loaded, or when the day has no such reading. */
function readingFor(readingType: string, state: Pick<PwState, 'day'>): PwResolved['reading'] {
  const row = state.day?.readings.find((r) => r.readingType === readingType);
  return row ? { citation: row.citation, rawText: row.rawText } : null;
}

export const setPwState = setPw;
