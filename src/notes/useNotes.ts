import { useEffect, useRef, useState } from 'react';
import { bridge } from '../live/bridge';
import type { Note, NoteChange } from './types';

/**
 * Runs `callback` whenever a note is saved or deleted, in this window or another (the main process tells every window). Notes & Prayers and Go
 * Live's Order of Holy Mass use it to read the notes again, so a prayer written in one shows in the other without a reload.
 */
export function useNotesChanged(callback: (change: NoteChange) => void): void {
  // The latest callback is kept in a ref, so a new function each render does not subscribe again.
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => bridge.notes.onChanged((change) => latest.current(change)), []);
}

/** Every note by id, read again after each change. Empty until the first read comes back. */
export function useNotesById(): Map<number, Note> {
  const [notes, setNotes] = useState<Map<number, Note>>(() => new Map());
  const [revision, setRevision] = useState(0);
  useEffect(() => bridge.notes.onChanged(() => setRevision((n) => n + 1)), []);
  useEffect(() => {
    let alive = true;
    bridge.notes
      .list()
      .then((list) => alive && setNotes(new Map(list.map((n) => [n.id, n]))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [revision]);
  return notes;
}
