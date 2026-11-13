import { useEffect, useState } from 'react';
import { Presentation, Type, X } from 'lucide-react';
import { decksOf, textSlidePages, type FlowRow, type MassFlowTarget, type PictureDeck } from '../../shared/flow-insert.js';
import { bridge } from '../live/bridge';
import { insertDeckIntoFlow } from '../planner/plan-api';
import { errorText } from '../whiteboard/errors';
import { MassSlotPicker } from '../whiteboard/TargetSlotSelectorModal';
import type { QueueItem } from '../../shared/live.js';
import type { GoLiveT } from './strings';

/** The Announcements folder that keeps the text slides typed in Go Live, so they can be found and shown again later. */
const TEXT_FOLDER = 'Go Live slides';
const MAX_TITLE = 80;

const TAB = (on: boolean) =>
  `inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-bold tracking-wide uppercase transition ${
    on ? 'border-accent bg-accent/15 text-accent' : 'border-fg/15 text-fg/70 hover:border-fg/30 hover:text-fg'
  }`;
const CHOICE = (on: boolean) =>
  `flex w-full min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
    on ? 'border-accent bg-accent/15 text-fg' : 'border-transparent text-fg/85 hover:border-fg/15 hover:bg-fg/[0.06]'
  }`;
const FIELD = 'w-full rounded-md border border-fg/20 bg-canvas px-3 py-2 text-sm text-fg placeholder:text-faint focus-visible:border-accent focus-visible:outline-none';
const BTN = 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10';
const PRIMARY =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-accent bg-accent px-4 text-sm font-bold text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Saves text pages as Announcements text slides in the Go Live folder (made the first time) and returns them as queue rows, in order,
 * each labelled with the title and its part.
 */
async function textRows(title: string, pages: string[]): Promise<FlowRow[]> {
  const api = bridge.announcements;
  const { folders } = await api.folders();
  const folder = folders.find((f) => f.name === TEXT_FOLDER) ?? (await api.createFolder(TEXT_FOLDER));
  const made = await api.createTextSlides(folder.id, pages, null, null);
  // The new slides are the folder's newest, by id.
  const slides = (await api.slides(folder.id)).filter((s) => s.slideType === 'text').sort((a, b) => a.id - b.id).slice(-made);
  return slides.map((s, i) => ({ module: 'announcements', sourceId: String(s.id), label: slides.length > 1 ? `${title} (${i + 1}/${slides.length})` : title }));
}

/**
 * Go Live's "Add slides": puts text slides typed here, or a PowerPoint deck from the Whiteboard, into the Mass while it runs. They go in next
 * (straight after the row on air) or after a Holy Mass slot. The projector is not touched: what is on air stays on air, and CURRENT moves
 * with its row when the new slides go in ahead of it.
 */
export function InFlowSlidePickerModal({ queue, cursor, t, onClose, onDone }: { queue: QueueItem[]; cursor: number; t: GoLiveT; onClose: () => void; onDone: (message: string) => void }) {
  const current = cursor >= 0 ? queue[cursor] : null;
  const [tab, setTab] = useState<'text' | 'powerpoint'>('text');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [decks, setDecks] = useState<PictureDeck[] | null>(null);
  const [deckKey, setDeckKey] = useState<string | null>(null);
  const [where, setWhere] = useState<'next' | 'slot'>(current ? 'next' : 'slot');
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  useEffect(() => {
    if (tab !== 'powerpoint' || decks) return;
    Promise.all([bridge.whiteboard.list(), bridge.whiteboard.folders()])
      .then(([slides, folders]) => setDecks(decksOf(slides.filter((s) => s.image), (id) => folders.find((f) => f.id === id)?.name ?? null)))
      .catch((err) => setError(errorText(err)));
  }, [tab, decks]);

  const pages = textSlidePages(body);
  const deck = decks?.find((d) => d.key === deckKey) ?? null;
  const target: MassFlowTarget | null = where === 'next' && current ? { kind: 'after', index: cursor } : where === 'slot' && slot ? { kind: 'slot', slot } : null;
  const ready = target != null && (tab === 'text' ? pages.length > 0 : deck != null);

  const add = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const name = title.trim().slice(0, MAX_TITLE) || pages[0].split('\n')[0].slice(0, MAX_TITLE);
      const payload = tab === 'text' ? await textRows(name, pages) : deck ? [deck] : [];
      const { added } = await insertDeckIntoFlow(payload, target);
      onDone(t('inflowAdded', { n: tab === 'text' ? t('inflowPages', { n: added }) : `"${deck?.title ?? ''}"` }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="inflow-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-xl flex-col gap-4 rounded-xl border border-fg/20 bg-surface p-6 shadow-2xl">
        <header className="flex items-center justify-between gap-4">
          <h2 id="inflow-title" className="text-lg font-bold tracking-tight text-fg">{t('inflowTitle')}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('inflowClose')} className="grid size-8 place-items-center rounded-md border border-fg/20 text-muted hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div role="tablist" className="flex gap-2">
          <button type="button" role="tab" aria-selected={tab === 'text'} onClick={() => setTab('text')} className={TAB(tab === 'text')}>
            <Type size={14} aria-hidden /> {t('inflowTabText')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'powerpoint'} onClick={() => setTab('powerpoint')} className={TAB(tab === 'powerpoint')}>
            <Presentation size={14} aria-hidden /> {t('inflowTabPowerPoint')}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {tab === 'text' ? (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-fg/70">
                {t('inflowTextTitle')}
                <input value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} className={FIELD} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-fg/70">
                {t('inflowTextBody')}
                <textarea value={body} rows={6} onChange={(e) => setBody(e.target.value)} className={`${FIELD} resize-y`} />
              </label>
              <p className="text-xs text-faint">
                {t('inflowTextHint')} {pages.length > 0 && <strong className="font-semibold text-fg/75">{t('inflowPages', { n: pages.length })}</strong>}
              </p>
            </div>
          ) : decks === null ? (
            <p className="text-sm text-muted">…</p>
          ) : decks.length === 0 ? (
            <p className="text-sm text-muted">{t('inflowNoDecks')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {decks.map((d) => (
                <li key={d.key}>
                  <button type="button" aria-pressed={deckKey === d.key} onClick={() => setDeckKey(d.key)} className={CHOICE(deckKey === d.key)}>
                    <Presentation size={15} className="shrink-0 text-accent" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-semibold">{d.title}</span>
                    <span className="shrink-0 font-mono text-[11px] text-faint">{t('inflowPages', { n: d.slideIds.length })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
            <legend className="mb-1 text-[11px] font-bold tracking-wider text-muted uppercase">{t('inflowWhere')}</legend>
            {current && (
              <button type="button" aria-pressed={where === 'next'} onClick={() => setWhere('next')} className={CHOICE(where === 'next')}>
                <span className="min-w-0 flex-1 truncate">{t('inflowAfterLive', { item: current.label })}</span>
              </button>
            )}
            <button type="button" aria-pressed={where === 'slot'} onClick={() => setWhere('slot')} className={CHOICE(where === 'slot')}>
              <span className="min-w-0 flex-1 truncate">{t('inflowInSlot')}</span>
            </button>
            {where === 'slot' && (
              <div className="pl-2">
                <MassSlotPicker value={slot} onChange={setSlot} />
              </div>
            )}
          </fieldset>
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <footer className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={BTN}>
            {t('inflowCancel')}
          </button>
          <button type="button" onClick={() => void add()} disabled={!ready || busy} className={PRIMARY}>
            {busy ? t('inflowAdding') : t('inflowAdd')}
          </button>
        </footer>
      </div>
    </div>
  );
}
