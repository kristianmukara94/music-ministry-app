import { useEffect, useMemo, useRef, useState } from 'react';
import { parseLyrics } from '../../shared/lyrics-parser.js';
import { isSongCategoryMissing, isSongCategoryRefusal } from '../../shared/hymn-category.js';
import { bridge } from '../live/bridge';
import type { Hymn, HymnLanguage, NewHymn, PrimaryCategory, SongCategory } from './types';
import { normalizePrimary } from './songTaxonomy';

const api = bridge.lyrics;

/** How long after the last keystroke a draft is put aside. */
const DRAFT_DELAY_MS = 400;
const DRAFT_PREFIX = 'apcc.songDraft.';

/** Everything typed into the song form. */
export interface SongFields {
  title: string;
  composer: string;
  musicalKey: string;
  language: HymnLanguage;
  songCategory: string;
  /** Where the song is used: General, Mass, or Praise & Worship. */
  primaryCategory: PrimaryCategory;
  raw: string;
}

/** A draft put aside in this browser, with the song as it was when the draft began, so an outdated draft is not offered. */
interface StoredDraft {
  fields: SongFields;
  base: SongFields;
  savedAt: number;
}

/** One stanza as it will be cued: its label and its lines. */
export interface PreviewStanza {
  stanzaType: string;
  lyricsText: string;
}

export type SongProblem = 'titleMissing' | 'noStanzas' | 'songCategoryMissing';

/** Stanzas as lyrics, each under its label written out ([Verse 1], [Chorus]), the way the form asks them to be typed. */
const toTagged = (stanzas: PreviewStanza[]) => stanzas.map((s) => `[${s.stanzaType}]\n${s.lyricsText}`).join('\n\n');

const fieldsOf = (hymn: Hymn | null | undefined): SongFields => ({
  title: hymn?.title ?? '',
  composer: hymn?.composer ?? '',
  musicalKey: hymn?.musicalKey ?? '',
  language: hymn?.language ?? 'EN',
  songCategory: hymn?.songCategory ?? '',
  primaryCategory: normalizePrimary(hymn?.primaryCategory),
  raw: hymn ? toTagged(hymn.stanzas) : '',
});

const same = (a: SongFields, b: SongFields) => (Object.keys(a) as (keyof SongFields)[]).every((k) => a[k] === b[k]);

