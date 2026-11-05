import { useEffect, useRef, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import type { Hymn } from '../lyrics/types';
import type { PwT } from '../praise-worship/strings';
import { SMALL_BTN, StanzaAddBox, StanzaEditBox } from '../praise-worship/HotEditForms';
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
 * Editing the Holy Mass song on air, as the Praise & Worship console does (see LineupHotEdit): the words of a stanza, and a new stanza after the
 * slide on screen. A change is saved to the song in Song Lyrics, and the song watch redraws the slide on screen with the new words, in place. The
 * title card has no words of its own, so it cannot be edited; a stanza added on it goes before the first stanza.
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
        <span className="text-[11px] text-muted">{t('lineupEditHint')}</span>
      </div>
      {hot.error && (
        <p role="alert" className="text-xs text-danger">
          {hot.error}
        </p>
      )}
      {editingStanza && hot.editing && (
        <StanzaEditBox t={t} hot={hot} stanza={editingStanza} live={hot.editing.index === onAirStanza} onSave={() => void hot.commitEdit()} onSplit={() => void hot.commitSplit(hot.editing!.index)} onSmartBreak={() => void hot.commitSmartBreak(hot.editing!.index)} />
      )}
      {hymn && <StanzaAddBox t={t} hot={hot} stanzas={hymn.stanzas} where={t('newSlideAfter', { name: after })} onAdd={(show) => void saveAdd(show)} />}
    </div>
  );
}
