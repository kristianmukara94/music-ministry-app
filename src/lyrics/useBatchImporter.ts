import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BATCH_FILE_TYPES,
  effectiveTitle,
  MAX_BATCH_FILE_BYTES,
  mergeSongs,
  newKey,
  nextVerseLabel,
  songIssues,
  songToTagged,
  splitSongAt,
  splitSongs,
  type ParsedSong,
  type ParsingOptions,
  type SongIssue,
  type SourceLine,
  type SplitMethod,
} from '../../shared/song-batch.js';
import { bridge } from '../live/bridge';
import type { HymnLanguage, PrimaryCategory, SongCategory } from './types';

const api = bridge.lyrics;

/** Where the import is: choosing a file, reading it, reviewing its songs, saving them, or finished. */
export type BatchStep = 'upload' | 'reading' | 'review' | 'saving' | 'done';

/** Something that went wrong, with what the operator can do about it. `kind` says at which stage. */
export interface ImportError {
  kind: 'type' | 'size' | 'path' | 'read' | 'empty' | 'save';
  /** A label key with its values, so the message follows the language switch; or a message from the main process as it is. */
  key?: string;
  vars?: Record<string, string | number>;
  message?: string;
}

/** A song on the review screen: the song, whether it is ticked for import, and whether its stanzas are open. */
export interface ReviewSong extends ParsedSong {
  selected: boolean;
  open: boolean;
  showSource: boolean;
}

/** What every song is saved with. */
export interface BatchDefaults {
  songCategory: string;
  primaryCategory: PrimaryCategory;
  language: HymnLanguage;
}

export interface SavedSong {
  id: number;
  title: string;
}

export interface FailedSong {
  key: string;
  title: string;
  error: string;
}

const PROGRESS = { checking: 12, reading: 48, splitting: 86 } as const;
export type ReadStage = keyof typeof PROGRESS;

/** Gives the screen a moment to paint before the next piece of work, so the progress bar moves. */
const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
/** Songs ready for review. One that cannot be imported as it is (no stanzas, such as a document heading) starts unticked, so the rest can go at once. */
const toReview = (songs: ParsedSong[]): ReviewSong[] =>
  songs.map((s) => ({ ...s, selected: !songIssues(s).some((i) => i.level === 'error'), open: false, showSource: false }));

