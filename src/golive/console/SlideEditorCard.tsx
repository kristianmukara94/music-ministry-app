import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { draftPending, editorInit, editorReducer, pad2, shouldApplyLive, type EditorMode } from '../../../shared/stage-cue.js';
import { useDeleteSlideKey } from '../../components/useDeleteSlideKey';
import type { SlideLook } from '../../../shared/slide-look.js';
import { useGoLiveT } from '../strings';
import { BTN, BTN_ACTIVE, BTN_DANGER, BTN_DANGER_ACTIVE, BTN_PRIMARY, CARD, CARD_TITLE } from './styles';

/** How long Live Sync waits after the last key before it saves, so each word goes on screen whole rather than letter by letter. */
const LIVE_SYNC_PAUSE_MS = 350;

/** The editor's mode, kept for this window: Staged Draft unless the operator chose Live Sync. */
const MODE_KEY = 'apcc.goLiveEditorMode';
function savedMode(): EditorMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'live' ? 'live' : 'staged';
  } catch {
    return 'staged';
  }
}

/**
 * One slide the editor can change, given by the console. Every write goes through the console's copy-on-write paths (the song's on-air
 * stanzas, the plan's or lineup's own copy of a prayer or reading), so Song Lyrics, the Lectionary and the Hub are never written from here.
 */
export interface SlideEditTarget {
  /** Changes when another slide goes on air. */
  key: string;
  /** 1-based, for the title. */
  number: number;
  text: string;
  tag: string | null;
  /** The tags the Section Tag menu offers, or null when this slide has no tag of its own (the tag is then shown, not edited). */
  tagOptions: string[] | null;
  /**
   * Saves new words (and tag). Rejects with the reason when the change is refused. `details` is the slide's own look and booth notes, which a
   * song keeps in its default slide arrangement with the words (the other kinds of slide keep them on air only and ignore it).
   */
  apply: (text: string, tag: string | null, details?: SongSlideDetails) => Promise<void>;
  /** Saves a new slide after this one, off screen. Null when this slide takes none. */
  add: ((text: string, tag: string | null) => Promise<void>) | null;
  /** Deletes this slide. Null while it cannot be deleted (the item's only slide). */
  remove: (() => Promise<void>) | null;
  /**
   * A song's slide: every change above is also saved as the song's default slide arrangement, so later uses of the song play these slides.
   * Missing for any other kind of slide.
   */
  song?: SongDefaultControls;
}

/** A slide's own look and booth notes, as a song's default arrangement keeps them. */
export interface SongSlideDetails {
  look?: SlideLook | null;
  notes?: string;
}

