import { create } from 'zustand';
import { hymnAfterChange, withHymn } from '../../shared/hymn-cache.js';
import { persist } from 'zustand/middleware';
import { groupOrdered, type PwHymnTag, type PwResolved, type PwSegment } from '../../shared/pw.js';
import { bridge } from '../live/bridge';
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
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
  /** Set by Replace: the next Add from the library replaces this song instead of adding one. */
  replacing: { segment: number; hymnId: number | null } | null;
  /** The song being dragged from the Song List, while it is dragged. Lineup slots read it to show where it can go. */
  songDrag: number | null;
  /** Bumped when a song changes in Song Lyrics, so the song list reloads. */
  libraryRevision: number;
  /** The lineup slot whose item is being dragged within the lineup, or null. */
  slotDrag: number | null;
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
      saveState: 'idle',
      error: null,
      replacing: null,
      songDrag: null,
      libraryRevision: 0,
      slotDrag: null,
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
      const fresh = await bridge.lyrics.getHymn(id);
      setPw((s) => ({ hymns: withHymn(s.hymns, id, hymnAfterChange(fresh)) }));
    } catch {
      // Left as it was. The next change, or a restart, reads it again.
    }
  }
  setPw((s) => ({ libraryRevision: s.libraryRevision + 1 }));
}
bridge.lyrics.onChanged((id) => void songChanged(id));

/** Loads the hymns these segments use and are not cached yet. */
async function loadHymns(segments: PwSegment[]) {
  const have = usePw.getState().hymns;
  const ids = [...new Set(segments.flatMap((s) => (s.content.kind === 'song' ? s.content.hymnIds : [])))].filter((id) => !have[id]);
  if (ids.length === 0) return;
  const loaded = await Promise.all(ids.map((id) => bridge.lyrics.getHymn(id)));
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

export async function createSession(input: { name: string; liturgicalDate: string; templateId?: number }) {
  const session = await api.createSession(input);
  setPw({ sessions: await api.listSessions(), selected: 0 });
  await showSession(session);
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

/** Changes one segment. */
export function updateSegment(index: number, patch: Partial<PwSegment>) {
  const segments = usePw.getState().session?.segments;
  if (!segments?.[index]) return;
  commitSegments(segments.map((s, i) => (i === index ? { ...s, ...patch } : s)));
}

export function updateSession(patch: { name?: string; liturgicalDate?: string }) {
  const { session } = usePw.getState();
  if (!session) return;
  setPw({ session: { ...session, ...patch } });
  commitSegments(usePw.getState().session!.segments);
  if (patch.liturgicalDate) void loadDay(patch.liturgicalDate);
}

export async function setTag(hymnId: number, segmentKey: string, on: boolean) {
  setPw({ tags: await api.setTag(hymnId, segmentKey, on) });
}

/** What a segment's slides are built from, out of the loaded libraries. */
export function resolvedFor(segment: PwSegment, state: Pick<PwState, 'hymns' | 'prayers' | 'day'>): PwResolved {
  const c = segment.content;
  if (c.kind === 'song') {
    return {
      hymns: c.hymnIds
        .map((id) => state.hymns[id])
        .filter((h): h is Hymn => Boolean(h))
        .map((h) => ({ id: h.id, title: h.title, category: h.category, stanzas: h.stanzas, style: h.style ?? null })),
    };
  }
  if (c.kind === 'prayer') {
    const note = state.prayers.find((n) => n.id === c.noteId);
    return { prayer: note ? { title: note.title, body: note.body, split: note.split ?? null, align: note.style?.textAlign ?? 'center' } : null };
  }
  if (c.kind === 'lectionary') {
    const row = state.day?.readings.find((r) => r.readingType === c.readingType);
    return { reading: row ? { citation: row.citation, rawText: row.rawText } : null };
  }
  return {};
}

export const setPwState = setPw;