/** The draft for this song in this browser, read safely: a blocked or damaged store simply has none. */
function readDraft(key: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as StoredDraft;
    if (!draft || typeof draft.fields?.title !== 'string' || typeof draft.fields?.raw !== 'string') return null;
    // A draft put aside before songs had a scope has none; it reads as General, as a song saved before then does. One from before the Mass slot
    // followed the song category carries a slot, which is dropped so the form never sends it.
    const clean = (f: SongFields): SongFields => {
      const { category: _slot, ...rest } = f as SongFields & { category?: unknown };
      return { ...rest, primaryCategory: normalizePrimary(rest.primaryCategory) };
    };
    return { ...draft, fields: clean(draft.fields), base: clean(draft.base ?? draft.fields) };
  } catch {
    return null;
  }
}
function writeDraft(key: string, draft: StoredDraft | null) {
  try {
    if (draft) window.localStorage.setItem(key, JSON.stringify(draft));
    else window.localStorage.removeItem(key);
  } catch {
    // A full or blocked store only means the draft is not kept.
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/**
 * The song form: its fields, its lyrics taken apart into stanzas as they are typed, what stops it from being saved, and the save itself.
 *
 * What is typed is put aside in this browser a moment after each change, so closing the form by accident loses nothing: opening it again
 * brings the draft back. A new song has one draft; an existing song has its own, offered only while the song is still as it was when the
 * draft began. Saving, or discarding the changes, clears the draft.
 */
export function useSongEditor(hymn: Hymn | null | undefined) {
  const initial = useMemo(() => fieldsOf(hymn), [hymn]);
  const draftKey = `${DRAFT_PREFIX}${hymn ? hymn.id : 'new'}`;
  // A draft from an earlier visit is brought back, unless the song has changed since it began.
  const [restored] = useState(() => {
    const draft = readDraft(draftKey);
    if (!draft || !same(draft.base, initial) || same(draft.fields, initial)) return null;
    return draft;
  });
  const [fields, setFields] = useState<SongFields>(restored?.fields ?? initial);
  const [draftNotice, setDraftNotice] = useState<number | null>(restored?.savedAt ?? null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [songCategories, setSongCategories] = useState<SongCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown once a save is tried with something missing, so the form does not start out red.
  const [triedSave, setTriedSave] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api.listSongCategories().then(setSongCategories).catch(() => undefined);
  }, []);

  const dirty = !same(fields, initial);

  // The draft follows the typing; a form back to how it started has no draft.
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (dirty) {
        const savedAt = Date.now();
        writeDraft(draftKey, { fields, base: initial, savedAt });
        setDraftSavedAt(savedAt);
      } else {
        writeDraft(draftKey, null);
        setDraftSavedAt(null);
      }
    }, DRAFT_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [fields]);

  const set = <K extends keyof SongFields>(key: K, value: SongFields[K]) => {
    setFields((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  const parsed = useMemo(() => parseLyrics(fields.raw), [fields.raw]);
  const stanzas: PreviewStanza[] = parsed.stanzas;
  const parseError = fields.raw.trim() ? parsed.errors[0] ?? null : null;

  const problems: SongProblem[] = [];
  if (!fields.title.trim()) problems.push('titleMissing');
  if (stanzas.length === 0) problems.push('noStanzas');
  if (isSongCategoryMissing(fields.songCategory)) problems.push('songCategoryMissing');
  const canSave = !busy && problems.length === 0 && !parseError;

  /** Rewrites the lyrics from a new list of stanzas, each under its tag, so the box and the cards always agree. */
  const setStanzas = (next: PreviewStanza[]) => set('raw', toTagged(next));
  const stanzaActions = {
    move: (from: number, to: number) => {
      if (to < 0 || to >= stanzas.length) return;
      const next = [...stanzas];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setStanzas(next);
    },
    remove: (index: number) => setStanzas(stanzas.filter((_, i) => i !== index)),
    duplicate: (index: number) => setStanzas([...stanzas.slice(0, index + 1), { ...stanzas[index] }, ...stanzas.slice(index + 1)]),
  };

  /** Clears the draft and puts the form back as it started. */
  const discardChanges = () => {
    writeDraft(draftKey, null);
    setFields(initial);
    setDraftNotice(null);
    setDraftSavedAt(null);
    setTriedSave(false);
    setError(null);
  };

  /** Saves the song. Resolves to true when it was saved; the draft is then cleared. */
  const save = async (): Promise<boolean> => {
    setTriedSave(true);
    if (!canSave) return false;
    setBusy(true);
    setError(null);
    try {
      const input: NewHymn = { ...fields };
      if (hymn) await api.editHymn(hymn.id, input);
      else await api.createHymn(input);
      window.clearTimeout(timer.current);
      writeDraft(draftKey, null);
      return true;
    } catch (err) {
      const message = errorText(err);
      // The service refuses a missing category too; the form shows its own prompt for that.
      if (!isSongCategoryRefusal(message)) setError(message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    fields,
    set,
    setFields,
    stanzas,
    warnings: parsed.warnings,
    parseError,
    problems,
    triedSave,
    canSave,
    busy,
    error,
    setError,
    dirty,
    songCategories,
    /** When the form came back with a draft from an earlier visit: the time it was put aside. */
    draftNotice,
    dismissDraftNotice: () => setDraftNotice(null),
    /** When the current changes were last put aside, or null when there is nothing to keep. */
    draftSavedAt,
    discardChanges,
    stanzaActions,
    save,
  };
}

export type SongEditor = ReturnType<typeof useSongEditor>;
