import { useCallback, useState } from 'react';
import { setLiveStanzas, type LiveStanza } from '../live/liveSongEdits';
import type { Hymn } from '../lyrics/types';
import { splitAtMidpoint } from '../../shared/pw-hot-edit.js';
import { smartBreakParts } from '../utils/textOptimizer';
import { applySplitToSession } from './store';

/** The section labels a stanza added on the fly can take. Each is one the lyrics parser reads back as a section header. */
export const ADD_LABELS = ['Verse', 'Chorus', 'Bridge', 'Outro'] as const;
export type AddLabel = (typeof ADD_LABELS)[number];

export interface HotEdit {
  index: number;
  text: string;
}

export interface HotAdd {
  label: AddLabel;
  text: string;
}

/** The next free verse number, so a new verse is never named like an old one. */
function nextVerse(stanzas: Pick<LiveStanza, 'stanzaType'>[]): number {
  const numbers = stanzas.map((s) => Number(/^Verse\s*(\d+)$/i.exec(s.stanzaType)?.[1] ?? 0));
  return Math.max(0, ...numbers) + 1;
}

/** The label for a new stanza: a numbered verse, or the section name. */
export const labelFor = (label: AddLabel, stanzas: Pick<LiveStanza, 'stanzaType'>[]) => (label === 'Verse' ? `Verse ${nextVerse(stanzas)}` : label);

/** Lines that would start a new section, which an edit must not slip into a stanza's words. */
const SECTION_LINE = /^\s*\[[^\]]+\]\s*$/m;

/**
 * Edits the song on the projector while it is on air: change the words of one stanza, or add a stanza after the one on screen. The change is
 * kept for this run of the app only (see live/liveSongEdits): Song Lyrics is never written from air. The song watch then swaps the new words
 * onto the projector in place: the same stanza stays up, with no transition, and the background video and the lower third carry on untouched.
 *
 * `onSaved` gets the song as Go Live now plays it, so the cue panel can list the new stanzas at once.
 */