/** The song default controls the slide editor offers on a song's slide. */
export interface SongDefaultControls {
  /** 'default' while the song plays its saved arrangement, 'auto' while it is paged automatically. */
  layout: 'default' | 'auto';
  /** Saves this slide's look and notes into the song's default arrangement (a change of words goes through apply). */
  saveDetails: (details: SongSlideDetails) => Promise<void>;
  /** Reset Default Layout: clears the arrangement, so the song is paged automatically again. */
  reset: () => Promise<void>;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const FIELD = 'w-full rounded-lg border border-line bg-canvas/60 px-2.5 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-50';

interface Props {
  target: SlideEditTarget | null;
  /** Said in place of the fields when there is no target. */
  emptyHint: string;
  /** In place of the fields for a slide the console edits its own way (a Praise & Worship card's title or prayer). */
  fallback?: ReactNode;
  /** The slide number for the title when there is no target. */
  number?: number | null;
  /** Opens the Output Preview Editor on the slide on air. Null when there is nothing on air to open it on. */
  onOpenEditor?: (() => void) | null;
}

/**
 * The slide editor beside the monitors: the slide on air's words and Section Tag. In Staged Draft (the default, and the safe one) a change
 * waits for Apply to Live, and Discard puts the words on air back, so a half-typed word never flashes onto the congregation's screen. In Live
 * Sync each change is saved as the typing pauses. + Add Slide After writes a new slide that waits off screen. Delete Slide asks first
 * (Confirm Delete / Cancel), and is off for an item's only slide. Delete and Backspace only ask; they never delete on their own.
 */
export function SlideEditorCard({ target, emptyHint, fallback, number = null, onOpenEditor = null }: Props) {
  const t = useGoLiveT();
  const slide = target ? { key: target.key, text: target.text, tag: target.tag } : null;
  const [state, send] = useReducer(editorReducer, slide, (s) => editorInit(s, savedMode()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(target);
  latest.current = target;

  // The slide on air moved, or its words were saved: the editor follows (see editorReducer 'slide').
  useEffect(() => {
    send({ type: 'slide', slide });
    setError(null);
  }, [slide?.key, slide?.text, slide?.tag]);

  async function run(task: () => Promise<void>, done: () => void) {
    setBusy(true);
    setError(null);
    try {
      await task();
      done();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const apply = () => {
    const tgt = latest.current;
    if (!tgt || busy) return;
    const { text, tag } = state.draft;
    if (state.adding) {
      if (tgt.add && text.trim()) void run(() => tgt.add!(text, tag), () => send({ type: 'applied' }));
      return;
    }
    void run(() => tgt.apply(text, tag), () => send({ type: 'applied' }));
  };

  // Live Sync: the change is saved once the typing pauses. A failed save leaves the words in the box, with the reason under them.
  useEffect(() => {
    if (!shouldApplyLive(state) || busy || !target) return;
    const timer = window.setTimeout(apply, LIVE_SYNC_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [state, busy]);

  const toggleMode = () => {
    const mode: EditorMode = state.mode === 'live' ? 'staged' : 'live';
    send({ type: 'mode', mode });
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* a convenience only */
    }
  };

  const canDelete = Boolean(target?.remove) && !busy && !state.adding;
  useDeleteSlideKey(canDelete ? () => send({ type: 'askDelete', canDelete }) : null);
  const remove = () => {
    const tgt = latest.current;
    if (!tgt?.remove) return;
    void run(tgt.remove, () => send({ type: 'cancelDelete' }));
  };

  const shownNumber = target?.number ?? number;
  const pending = draftPending(state);
  const live = state.mode === 'live';
  return (
    <section aria-labelledby="slide-editor-title" className={`${CARD} flex flex-col gap-3 p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <h2 id="slide-editor-title" className={CARD_TITLE}>
          {shownNumber ? t('consoleEditorTitle', { n: pad2(shownNumber) }) : t('consoleEditorTitleNone')}
        </h2>
        <button type="button" role="switch" aria-checked={live} onClick={toggleMode} title={t(live ? 'consoleLiveSyncTip' : 'consoleStagedTip')} className={live ? BTN_ACTIVE : BTN}>
          <span aria-hidden className={`size-1.5 rounded-full ${live ? 'animate-pulse bg-danger' : 'bg-ok'}`} />
          {t(live ? 'consoleLiveSync' : 'consoleStaged')}
        </button>
      </div>
      {onOpenEditor && (
        <button type="button" onClick={onOpenEditor} aria-keyshortcuts="E" className={`${BTN_ACTIVE} w-full`}>
          {t('consoleOpenEditor')}
        </button>
      )}

      {!target ? (
        fallback ?? <p className="text-sm text-muted">{emptyHint}</p>
      ) : (
        <>
          {state.adding && <p className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs text-accent">{t('consoleNewSlide', { n: pad2(target.number) })}</p>}
          <div>
            <label htmlFor="slide-editor-tag" className="mb-1.5 block text-xs text-muted">{t('consoleSectionTag')}</label>
            {target.tagOptions ? (
              <select
                id="slide-editor-tag"
                value={state.draft.tag ?? ''}
                disabled={busy}
                onChange={(e) => send({ type: 'edit', tag: e.target.value })}
                className={`${FIELD} h-9 py-0`}
              >
                {[...new Set([state.draft.tag ?? '', ...target.tagOptions])].filter(Boolean).map((tag) => (
                  <option key={tag} value={tag} className="bg-surface">
                    {tag}
                  </option>
                ))}
              </select>
            ) : (
              <p id="slide-editor-tag" className={`${FIELD} truncate text-fg/85`}>{target.tag ?? '—'}</p>
            )}
          </div>
          <div>
            <label htmlFor="slide-editor-lines" className="mb-1.5 block text-xs text-muted">{t('consoleSlideLines')}</label>
            <textarea
              id="slide-editor-lines"
              rows={Math.min(10, Math.max(4, state.draft.text.split('\n').length))}
              value={state.draft.text}
              disabled={busy && live}
              onChange={(e) => send({ type: 'edit', text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && pending) {
                  e.preventDefault();
                  apply();
                } else if (e.key === 'Escape' && pending) {
                  e.preventDefault();
                  e.stopPropagation();
                  send({ type: 'discard' });
                }
              }}
              className={`${FIELD} resize-y leading-snug ${live && !state.adding ? 'border-danger/50' : ''}`}
            />
          </div>
          {pending && (
            <div className="flex gap-2">
              <button type="button" disabled={busy || (state.adding && !state.draft.text.trim())} onClick={apply} title="Ctrl + Enter" className={`${BTN_PRIMARY} flex-1`}>
                {t(state.adding ? 'consoleAddApply' : 'consoleApply')}
              </button>
              <button type="button" disabled={busy} onClick={() => send({ type: 'discard' })} title="Escape" className={BTN}>
                {t('consoleDiscard')}
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <button type="button" disabled={!target.add || busy || state.adding} onClick={() => send({ type: 'add' })} className={BTN}>
              {t('consoleAddAfter')}
            </button>
            {state.confirmDelete ? (
              <div role="group" aria-label={t('consoleDelete')} className="flex gap-1.5">
                <button type="button" disabled={busy} onClick={remove} className={BTN_DANGER_ACTIVE}>
                  {t('consoleConfirmDelete')}
                </button>
                {/* Cancel has the focus, so an Enter pressed by slip never deletes. */}
                <button type="button" autoFocus disabled={busy} onClick={() => send({ type: 'cancelDelete' })} className={BTN}>
                  {t('consoleCancel')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!canDelete}
                aria-keyshortcuts="Delete Backspace"
                title={target.remove ? undefined : t('consoleDeleteOne')}
                onClick={() => send({ type: 'askDelete', canDelete })}
                className={BTN_DANGER}
              >
                {t('consoleDelete')}
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted">{t('consoleCopyNote')}</p>
        </>
      )}
    </section>
  );
}
