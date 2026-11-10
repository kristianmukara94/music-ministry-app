import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Frame, QueueItem } from '../../shared/live.js';
import { pagesWithout, slideAfterDelete } from '../../shared/pw-hot-edit.js';
import type { PwT } from '../praise-worship/strings';
import { DELETE_BTN, editKeys, SMALL_BTN } from '../praise-worship/HotEditForms';
import { useDeleteSlideKey } from '../components/useDeleteSlideKey';
import type { Note } from '../notes/types';
import { errorText } from '../whiteboard/errors';
import { MAX_NOTE_BODY, saveItemSlides, slideIndexOf, slidePagesOf, slidesTooLong } from './massSlideCopy';

const FIELD = 'w-full rounded-md border border-fg/15 bg-panel px-2 py-1.5 text-sm leading-snug text-fg outline-none focus:border-accent';

interface Props {
  t: PwT;
  /** The queue row the console shows, and its place in the queue. */
  item: QueueItem;
  index: number;
  /** The item's slide the console shows: on screen, or staged and ready. */
  frame: Frame;
  /** The prayer behind a prayer's slide (useNoteOf), or null. */
  note: Note | null;
  /** Whether that slide is on screen now (not only staged). */
  onAir: boolean;
  /** A slide the operator double-clicked to edit, or null. */
  editRequest: number | null;
  onEditHandled: () => void;
}

/**
 * Edit slide on air and Add slide for a Holy Mass item that is not a song: a Mass part, a reading, a psalm, a prayer, a typed response or a
 * passage. The change is saved to this plan's own copy of the item (see massSlideCopy), so the Mass text, the Lectionary and the Hub's prayers
 * stay as they are. The slide on screen shows the new words as soon as it is saved, and an item of one slide steps 1 / 2 once a slide is added.
 */