export function useLiveHotEditor(hymn: Hymn | null, onSaved: (fresh: Hymn) => void) {
  const [editing, setEditing] = useState<HotEdit | null>(null);
  const [adding, setAdding] = useState<HotAdd | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Keeps a new list of stanzas for this run. Resolves to the song as it now plays, or null when it was refused (the reason is in `error`). */
  const saveStanzas = useCallback(
    async (stanzas: LiveStanza[]): Promise<Hymn | null> => {
      if (!hymn) return null;
      setBusy(true);
      setError(null);
      try {
        // Only the words change, and only on air: the song in Song Lyrics keeps its stanzas, details and filing.
        const fresh = await setLiveStanzas(hymn, stanzas);
        onSaved(fresh);
        return fresh;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [hymn, onSaved],
  );

  /** A stanza's new words, checked: not empty, and with no line that would start a section of its own. */
  const check = (text: string): string | null => {
    if (!text.trim()) return 'A stanza needs some words. To take one out, edit the song in Song Lyrics.';
    if (SECTION_LINE.test(text)) return 'A line in [brackets] starts a new section. Take it out, or add the section as its own stanza.';
    return null;
  };

  const startEdit = (index: number) => {
    if (!hymn?.stanzas[index]) return;
    setAdding(null);
    setError(null);
    setEditing({ index, text: hymn.stanzas[index].lyricsText });
  };

  /** Saves the stanza being edited. Resolves true when it was saved. */
  const commitEdit = async (): Promise<boolean> => {
    if (!hymn || !editing) return false;
    const problem = check(editing.text);
    if (problem) {
      setError(problem);
      return false;
    }
    if (editing.text === hymn.stanzas[editing.index]?.lyricsText) {
      setEditing(null);
      return true;
    }
    const next = hymn.stanzas.map((s, i) => (i === editing.index ? { id: s.id, stanzaType: s.stanzaType, lyricsText: editing.text } : s));
    const saved = await saveStanzas(next);
    if (saved) setEditing(null);
    return Boolean(saved);
  };

  /** The words of a stanza as they stand: the ones in the edit box when the stanza is open there, so a change typed first is kept. */
  const wordsOf = (index: number) => (editing?.index === index ? editing.text : hymn?.stanzas[index]?.lyricsText ?? '');

  /**
   * Replaces a stanza with `parts`, stanzas that follow each other under its label, for this run only. The first part keeps the stanza's id
   * and each later part goes straight after the one before it, in the song and in every card of the open lineup that sings it in its own
   * order. Resolves to the number of parts made, or 0 when none were (the reason is in `error`). Song Lyrics is not written.
   */
  const splitInto = async (index: number, parts: string[]): Promise<number> => {
    const stanza = hymn?.stanzas[index];
    if (!hymn || !stanza || parts.length < 2) return 0;
    const pieces: LiveStanza[] = parts.map((lyricsText, k) => ({ ...(k === 0 ? { id: stanza.id } : {}), stanzaType: stanza.stanzaType, lyricsText }));
    const saved = await saveStanzas([...hymn.stanzas.slice(0, index), ...pieces, ...hymn.stanzas.slice(index + 1)]);
    if (!saved) return 0;
    const ids = saved.stanzas.slice(index, index + parts.length).map((s) => s.id);
    for (let k = 1; k < ids.length; k += 1) applySplitToSession(hymn.id, ids[k - 1], ids[k]);
    setEditing(null);
    return parts.length;
  };

  /** Splits a stanza into two at its middle (see splitAtMidpoint), for a stanza too long for one slide. Resolves to the number of parts saved. */
  const commitSplit = async (index: number): Promise<number> => {
    const parts = splitAtMidpoint(wordsOf(index));
    if (!parts) {
      setError('This stanza has only one line, so there is nothing to split.');
      return 0;
    }
    return splitInto(index, parts);
  };

  /**
   * Smart Break: cuts a stanza into as many slides as it needs to fit the screen, at its full stops and line ends, with the slides kept about
   * even (see smartBreakParts). Resolves to the number of parts saved.
   */
  const commitSmartBreak = async (index: number): Promise<number> => {
    const parts = smartBreakParts(wordsOf(index));
    if (!parts) {
      setError('This stanza already fits one slide, so there is nothing to break.');
      return 0;
    }
    return splitInto(index, parts);
  };

  const startAdd = () => {
    setEditing(null);
    setError(null);
    setAdding({ label: 'Verse', text: '' });
  };

  /**
   * Saves the new stanza after `after` (the stanza on screen), or at the end when nothing is on screen. Resolves to the new stanza's index in
   * the saved song, or null when it was not saved.
   */
  const commitAdd = async (after: number | null): Promise<number | null> => {
    if (!hymn || !adding) return null;
    const problem = check(adding.text);
    if (problem) {
      setError(problem);
      return null;
    }
    const at = after === null ? hymn.stanzas.length : Math.min(after + 1, hymn.stanzas.length);
    const added = { stanzaType: labelFor(adding.label, hymn.stanzas), lyricsText: adding.text };
    const next = [...hymn.stanzas.slice(0, at), added, ...hymn.stanzas.slice(at)];
    const saved = await saveStanzas(next);
    if (!saved) return null;
    setAdding(null);
    return at < saved.stanzas.length ? at : saved.stanzas.length - 1;
  };

  /**
   * Takes stanza `index` out of the song for this run only (Delete slide on a Holy Mass song). The song's only stanza stays. Resolves true
   * once it is gone from what Go Live plays; Song Lyrics keeps it.
   */
  const commitDelete = async (index: number): Promise<boolean> => {
    if (!hymn?.stanzas[index] || hymn.stanzas.length <= 1) return false;
    setEditing(null);
    setAdding(null);
    return Boolean(await saveStanzas(hymn.stanzas.filter((_, i) => i !== index)));
  };

  const cancel = () => {
    setEditing(null);
    setAdding(null);
    setError(null);
  };

  return {
    editing,
    adding,
    busy,
    error,
    startEdit,
    changeEdit: (text: string) => setEditing((e) => (e ? { ...e, text } : e)),
    commitEdit,
    commitSplit,
    /** Whether the stanza being edited has two lines or more, so Auto-split has something to split. */
    canSplit: editing !== null && splitAtMidpoint(editing.text) !== null,
    commitSmartBreak,
    /** Whether the stanza being edited is over one slide's limits, so Smart Break has something to cut. */
    canSmartBreak: editing !== null && smartBreakParts(editing.text) !== null,
    startAdd,
    changeAdd: (patch: Partial<HotAdd>) => setAdding((a) => (a ? { ...a, ...patch } : a)),
    commitAdd,
    commitDelete,
    cancel,
  };
}

export type LiveHotEditor = ReturnType<typeof useLiveHotEditor>;
