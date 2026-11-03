import { useEffect, useRef, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { arrangementWithInsert, findStanzaStep, lyricAt, occurrenceOf } from '../../shared/pw-hot-edit.js';
import type { Hymn } from '../lyrics/types';
import { jumpTo, liveDeck, type LiveStep } from './live';
import { updateSegment, usePw } from './store';
import type { PwT } from './strings';
import { SMALL_BTN, StanzaAddBox, StanzaEditBox } from './HotEditForms';
import { useLiveHotEditor } from './useLiveHotEditor';

/** How long Add and show waits for the lineup to read the saved song back before it gives up on showing the new slide. */
const SHOW_WAIT_MS = 3000;

/** Resolves true once the lineup's copy of the song has this stanza, or false when it has not within the wait. */
function untilLineupHas(hymnId: number, stanzaId: number): Promise<boolean> {
  const has = () => Boolean(usePw.getState().hymns[hymnId]?.stanzas.some((s) => s.id === stanzaId));
  if (has()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      stop();
      resolve(false);
    }, SHOW_WAIT_MS);
    const stop = usePw.subscribe(() => {
      if (!has()) return;
      window.clearTimeout(timer);
      stop();
      resolve(true);
    });
  });
}

interface Props {
  t: PwT;
  segmentIndex: number;
  steps: LiveStep[];
  /** The step on the projector. */
  onAir: number;
  /** A step whose stanza the operator asked to edit (a double-click on its chip), or null. */
  editRequest: number | null;
  onEditHandled: () => void;
}

/**
 * Editing the lineup's songs while the lineup is on air: the words of a slide's stanza, and a new stanza after the slide on screen.
 *
 * A change is saved to the song, as in the Quick Live cue panel. The song watch then redraws the slide on screen with the new words, in place:
 * the same slide stays up, with no transition, and the background video, its shade and the lower third carry on. The lineup's own copy of the
 * song is left for that watch to refresh, so the watch can still see what changed.
 *
 * A new stanza goes straight after the slide on screen, in the song and, when the card sings the song in its own order, in that order too.
 * Add leaves the projector where it is. Add and show goes to the new slide.
 */
export function LineupHotEdit({ t, segmentIndex, steps, onAir, editRequest, onEditHandled }: Props) {
  // The step the edit or the new stanza belongs to, and the song behind it.
  const [target, setTarget] = useState<number | null>(null);
  const hymns = usePw((s) => s.hymns);
  const slide = target === null ? null : lyricAt(steps, target);
  const hymn: Hymn | null = slide ? hymns[slide.hymnId] ?? null : null;
  // The song as last saved from here, for placing a new stanza by its id.
  const saved = useRef<Hymn | null>(null);
  const hot = useLiveHotEditor(hymn, (fresh) => {
    saved.current = fresh;
  });
  const onAirSlide = lyricAt(steps, onAir);

  // A double-click on a lyric chip opens that slide's stanza for editing.
  useEffect(() => {
    if (editRequest === null) return;
    onEditHandled();
    if (lyricAt(steps, editRequest)) open(editRequest, 'edit');
  }, [editRequest]);

  // Once the target is set and its song is at hand, the editor opens on the stanza.
  const [mode, setMode] = useState<'edit' | 'add' | null>(null);
  // Counts each request, so asking again for the same slide opens it again.
  const [requests, setRequests] = useState(0);
  useEffect(() => {
    if (target === null || !slide || !hymn) return;
    if (mode === 'add') hot.startAdd();
    else hot.startEdit(slide.position ?? hymn.stanzas.findIndex((s) => String(s.id) === slide.sectionId));
  }, [target, mode, requests, hymn?.id]);

  // Closing either box clears the target, so the next request starts fresh.
  useEffect(() => {
    if (!hot.editing && !hot.adding && !hot.busy && target !== null && mode !== null) {
      setTarget(null);
      setMode(null);
    }
  }, [hot.editing, hot.adding, hot.busy]);

  function open(index: number, next: 'edit' | 'add') {
    setMode(next);
    setTarget(index);
    setRequests((n) => n + 1);
  }

  const saveAdd = async (show: boolean) => {
    if (target === null || !slide || !hymn) return;
    const occurrence = occurrenceOf(steps, target);
    const at = await hot.commitAdd(slide.position ?? null);
    if (at === null) return;
    const added = saved.current?.id === hymn.id ? saved.current.stanzas[at] : undefined;
    if (!added) return;
    // A card with its own order sings only the stanzas it lists, so the new one is listed straight after this appearance of the slide's stanza.
    const segment = usePw.getState().session?.segments[segmentIndex];
    if (segment) {
      const arrangement = arrangementWithInsert(segment.arrangement, hymn.id, slide.sectionId, occurrence, added.id);
      if (arrangement !== segment.arrangement) updateSegment(segmentIndex, { arrangement });
    }
    if (!show) return;
    if (!(await untilLineupHas(hymn.id, added.id))) return;
    const session = usePw.getState().session;
    const index = session ? findStanzaStep(liveDeck(session)[segmentIndex] ?? [], hymn.id, added.id, target) : null;
    if (index !== null) jumpTo(segmentIndex, index);
  };

  const editingStanza = hot.editing && hymn ? hymn.stanzas[hot.editing.index] : null;

  // The Holy Mass is on air: the lineup editor is not shown.
  if (hot.locked) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!onAirSlide || hot.busy}
          onClick={() => open(onAir, 'edit')}
          title={onAirSlide ? t('editWords', { name: onAirSlide.label }) : t('lineupEditOnlySongs')}
          className={`${SMALL_BTN} border-fg/15 text-fg/85 hover:border-accent hover:text-accent`}
        >
          <Pencil size={13} aria-hidden />
          {t('editOnAir')}
        </button>
        <button
          type="button"
          disabled={!onAirSlide || hot.busy}
          onClick={() => open(onAir, 'add')}
          title={onAirSlide ? t('addSlideTip') : t('lineupEditOnlySongs')}
          className={`${SMALL_BTN} border-fg/15 text-fg/85 hover:border-accent hover:text-accent`}
        >
          <Plus size={14} aria-hidden />
          {t('addSlide')}
        </button>
        <span className="text-[11px] text-muted">{t('lineupEditHint')}</span>
      </div>
      {hot.error && (
        <p role="alert" className="text-xs text-danger">
          {hot.error}
        </p>
      )}
      {editingStanza && slide && hot.editing && (
        <StanzaEditBox t={t} hot={hot} stanza={editingStanza} live={target === onAir} onSave={() => void hot.commitEdit()} onSplit={() => void hot.commitSplit(hot.editing!.index)} />
      )}
      {hymn && slide && (
        <StanzaAddBox t={t} hot={hot} stanzas={hymn.stanzas} where={t('newSlideAfter', { name: slide.label })} onAdd={(show) => void saveAdd(show)} />
      )}
    </div>
  );
}
