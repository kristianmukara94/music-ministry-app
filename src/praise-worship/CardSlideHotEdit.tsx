import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { MAX_NOTE_BODY, slidesNote } from '../../shared/notes.js';
import type { PwSlideOrigin } from '../../shared/pw.js';
import { errorText } from '../whiteboard/errors';
import { useDeleteSlideKey } from '../components/useDeleteSlideKey';
import { DELETE_BTN, editKeys, SMALL_BTN } from './HotEditForms';
import type { LiveStep } from './live';
import { deleteCardStep, originsOf, pagesOfItem, renameCard, saveCardText, type CardTextTarget } from './lineupSlideCopy';
import { usePw } from './store';
import type { PwT } from './strings';

const FIELD = 'w-full rounded-md border border-fg/15 bg-panel px-2 py-1.5 text-sm leading-snug text-fg outline-none focus:border-accent';

/** What Edit or Add does on one slide of a card. */
interface SlidePlan {
  /** Edit: the card's title, or a page of an item's words. Null when the slide has no words (a picture). */
  edit: { kind: 'title'; text: string } | { kind: 'page'; target: CardTextTarget; pages: string[]; page: number } | null;
  /** Add: a new page in an item's words, at `at`. */
  add: { target: CardTextTarget; pages: string[]; at: number };
  /** The slide's name in the editor. */
  name: string;
}

/** Works out what Edit and Add do on step `index` of the card, from where the slide comes from. Null for the black step or a song's slide. */
function planFor(steps: LiveStep[], origins: PwSlideOrigin[], index: number, segment: { name: string; content: { kind: string } }, t: PwT): SlidePlan | null {
  const step = steps[index];
  const origin = origins[index];
  if (!step || step.kind !== 'slide' || !origin || step.slide.kind === 'lyrics') return null;
  const itemTarget = (item: PwSlideOrigin['item']): CardTextTarget => (item === 'head' ? { kind: 'head' } : { kind: 'chain', index: item as number });
  const name = t('slideName', { n: index + 1 });
  if (origin.source === 'pictures' && typeof origin.item === 'number') {
    return { edit: null, add: { target: { kind: 'newChain', at: origin.item + 1 }, pages: [], at: 0 }, name };
  }
  if (origin.title) {
    const edit = { kind: 'title' as const, text: segment.name };
    // A title slide's new slide goes first in the words that follow it, or starts words of the card's own.
    if ((origin.source === 'prayer' || origin.source === 'reading') && origin.item !== 'songs' && origin.item !== 'card') {
      return { edit, add: { target: itemTarget(origin.item), pages: pagesOfItem(steps, origins, origin.item), at: 0 }, name };
    }
    const newHead = origin.item === 'head' || (origin.item === 'card' && segment.content.kind !== 'song');
    return { edit, add: { target: newHead ? { kind: 'newHead' } : { kind: 'newChain', at: 0 }, pages: [], at: 0 }, name };
  }
  if ((origin.source === 'prayer' || origin.source === 'reading') && origin.item !== 'songs' && origin.item !== 'card') {
    const target = itemTarget(origin.item);
    const pages = pagesOfItem(steps, origins, origin.item);
    // A prayer slot with no prayer yet shows a placeholder: its words start the card's own.
    const page = pages.length === 0 ? 0 : (origin.page ?? 0);
    const editPages = pages.length === 0 ? [''] : pages;
    return { edit: { kind: 'page', target, pages: editPages, page }, add: { target, pages, at: pages.length === 0 ? 0 : page + 1 }, name };
  }
  return null;
}

interface Props {
  t: PwT;
  segmentIndex: number;
  steps: LiveStep[];
  /** The step on the projector. */
  onAir: number;
  /** Shows the Edit and Add buttons (false while a song's slide is up: the song editor has its own). */
  showButtons: boolean;
  /** A step the operator double-clicked to edit, or null. */
  editRequest: number | null;
  onEditHandled: () => void;
}

/**
 * Edit slide on air and + Add slide for every slide of a lineup card that is not a song's: prayers, readings, title slides and PowerPoint
 * pictures. The words are saved to the card's own copy (see lineupSlideCopy), and the projector shows the change at once.
 */