/** The file's error when a picked or dropped file is the wrong type or too large, checked before anything is read. */
export function checkFile(name: string, size: number | null): ImportError | null {
  if (!BATCH_FILE_TYPES.includes(extOf(name))) return { kind: 'type', key: 'badType', vars: { file: name } };
  if (size != null && size > MAX_BATCH_FILE_BYTES) {
    return { kind: 'size', key: 'tooBig', vars: { file: name, size: (size / 1024 / 1024).toFixed(1), mb: MAX_BATCH_FILE_BYTES / 1024 / 1024 } };
  }
  return null;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/**
 * The batch song import: reads a Word or text file of many songs, takes it apart into songs, keeps the operator's edits while they review
 * them, and saves the chosen ones to the Hymn Library. The screen only shows what this holds and calls its actions.
 */
export function useBatchImporter() {
  const [step, setStep] = useState<BatchStep>('upload');
  const [stage, setStage] = useState<ReadStage>('checking');
  const [error, setError] = useState<ImportError | null>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [lines, setLines] = useState<SourceLine[]>([]);
  const [options, setOptions] = useState<Required<ParsingOptions>>({ mode: 'auto', delimiter: '' });
  const [method, setMethod] = useState<SplitMethod>('titles');
  const [songs, setSongs] = useState<ReviewSong[]>([]);
  const [edited, setEdited] = useState(false);
  const [query, setQuery] = useState('');
  const [defaults, setDefaults] = useState<BatchDefaults>({ songCategory: '', primaryCategory: 'GENERAL', language: 'EN' });
  const [songCategories, setSongCategories] = useState<SongCategory[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<SavedSong[]>([]);
  const [failed, setFailed] = useState<FailedSong[]>([]);
  // Each read gets a number, so a slow read that was overtaken by another does not land on top of it.
  const readSerial = useRef(0);

  useEffect(() => {
    api.listSongCategories().then(setSongCategories).catch(() => undefined);
    // The library's titles, so a song that is already there can be pointed out.
    api
      .listHymns({})
      .then((list) => setExisting(new Set(list.map((h) => h.title.trim().toLowerCase()))))
      .catch(() => undefined);
  }, []);

  /** Reads the file at `path` and takes it apart into songs. */
  const read = async (path: string, name: string) => {
    const mine = ++readSerial.current;
    setError(null);
    setFile({ name, size: 0 });
    setStep('reading');
    setStage('checking');
    await paint();
    try {
      setStage('reading');
      const result = await api.readBatchFile(path);
      if (mine !== readSerial.current) return;
      setFile({ name: result.fileName, size: result.size });
      setStage('splitting');
      await paint();
      const split = splitSongs(result.lines, options);
      if (split.songs.length === 0) {
        setError({ kind: 'empty', key: 'noSongs', vars: { file: result.fileName } });
        setStep('upload');
        return;
      }
      setLines(result.lines);
      setMethod(split.method);
      setSongs(toReview(split.songs));
      setEdited(false);
      setQuery('');
      setStep('review');
    } catch (err) {
      if (mine !== readSerial.current) return;
      setError({ kind: 'read', message: errorText(err) });
      setStep('upload');
    }
  };

  /** A file dropped on the screen: checked at once, then read. */
  const acceptFile = (dropped: File) => {
    const problem = checkFile(dropped.name, dropped.size);
    if (problem) {
      setError(problem);
      return;
    }
    let path = '';
    try {
      path = bridge.files.pathFor(dropped);
    } catch {
      path = '';
    }
    if (!path) {
      setError({ kind: 'path', key: 'noPath' });
      return;
    }
    void read(path, dropped.name);
  };

  /** Opens the file picker, then reads the file chosen. */
  const browse = async () => {
    setError(null);
    try {
      const path = await api.pickBatchFile();
      if (!path) return;
      const name = path.split(/[\\/]/).pop() ?? path;
      const problem = checkFile(name, null);
      if (problem) {
        setError(problem);
        return;
      }
      await read(path, name);
    } catch (err) {
      setError({ kind: 'read', message: errorText(err) });
    }
  };

  /** Takes the file apart again, another way. The review starts over from the file. */
  const resplit = (next: Required<ParsingOptions>) => {
    setOptions(next);
    const split = splitSongs(lines, next);
    setMethod(split.method);
    setSongs(toReview(split.songs));
    setEdited(false);
  };

  // ---- Edits on the review screen. Each marks the review as changed, so it is not thrown away without asking.
  const change = (fn: (list: ReviewSong[]) => ReviewSong[], counts = true) => {
    setSongs(fn);
    if (counts) setEdited(true);
  };
  const patchSong = (key: string, patch: Partial<ReviewSong>, counts = true) => change((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)), counts);
  const patchStanza = (songKey: string, stanzaKey: string, patch: { type?: string; text?: string }) =>
    change((list) => list.map((s) => (s.key === songKey ? { ...s, stanzas: s.stanzas.map((z) => (z.key === stanzaKey ? { ...z, ...patch } : z)) } : s)));

  const actions = {
    setTitle: (key: string, title: string) => patchSong(key, { title }),
    toggleSelected: (key: string) => change((list) => list.map((s) => (s.key === key ? { ...s, selected: !s.selected } : s)), false),
    toggleOpen: (key: string) => change((list) => list.map((s) => (s.key === key ? { ...s, open: !s.open } : s)), false),
    toggleSource: (key: string) => change((list) => list.map((s) => (s.key === key ? { ...s, showSource: !s.showSource, open: true } : s)), false),
    setStanzaText: (songKey: string, stanzaKey: string, text: string) => patchStanza(songKey, stanzaKey, { text }),
    setStanzaType: (songKey: string, stanzaKey: string, type: string) => patchStanza(songKey, stanzaKey, { type }),
    addStanza: (songKey: string) =>
      change((list) => list.map((s) => (s.key === songKey ? { ...s, open: true, stanzas: [...s.stanzas, { key: newKey('z'), type: nextVerseLabel(s.stanzas), text: '' }] } : s))),
    removeStanza: (songKey: string, stanzaKey: string) =>
      change((list) => list.map((s) => (s.key === songKey ? { ...s, stanzas: s.stanzas.filter((z) => z.key !== stanzaKey) } : s))),
    /** Starts a new song at a stanza: it and the stanzas after it move into a song of their own, just below. */
    splitAt: (songKey: string, stanzaIndex: number) =>
      change((list) =>
        list.flatMap((s) => {
          if (s.key !== songKey) return [s];
          const [first, second] = splitSongAt(s, stanzaIndex);
          return second ? [{ ...s, ...first }, { ...second, selected: true, open: true, showSource: false }] : [s];
        }),
      ),
    /** Joins a song onto the end of the one above it. */
    mergeUp: (songKey: string) =>
      change((list) => {
        const i = list.findIndex((s) => s.key === songKey);
        if (i <= 0) return list;
        const merged: ReviewSong = { ...list[i - 1], ...mergeSongs(list[i - 1], list[i]), open: true };
        return [...list.slice(0, i - 1), merged, ...list.slice(i + 1)];
      }),
    removeSong: (key: string) => change((list) => list.filter((s) => s.key !== key)),
    removeSelected: () => change((list) => list.filter((s) => !s.selected)),
    /** Ticks every song shown (all of them, or those the search matches), or unticks them when they are all ticked. */
    selectAll: (on: boolean) => {
      const shown = new Set(visible.map((s) => s.key));
      change((list) => list.map((s) => (shown.has(s.key) ? { ...s, selected: on } : s)), false);
    },
  };

  const issuesOf = useMemo(() => {
    const map = new Map<string, SongIssue[]>();
    for (const s of songs) map.set(s.key, songIssues(s, existing));
    return map;
  }, [songs, existing]);

  const term = query.trim().toLowerCase();
  const visible = term ? songs.filter((s) => effectiveTitle(s).toLowerCase().includes(term)) : songs;
  const selected = songs.filter((s) => s.selected);
  const blocked = selected.filter((s) => issuesOf.get(s.key)?.some((i) => i.level === 'error'));
  const counts = {
    ready: songs.filter((s) => (issuesOf.get(s.key) ?? []).length === 0).length,
    warnings: songs.filter((s) => {
      const list = issuesOf.get(s.key) ?? [];
      return list.length > 0 && !list.some((i) => i.level === 'error');
    }).length,
    errors: songs.filter((s) => issuesOf.get(s.key)?.some((i) => i.level === 'error')).length,
  };
  const categoryMissing = !defaults.songCategory.trim();
  const canImport = selected.length > 0 && blocked.length === 0 && !categoryMissing;

  /** Saves every ticked song. The ones saved leave the review; any that were refused stay, so they can be fixed and tried again. */
  const importSelected = async () => {
    if (!canImport) return;
    setStep('saving');
    setError(null);
    const batch = selected;
    try {
      const results = await api.createHymns(
        batch.map((s) => ({
          title: effectiveTitle(s),
          composer: '',
          language: defaults.language,
          musicalKey: '',
          songCategory: defaults.songCategory,
          primaryCategory: defaults.primaryCategory,
          raw: songToTagged(s),
        })),
      );
      const ok: SavedSong[] = [];
      const bad: FailedSong[] = [];
      results.forEach((r, i) => {
        if (r.error === undefined) ok.push({ id: r.id, title: r.title || effectiveTitle(batch[i]) });
        else bad.push({ key: batch[i].key, title: effectiveTitle(batch[i]), error: r.error });
      });
      const savedKeys = new Set(batch.filter((_, i) => results[i]?.error === undefined).map((s) => s.key));
      setSongs((list) => list.filter((s) => !savedKeys.has(s.key)));
      setExisting((set) => new Set([...set, ...ok.map((s) => s.title.toLowerCase())]));
      setSaved(ok);
      setFailed(bad);
      setStep('done');
    } catch (err) {
      setError({ kind: 'save', message: errorText(err) });
      setStep('review');
    }
  };

  /** Starts over with a new file. */
  const reset = () => {
    readSerial.current += 1;
    setStep('upload');
    setError(null);
    setFile(null);
    setLines([]);
    setSongs([]);
    setEdited(false);
    setSaved([]);
    setFailed([]);
  };

  /** Back to the review, to fix the songs that were refused. */
  const backToReview = () => {
    const failedKeys = new Set(failed.map((f) => f.key));
    setSongs((list) => list.map((s) => ({ ...s, selected: failedKeys.has(s.key), open: failedKeys.has(s.key) })));
    setStep('review');
  };

  return {
    step,
    stage,
    progress: step === 'reading' ? PROGRESS[stage] : 0,
    error,
    clearError: () => setError(null),
    file,
    options,
    method,
    songs,
    visible,
    selected,
    blocked,
    counts,
    issuesOf,
    query,
    setQuery,
    defaults,
    setDefaults: (patch: Partial<BatchDefaults>) => setDefaults((d) => ({ ...d, ...patch })),
    songCategories,
    categoryMissing,
    canImport,
    /** True while there are reviewed songs that closing would throw away. */
    unsaved: step === 'review' && (edited || songs.length > 0),
    edited,
    saved,
    failed,
    acceptFile,
    browse,
    resplit,
    importSelected,
    reset,
    backToReview,
    ...actions,
  };
}

export type BatchImporter = ReturnType<typeof useBatchImporter>;
