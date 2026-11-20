import { create } from 'zustand';

/**
 * The Output Preview Editor's Cue Label and Operator Cue Notes: booth-only notes on a slide ("Hold until the speaker reaches the lectern"). They
 * never reach the projector, the TV or a phone, and they change nothing in Song Lyrics, the Lectionary or the Hub. Kept by slide key (the same
 * key as the slide's own look, shared/slide-look.js) in this window's storage, so they are still there after a restart.
 */
export interface CueMeta {
  label?: string;
  notes?: string;
}

const STORE_KEY = 'apcc.goLiveCueMeta';
/** The most notes kept: the oldest go first, so the storage never grows without end. */
const MAX_ENTRIES = 500;
const MAX_TEXT = 300;

function load(): Record<string, CueMeta> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export const useCueMeta = create<{ meta: Record<string, CueMeta> }>()(() => ({ meta: load() }));

const clean = (text: string | undefined) => (text ?? '').trim().slice(0, MAX_TEXT);

/** Saves a slide's label and notes. Empty values are dropped, and a slide with neither has no entry. */
export function setCueMeta(key: string, value: CueMeta): void {
  const label = clean(value.label);
  const notes = clean(value.notes);
  const meta = { ...useCueMeta.getState().meta };
  delete meta[key];
  if (label || notes) meta[key] = { ...(label ? { label } : {}), ...(notes ? { notes } : {}) };
  const keys = Object.keys(meta);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete meta[old];
  useCueMeta.setState({ meta });
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(meta));
  } catch {
    /* without storage the notes last until the window closes */
  }
}

/** A slide's label and notes, or an empty entry. */
export const useCueMetaOf = (key: string | null | undefined): CueMeta => useCueMeta((s) => (key ? s.meta[key] : undefined) ?? EMPTY);
const EMPTY: CueMeta = Object.freeze({});
