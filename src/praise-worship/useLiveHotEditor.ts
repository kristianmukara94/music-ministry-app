import { useCallback, useState } from 'react';
import { bridge } from '../live/bridge';
import type { Hymn, Stanza } from '../lyrics/types';
import { splitAtMidpoint } from '../../shared/pw-hot-edit.js';
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

/** The song's stanzas as tagged lyrics ([Verse 1], [Chorus] …), the form the song is saved in. */
function tagged(stanzas: Pick<Stanza, 'stanzaType' | 'lyricsText'>[]): string {
  return stanzas.map((s) => `[${s.stanzaType}]\n${s.lyricsText.trim()}`).join('\n\n');
}

/** The next free verse number, so a new verse is never named like an old one. */
function nextVerse(stanzas: Pick<Stanza, 'stanzaType'>[]): number {
  const numbers = stanzas.map((s) => Number(/^Verse\s*(\d+)$/i.exec(s.stanzaType)?.[1] ?? 0));
  return Math.max(0, ...numbers) + 1;
}

/** The label for a new stanza: a numbered verse, or the section name. */
export const labelFor = (label: AddLabel, stanzas: Pick<Stanza, 'stanzaType'>[]) => (label === 'Verse' ? `Verse ${nextVerse(stanzas)}` : label);

/** Lines that would start a new section, which an edit must not slip into a stanza's words. */
const SECTION_LINE = /^\s*\[[^\]]+\]\s*$/m;

/**
 * Edits the song on the projector while it is on air: change the words of one stanza, or add a stanza after the one on screen. The change is
 * saved to the song in Song Lyrics, so it is kept for next time. The song watch then swaps the new words onto the projector in place: the
 * same stanza stays up, with no transition, and the background video and the lower third carry on untouched.
 *
 * `onSaved` gets the song as saved, so the cue panel can list the new stanzas at once.
 */
export function useLiveHotEditor(hymn: Hymn | null, onSaved: (fresh: Hymn) => void) {
  const [editing, setEditing] = useState<HotEdit | null>(null);
  const [adding, setAdding] = useState<HotAdd | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Saves a new list of stanzas. Resolves to the saved song, or null when it was refused (the reason is in `error`). */
  const saveStanzas = useCallback(
    async (stanzas: Pick<Stanza, 'stanzaType' | 'lyricsText'>[]): Promise<Hymn | null> => {
      if (!hymn) return null;
      setBusy(true);
      setError(null);
      try {
        // Only the words change. The song keeps its stored details, scope and song category, so its filing and Mass slot stay put, and a song
        // saved before a song category was required can still be edited on air.
        await bridge.lyrics.editLyrics(hymn.id, tagged(stanzas));
        const fresh = await bridge.lyrics.getHymn(hymn.id);
        if (!fresh) throw new Error('The song could not be read back after saving.');
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
    const next = hymn.stanzas.map((s, i) => (i === editing.index ? { stanzaType: s.stanzaType, lyricsText: editing.text } : s));
    const saved = await saveStanzas(next);
    if (saved) setEditing(null);
    return Boolean(saved);
  };

  /**
   * Splits a stanza into two at its middle (see splitAtMidpoint), for a stanza too long for one slide. The words split are the ones in the edit
   * box when the stanza is open there, so a change typed first is kept. Both halves keep the stanza's label. Resolves true when it was saved.
   */
  const commitSplit = async (index: number): Promise<boolean> => {
    if (!hymn?.stanzas[index]) return false;
    const words = editing?.index === index ? editing.text : hymn.stanzas[index].lyricsText;
    const parts = splitAtMidpoint(words);
    if (!parts) {
      setError('This stanza has only one line, so there is nothing to split.');
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.lyrics.splitStanza(hymn.id, index, parts);
      if (result.firstId !== null && result.secondId !== null) applySplitToSession(hymn.id, result.firstId, result.secondId);
      const fresh = await bridge.lyrics.getHymn(hymn.id);
      if (fresh) onSaved(fresh);
      setEditing(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
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
    startAdd,
    changeAdd: (patch: Partial<HotAdd>) => setAdding((a) => (a ? { ...a, ...patch } : a)),
    commitAdd,
    cancel,
  };
}

export type LiveHotEditor = ReturnType<typeof useLiveHotEditor>;