export function MassSlideHotEdit({ t, item, index, frame, note, onAir, editRequest, onEditHandled }: Props) {
  const [editing, setEditing] = useState<{ page: number; text: string } | null>(null);
  const [adding, setAdding] = useState<{ after: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pages = item.stale ? null : slidePagesOf(frame, note);
  const current = slideIndexOf(frame);

  // Another item closes the boxes: their slide numbers belong to the item they were opened on.
  useEffect(() => {
    setEditing(null);
    setAdding(null);
    setError(null);
    setDone(null);
  }, [item.id]);

  // A confirmation fades on its own.
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(null), 4000);
    return () => window.clearTimeout(timer);
  }, [done]);

  // A double-click on a slide chip opens that slide.
  useEffect(() => {
    if (editRequest === null) return;
    onEditHandled();
    if (pages?.[editRequest] !== undefined) startEdit(editRequest);
  }, [editRequest]);

  function startEdit(page: number) {
    if (!pages || pages[page] === undefined) return;
    setAdding(null);
    setError(null);
    setEditing({ page, text: pages[page] });
  }

  function startAdd() {
    setEditing(null);
    setError(null);
    setAdding({ after: current, text: '' });
  }

  const cancel = () => {
    if (busy) return;
    setEditing(null);
    setAdding(null);
    setError(null);
  };

  async function save(next: string[], showPage: number, inPlace: boolean, done: () => void) {
    if (slidesTooLong(next)) {
      setError(t('slideTooLong', { max: MAX_NOTE_BODY }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveItemSlides({ index, item, note, pages: next, showPage, inPlace });
      done();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const saveEdit = () => {
    if (!pages || !editing || busy) return;
    const next = pages.map((page, i) => (i === editing.page ? editing.text : page));
    // The slide on screen stays up: with new words when it is the one edited.
    void save(next, current, editing.page === current, () => setEditing(null));
  };

  const saveAdd = (show: boolean) => {
    if (!pages || !adding || busy || !adding.text.trim()) return;
    const at = Math.min(adding.after + 1, pages.length);
    const next = [...pages.slice(0, at), adding.text, ...pages.slice(at)];
    // The new slide goes after the one on screen, so the slide on screen keeps its number; Add and show moves on to the new one.
    void save(next, show ? at : current, false, () => setAdding(null));
  };

  /**
   * Delete slide, on the slide on screen (or staged): it leaves this plan's copy of the item, and the slide that followed it takes its place,
   * or the one before it when it was the last. An item's only slide stays, with a note saying why.
   */
  const deleteSlide = () => {
    if (!pages || busy) return;
    const next = pagesWithout(pages, current);
    if (!next) {
      setDone(null);
      setError(t('deleteSlideLast'));
      return;
    }
    setEditing(null);
    setAdding(null);
    const name = t('slideName', { n: current + 1 });
    void save(next, slideAfterDelete(current, next.length), false, () => setDone(t('deleteSlideDone', { name })));
  };

  const canEdit = pages !== null && !busy;
  const canDelete = canEdit && pages.length > 1;
  const editingLive = onAir && editing?.page === current;

  // Delete and Backspace delete the slide on screen, as the button does. An item with no words to change leaves the key alone.
  useDeleteSlideKey(pages && !busy ? deleteSlide : null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => startEdit(current)}
          title={pages ? t('editWords', { name: t('slideName', { n: current + 1 }) }) : t('slideEditNone')}
          className={`${SMALL_BTN} border-fg/15 text-fg/85 hover:border-accent hover:text-accent`}
        >
          <Pencil size={13} aria-hidden />
          {t('editOnAir')}
        </button>
        <button
          type="button"
          disabled={!canEdit}
          onClick={startAdd}
          title={pages ? t('slideAddTip') : t('slideEditNone')}
          className={`${SMALL_BTN} border-fg/15 text-fg/85 hover:border-accent hover:text-accent`}
        >
          <Plus size={14} aria-hidden />
          {t('addSlide')}
        </button>
        <button
          type="button"
          disabled={!canDelete}
          onClick={deleteSlide}
          aria-keyshortcuts="Delete Backspace"
          title={!pages ? t('slideEditNone') : pages.length <= 1 ? t('deleteSlideLast') : t('deleteSlideTip', { name: t('slideName', { n: current + 1 }) })}
          className={DELETE_BTN}
        >
          <Trash2 size={13} aria-hidden />
          {t('deleteSlide')}
        </button>
        <span className="text-[11px] text-muted">{t('slideEditHint')}</span>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-xs text-ok">
          {done}
        </p>
      )}
      {editing && pages && (
        <div className={`flex flex-col gap-2 rounded-lg border p-3 ${editingLive ? 'border-danger bg-danger/10' : 'border-accent/50 bg-panel'}`}>
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-bold tracking-wider text-accent uppercase">
              {t('slideName', { n: editing.page + 1 })} / {pages.length}
            </span>
            {editingLive && <span className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-extrabold text-white uppercase">{t('onAirBadge')}</span>}
            <span className="text-[11px] text-muted">{editingLive ? t('editLiveNote') : t('slideEditNote')}</span>
          </span>
          <textarea
            autoFocus
            rows={Math.max(3, editing.text.split('\n').length)}
            value={editing.text}
            aria-label={t('editWords', { name: t('slideName', { n: editing.page + 1 }) })}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            onKeyDown={(e) => editKeys(e, saveEdit, cancel)}
            className={FIELD}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={cancel} disabled={busy} className={`${SMALL_BTN} border-fg/15 text-fg/70 hover:text-fg`}>
              {t('cancelEdit')}
            </button>
            <button type="button" onClick={saveEdit} disabled={busy} className={`${SMALL_BTN} border-accent bg-accent text-on-accent hover:brightness-110`} title="Ctrl + Enter">
              {t('saveEdit')}
            </button>
          </div>
        </div>
      )}
      {adding && pages && (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/50 bg-accent/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('newSlide')}</span>
            <span className="text-xs text-muted">{t('newSlideAfter', { name: t('slideName', { n: adding.after + 1 }) })}</span>
          </div>
          <textarea
            autoFocus
            rows={4}
            value={adding.text}
            aria-label={t('newSlideWords')}
            placeholder={t('newSlideWords')}
            onChange={(e) => setAdding({ ...adding, text: e.target.value })}
            onKeyDown={(e) => editKeys(e, () => saveAdd(true), cancel)}
            className={FIELD}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={cancel} disabled={busy} className={`${SMALL_BTN} border-fg/15 text-fg/70 hover:text-fg`}>
              {t('cancelEdit')}
            </button>
            <button type="button" onClick={() => saveAdd(false)} disabled={busy || !adding.text.trim()} className={`${SMALL_BTN} border-accent/50 text-accent hover:bg-accent/10`}>
              {t('addOnly')}
            </button>
            <button
              type="button"
              onClick={() => saveAdd(true)}
              disabled={busy || !adding.text.trim()}
              className={`${SMALL_BTN} border-danger bg-danger text-white hover:brightness-110`}
              title="Ctrl + Enter"
            >
              {t('addAndShow')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