export function CardSlideHotEdit({ t, segmentIndex, steps, onAir, showButtons, editRequest, onEditHandled }: Props) {
  const segment = usePw((s) => s.session?.segments[segmentIndex]);
  // Read again whenever the store changes, so a prayer saved a moment ago is laid out as the lineup shows it.
  usePw((s) => s.prayers);
  const origins = segment ? originsOf(segment) : [];
  const [editing, setEditing] = useState<{ step: number; plan: SlidePlan; text: string } | null>(null);
  const [adding, setAdding] = useState<{ step: number; plan: SlidePlan; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const onAirPlan = segment ? planFor(steps, origins, onAir, segment, t) : null;

  // Another card closes the boxes.
  useEffect(() => {
    setEditing(null);
    setAdding(null);
    setError(null);
    setDone(null);
  }, [segment?.key]);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(null), 4000);
    return () => window.clearTimeout(timer);
  }, [done]);

  useEffect(() => {
    if (editRequest === null) return;
    onEditHandled();
    startEdit(editRequest);
  }, [editRequest]);

  function startEdit(step: number) {
    const plan = segment ? planFor(steps, origins, step, segment, t) : null;
    if (!plan?.edit) return;
    setAdding(null);
    setError(null);
    setEditing({ step, plan, text: plan.edit.kind === 'title' ? plan.edit.text : plan.edit.pages[plan.edit.page] ?? '' });
  }

  function startAdd() {
    if (!onAirPlan) return;
    setEditing(null);
    setError(null);
    setAdding({ step: onAir, plan: onAirPlan, text: '' });
  }

  const cancel = () => {
    if (busy) return;
    setEditing(null);
    setAdding(null);
    setError(null);
  };

  async function run(task: () => Promise<void> | void, done: () => void) {
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

  const tooLong = (pages: string[]) => slidesNote(pages).body.length > MAX_NOTE_BODY;

  const saveEdit = () => {
    if (!editing || busy) return;
    const edit = editing.plan.edit;
    if (!edit) return;
    if (edit.kind === 'title') {
      void run(() => renameCard(segmentIndex, editing.text), () => setEditing(null));
      return;
    }
    const pages = edit.pages.map((page, i) => (i === edit.page ? editing.text : page));
    if (tooLong(pages)) return setError(t('slideTooLong', { max: MAX_NOTE_BODY }));
    const keep = origins[onAir] ?? null;
    // The edited slide stays up when it is the one on screen; otherwise the screen keeps its slide.
    const showPage = editing.step === onAir ? edit.page : null;
    void run(() => saveCardText({ segmentIndex, target: edit.target, pages, showPage, keep }), () => setEditing(null));
  };

  const saveAdd = (show: boolean) => {
    if (!adding || busy || !adding.text.trim()) return;
    const { target, pages, at } = adding.plan.add;
    const next = [...pages.slice(0, at), adding.text, ...pages.slice(at)];
    if (tooLong(next)) return setError(t('slideTooLong', { max: MAX_NOTE_BODY }));
    const keep = origins[onAir] ?? null;
    void run(() => saveCardText({ segmentIndex, target, pages: next, showPage: show ? at : null, keep }), () => setAdding(null));
  };

  /** Delete slide, on the slide on screen: it leaves this lineup's card (see deleteCardStep), and the next slide takes its place. */
  const deleteSlide = () => {
    if (busy) return;
    const name = onAirPlan?.name ?? t('slideName', { n: onAir + 1 });
    setEditing(null);
    setAdding(null);
    setDone(null);
    void run(
      async () => {
        const refusal = await deleteCardStep(segmentIndex, steps, onAir);
        if (refusal) throw new Error(t(refusal));
        setDone(t('deleteSlideDone', { name }));
      },
      () => undefined,
    );
  };
  const slideCount = steps.filter((s) => s.kind === 'slide').length;
  const canDelete = showButtons && !busy && onAirPlan !== null && slideCount > 1;
  // Delete and Backspace work while the card editor has the slide on screen; on a song's slide, the song editor takes them.
  useDeleteSlideKey(showButtons && !busy && onAirPlan ? deleteSlide : null);

  const editingLive = editing?.step === onAir;

  return (
    <div className="flex flex-col gap-2">
      {showButtons && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!onAirPlan?.edit || busy}
            onClick={() => startEdit(onAir)}
            title={onAirPlan?.edit ? t('editWords', { name: onAirPlan.name }) : t('slideEditNone')}
            className={`${SMALL_BTN} border-fg/15 text-fg/85 hover:border-accent hover:text-accent`}
          >
            <Pencil size={13} aria-hidden />
            {t('editOnAir')}
          </button>
          <button
            type="button"
            disabled={!onAirPlan || busy}
            onClick={startAdd}
            title={t('slideAddTip')}
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
            title={!onAirPlan ? t('deleteSlideNone') : slideCount <= 1 ? t('deleteSlideLast') : t('deleteSlideTip', { name: onAirPlan.name })}
            className={DELETE_BTN}
          >
            <Trash2 size={13} aria-hidden />
            {t('deleteSlide')}
          </button>
          <span className="text-[11px] text-muted">{t('slideEditHint')}</span>
        </div>
      )}
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
      {editing && (
        <div className={`flex flex-col gap-2 rounded-lg border p-3 ${editingLive ? 'border-danger bg-danger/10' : 'border-accent/50 bg-panel'}`}>
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-bold tracking-wider text-accent uppercase">{editing.plan.edit?.kind === 'title' ? t('slideTitleName') : editing.plan.name}</span>
            {editingLive && <span className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-extrabold text-white uppercase">{t('onAirBadge')}</span>}
            <span className="text-[11px] text-muted">{editing.plan.edit?.kind === 'title' ? t('slideTitleNote') : editingLive ? t('editLiveNote') : t('slideEditNote')}</span>
          </span>
          <textarea
            autoFocus
            rows={editing.plan.edit?.kind === 'title' ? 1 : Math.max(3, editing.text.split('\n').length)}
            value={editing.text}
            aria-label={t('editWords', { name: editing.plan.name })}
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
      {adding && (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/50 bg-accent/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('newSlide')}</span>
            <span className="text-xs text-muted">{t('newSlideAfter', { name: adding.plan.name })}</span>
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
            <button type="button" onClick={() => saveAdd(true)} disabled={busy || !adding.text.trim()} className={`${SMALL_BTN} border-danger bg-danger text-white hover:brightness-110`} title="Ctrl + Enter">
              {t('addAndShow')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
