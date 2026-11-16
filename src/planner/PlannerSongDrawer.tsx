import { useEffect, useState } from 'react';
import { PenLine, Plus } from 'lucide-react';
import { highlightParts } from '../../shared/text-highlight.js';
import { bridge } from '../live/bridge';
import type { Hymn } from '../lyrics/types';
import type { PlannerT } from './strings';

/** The search phrase marked inside one line of lyrics. */
function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-sm bg-accent/30 px-0.5 text-fg">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A song's words, opened inline under its card in the Holy Mass planner's Library, as the Praise & Worship Library does: each stanza under its
 * section badge, with the search phrase marked, and Edit Song and Add under them. It reads the song itself and reads it again on every
 * `revision` (the planner bumps it on lyrics:changed), so a save in the Edit Hymn form shows here at once. Clicks and drags inside stay
 * inside: they never pick the card or start a drag.
 */
export function PlannerSongDrawer({
  hymnId,
  query,
  revision,
  t,
  addLabel,
  canAdd,
  onAdd,
  onEdit,
}: {
  hymnId: number;
  query: string;
  revision: number;
  t: PlannerT;
  addLabel: string;
  canAdd: boolean;
  onAdd: () => void;
  onEdit: () => void;
}) {
  const [hymn, setHymn] = useState<Hymn | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    bridge.lyrics
      .getHymn(hymnId)
      .then((h) => current && setHymn(h && !h.deletedAt ? h : null))
      .catch(() => current && setHymn(null));
    return () => {
      current = false;
    };
  }, [hymnId, revision]);

  const footerBtn =
    'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div
      data-lyrics-preview
      className="mt-2 basis-full cursor-auto"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      draggable={false}
    >
      <div className="max-h-56 overflow-y-auto rounded-lg border border-line-strong bg-surface-2 p-3 select-text">
        {hymn === undefined && <p className="text-xs text-muted">{t('libLyricsLoading')}</p>}
        {hymn === null && <p className="text-xs text-danger">{t('libLyricsMissing')}</p>}
        {hymn && hymn.stanzas.length === 0 && <p className="text-xs text-muted">{t('libLyricsEmpty')}</p>}
        {hymn && hymn.stanzas.length > 0 && (
          <ol className="flex flex-col gap-3">
            {hymn.stanzas.map((s) => (
              <li key={s.id} className="flex flex-col gap-1">
                <span className="w-fit rounded border border-accent/40 bg-accent/10 px-1.5 py-px font-mono text-[10px] font-bold tracking-wider text-accent uppercase">{s.stanzaType}</span>
                <p className="text-sm leading-relaxed whitespace-pre-line text-fg">
                  <Marked text={s.lyricsText} query={query} />
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onEdit} disabled={!hymn} className={`${footerBtn} border-line-strong bg-surface-2 text-fg hover:border-accent hover:text-accent`}>
          <PenLine size={13} aria-hidden />
          {t('libEditSong')}
        </button>
        <button type="button" onClick={onAdd} disabled={!canAdd || !hymn} title={addLabel} className={`${footerBtn} max-w-full border-accent bg-accent text-on-accent hover:brightness-110`}>
          <Plus size={13} aria-hidden className="shrink-0" />
          <span className="truncate">{addLabel}</span>
        </button>
      </div>
    </div>
  );
}
