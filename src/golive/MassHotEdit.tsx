import { useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Hymn } from '../lyrics/types';
import type { PwT } from '../praise-worship/strings';
import { DELETE_BTN, SMALL_BTN, StanzaAddBox, StanzaEditBox } from '../praise-worship/HotEditForms';
import { useDeleteSlideKey } from '../components/useDeleteSlideKey';
import { useLiveHotEditor } from '../praise-worship/useLiveHotEditor';

interface Props {
  t: PwT;
  /** The song of the item on screen, or null when the item is not a song. */
  hymn: Hymn | null;
  /** The step on the projector: 0 is the song's title card, step n is stanza n - 1. Null when the Holy Mass is not on air. */
  onAir: number | null;
  /** A step whose stanza the operator asked to edit (a double-click on its chip), or null. */
  editRequest: number | null;
  onEditHandled: () => void;
  /** Puts a step of the song on screen: Add and show goes to the new stanza. */
  onShow: (step: number) => void;
}

/**
 * Editing the Holy Mass song on air, as the Praise & Worship console does (see LineupHotEdit): the words of a stanza, a new stanza after the
 * slide on screen, and Delete slide on the stanza on screen. Every change is for this service only (live/liveSongEdits): the song in Song
 * Lyrics is never written. The song watch redraws the slide on screen with the new words, in place. The title card has no words of its own,
 * so it cannot be edited or deleted; a stanza added on it goes before the first stanza.
 */
export function MassHotEdit({ t, hymn, onAir, editRequest, onEditHandled, onShow }: Props) {
  const saved = useRef<Hymn | null>(null);
  const hot = useLiveHotEditor(hymn, (fresh) => {
    saved.current = fresh;
  });
  // Where Add puts the new stanza: after the stanza that was on screen when Add was pressed (-1 is the title card).
  const [addAfter, setAddAfter] = useState(-1);
  const onAirStanza = hymn && onAir !== null && onAir >= 1 && hymn.stanzas[onAir - 1] ? onAir - 1 : null;
  const canAdd = hymn !== null && onAir !== null;
  // Delete slide takes the stanza on screen out of the song for this service only; the stanza after it takes its place on screen (the song
  // watch keeps the position). The song's only stanza stays.
  const [deleteMsg, setDeleteMsg] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => setDeleteMsg(null), [hymn?.id]);
  useEffect(() => {
    if (!deleteMsg) return;
    const timer = window.setTimeout(() => setDeleteMsg(null), 4000);
    return () => window.clearTimeout(timer);
  }, [deleteMsg]);
  const lastStanza = hymn !== null && hymn.stanzas.length <= 1;
  const deleteStanza = async () => {
    if (!hymn || hot.busy) return;
    if (onAirStanza === null) {
      setDeleteMsg({ text: t('slideEditNone'), ok: false });
      return;
    }
    if (lastStanza) {
      setDeleteMsg({ text: t('deleteSlideLastStanza'), ok: false });
      return;
    }
    const name = hymn.stanzas[onAirStanza].stanzaType;
    if (await hot.commitDelete(onAirStanza)) setDeleteMsg({ text: t('deleteSlideDone', { name }), ok: true });
  };
  useDeleteSlideKey(hymn && !hot.busy ? () => void deleteStanza() : null);

  // A double-click on a section chip opens that stanza for editing. The title card's chip opens nothing.
  useEffect(() => {
    if (editRequest === null) return;
    onEditHandled();
    if (hymn?.stanzas[editRequest - 1]) hot.startEdit(editRequest - 1);
  }, [editRequest]);

  const startAdd = () => {
    if (onAir === null) return;
    setAddAfter(onAir - 1);
    hot.startAdd();
  };

  const saveAdd = async (show: boolean) => {
    const at = await hot.commitAdd(addAfter);
    if (at !== null && show) onShow(at + 1);
  };

  const editingStanza = hot.editing && hymn ? hymn.stanzas[hot.editing.index] : null;
  const after = hymn ? (addAfter < 0 ? t('titleChip') : hymn.stanzas[addAfter]?.stanzaType ?? '') : '';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={onAirStanza === null || hot.busy}
          onClick={() => onAirStanza !== null && hot.startEdit(onAirStanza)}
          title={onAirStanza !== null && hymn ? t('editWords', { name: hymn.stanzas[onAirStanza].stanzaType }) : t('lineupEditOnlySongs')}
          className={`${SMALL_BTN} border-fg/15 text-fg/85 hover:border-accent hover:text-accent`}
        >
          <Pencil size={13} aria-hidden />
          {t('editOnAir')}
        </button>
        <button
          type="button"
          disabled={!canAdd || hot.busy}
          onClick={startAdd}
          title={canAdd ? t('addSlideTip') : t('lineupEditOnlySongs')}
          className={`${SMALL_BTN} border-fg/15 text-fg/85 hover:border-accent hover:text-accent`}
        >
          <Plus size={14} aria-hidden />
          {t('addSlide')}
        </button>
        <button
          type="button"
          disabled={onAirStanza === null || hot.busy || lastStanza}
          onClick={() => void deleteStanza()}
          aria-keyshortcuts="Delete Backspace"
          title={onAirStanza === null || !hymn ? t('lineupEditOnlySongs') : lastStanza ? t('deleteSlideLastStanza') : t('deleteStanzaTip', { name: hymn.stanzas[onAirStanza].stanzaType })}
          className={DELETE_BTN}
        >
          <Trash2 size={13} aria-hidden />
          {t('deleteSlide')}
        </button>
        <span className="text-[11px] text-muted">{t('lineupEditHint')}</span>
      </div>
      {hot.error && (
        <p role="alert" className="text-xs text-danger">
          {hot.error}
        </p>
      )}
      {deleteMsg && (
        <p role={deleteMsg.ok ? 'status' : 'alert'} className={`text-xs ${deleteMsg.ok ? 'text-ok' : 'text-danger'}`}>
          {deleteMsg.text}
        </p>
      )}
      {editingStanza && hot.editing && (
        <StanzaEditBox t={t} hot={hot} stanza={editingStanza} live={hot.editing.index === onAirStanza} onSave={() => void hot.commitEdit()} onSplit={() => void hot.commitSplit(hot.editing!.index)} onSmartBreak={() => void hot.commitSmartBreak(hot.editing!.index)} />
      )}
      {hymn && <StanzaAddBox t={t} hot={hot} stanzas={hymn.stanzas} where={t('newSlideAfter', { name: after })} onAdd={(show) => void saveAdd(show)} />}
    </div>
  );
}
