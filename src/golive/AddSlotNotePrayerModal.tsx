import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, MonitorPlay, PanelBottom, X } from 'lucide-react';
import {
  categoriesForType,
  dividedNote,
  dividedText,
  MAX_NOTE_BODY,
  MAX_NOTE_TITLE,
  noteCategoryLabel,
  OPERATOR_CATEGORIES,
  typeOfNote,
  type NoteType,
} from '../../shared/notes.js';
import { isSlotId, slotById } from '../../shared/mass-slots.js';
import { screenPagesOf } from '../../shared/prayer-screen.js';
import type { FlowRow, MassFlowTarget } from '../../shared/flow-insert.js';
import type { QueueItem } from '../../shared/live.js';
import type { GoLiveKey } from '../../shared/golive-i18n.js';
import { bridge } from '../live/bridge';
import { insertDeckIntoFlow } from '../planner/plan-api';
import { MassSlotPicker } from '../whiteboard/TargetSlotSelectorModal';
import { errorText } from '../whiteboard/errors';
import type { Note, NoteDisplay } from '../notes/types';
import type { GoLiveT } from './strings';

type Where = 'slot' | 'next' | 'none';
type Projected = Exclude<NoteDisplay, 'operator'>;

/** The four kinds of entry, each with its own colour so the choice reads at a glance in a dark booth. */
const TYPES: { id: NoteType; icon: string; label: GoLiveKey; hint: GoLiveKey; example: GoLiveKey; tone: string }[] = [
  { id: 'prayer', icon: '🙏', label: 'noteTypePrayer', hint: 'noteTypePrayerHint', example: 'noteTitlePrayerExample', tone: 'border-amber-500/70 bg-amber-500/15' },
  { id: 'massFlow', icon: '✝️', label: 'noteTypeMassFlow', hint: 'noteTypeMassFlowHint', example: 'noteTitleMassFlowExample', tone: 'border-violet-500/70 bg-violet-500/15' },
  { id: 'announcement', icon: '📢', label: 'noteTypeAnnouncement', hint: 'noteTypeAnnouncementHint', example: 'noteTitleAnnouncementExample', tone: 'border-sky-500/70 bg-sky-500/15' },
  { id: 'operator', icon: '📝', label: 'noteTypeOperator', hint: 'noteTypeOperatorHint', example: 'noteTitleOperatorExample', tone: 'border-cyan-500/70 bg-cyan-500/15' },
];

const TYPE_BUTTON = (on: boolean, tone: string) =>
  `flex min-w-0 flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition ${on ? tone : 'border-fg/15 hover:border-fg/30 hover:bg-fg/[0.04]'}`;
const CHOICE = (on: boolean) =>
  `flex w-full min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
    on ? 'border-accent bg-accent/15 text-fg' : 'border-transparent text-fg/85 hover:border-fg/15 hover:bg-fg/[0.06]'
  }`;
const DISPLAY_BUTTON = (on: boolean) =>
  `flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
    on ? 'border-accent bg-accent/15 text-fg' : 'border-fg/15 text-fg/80 hover:border-fg/30 hover:bg-fg/[0.04]'
  }`;
const FIELD = 'w-full rounded-md border border-fg/20 bg-canvas px-3 py-2 text-sm text-fg placeholder:text-fg/40 focus-visible:border-accent focus-visible:outline-none';
const BTN = 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10 disabled:opacity-40';
const PRIMARY =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#ecc98a] bg-[#ecc98a] px-4 text-sm font-bold text-[#1a1408] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * The Holy Mass slot the row at `index` belongs to: its own slot, or, for a row put in after a slot, the slot above it in the same block.
 * Null when there is none (nothing on air, or a plan without slots).
 */
export function slotOfRow(queue: QueueItem[], index: number): string | null {
  for (let i = index; i >= 0 && i < queue.length; i -= 1) {
    if (isSlotId(queue[i].slot)) return queue[i].block === queue[index].block ? queue[i].slot! : null;
  }
  return null;
}

/**
 * The creation engine of the Liturgical Content Hub: every prayer, Mass flow text, announcement and private operator note is written here and
 * saved to the one notes table, so it shows at once in the Hub, the Liturgical Plan's library and Go Live (every window hears notes:changed).
 *
 * Fields: Type (Liturgical Prayer, Mass Flow Sequence, Parish Announcement, Operator Note), Category tag, Title, Content (a `---` line starts a
 * new slide) and, for a projectable entry, its default display mode (full-screen slide or lower-third banner). The projector is not touched.
 *
 * Two uses:
 * - The Hub passes `placement={false}`, and `note` to edit an existing entry. Nothing is put into a Mass.
 * - Go Live passes its queue: the saved entry is put into the Mass at a slot, straight after the row on air, or nowhere. `slot` pre-selects a
 *   slot (from a slot card's +); without it the slot of the row on air is chosen, or "next" when that row has no slot.
 */
export function AddSlotNotePrayerModal({
  queue = [],
  cursor = -1,
  slot: presetSlot,
  note = null,
  defaultType = 'prayer',
  placement = true,
  t,
  insert = insertDeckIntoFlow,
  onClose,
  onDone,
}: {
  queue?: QueueItem[];
  cursor?: number;
  slot?: string | null;
  /** An entry to edit. Left out, a new one is made. */
  note?: Note | null;
  /** The type a new entry starts on (the Hub passes the type of the section it is showing). */
  defaultType?: NoteType;
  /** False hides "where in the Mass": the entry is only saved. */
  placement?: boolean;
  t: GoLiveT;
  insert?: (rows: FlowRow[], target: MassFlowTarget) => Promise<unknown>;
  onClose: () => void;
  onDone: (message: string, saved: Note) => void;
}) {
  const current = placement && cursor >= 0 ? queue[cursor] : null;
  const activeSlot = presetSlot ?? (current ? slotOfRow(queue, cursor) : null);
  const startType: NoteType = note ? typeOfNote(note) : defaultType;
  const [type, setType] = useState<NoteType>(startType);
  const [category, setCategory] = useState<string>(note?.category ?? categoriesForType(startType)[0]);
  const [title, setTitle] = useState(note?.title ?? '');
  // An edited note shows its manual slide breaks as `---` lines, so they are changed the way they were typed.
  const initialText = useMemo(() => (note ? (note.display === 'operator' ? note.body : dividedText(note.body, note.split)) : ''), [note]);
  const [text, setText] = useState(initialText);
  const [projectedAs, setProjectedAs] = useState<Projected>(note && note.display !== 'operator' ? note.display : 'full');
  const [where, setWhere] = useState<Where>(!placement ? 'none' : presetSlot || !current ? 'slot' : activeSlot ? 'slot' : 'next');
  const [slot, setSlot] = useState<string | null>(activeSlot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const operator = type === 'operator';
  const display: NoteDisplay = operator ? 'operator' : projectedAs;
  const categories = categoriesForType(type);

  const pickType = (next: NoteType) => {
    setType(next);
    // The category is kept when the new type offers it (an operator note offers every category), otherwise the type's first is chosen.
    setCategory((c) => (categoriesForType(next).includes(c) ? c : categoriesForType(next)[0]));
  };

  // An operator note keeps its text as typed: `---` only means a slide break for an entry that is projected.
  const parts = useMemo(() => (operator ? { body: text.trim(), split: null } : dividedNote(text)), [operator, text]);
  const slideCount = useMemo(
    () => (display === 'full' && parts.body.trim() ? screenPagesOf({ title: title.trim() || ' ', body: parts.body, style: null, split: parts.split }).length : 0),
    [display, parts, title],
  );
  const target: MassFlowTarget | null = where === 'next' && current ? { kind: 'after', index: cursor } : where === 'slot' && slot ? { kind: 'slot', slot } : null;
  const tooLong = parts.body.length > MAX_NOTE_BODY;
  const ready = title.trim().length > 0 && (operator || parts.body.trim().length > 0) && !tooLong && (where === 'none' || target != null);
  // The slot the entry is labelled with in the Hub: the one picked, or the slot of the row it goes after. An edit keeps the slot it has.
  const noteSlot = where === 'slot' ? slot : where === 'next' && current ? slotOfRow(queue, cursor) : null;
  const changed =
    title !== (note?.title ?? '') || text !== initialText || category !== (note?.category ?? categoriesForType(startType)[0]) || type !== startType || (!operator && note != null && projectedAs !== note.display);

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    // Text left as it was keeps the note's own split (an automatic split, or one made in the Hub's slide-break list), not one rebuilt from the text.
    const keep = note != null && text === initialText;
    const body = keep ? note.body : parts.body;
    const split = keep && !operator ? note.split : operator ? null : parts.split;
    let saved: Note;
    try {
      saved = await bridge.notes.save({
        id: note?.id,
        title: title.trim(),
        category,
        body,
        display,
        style: note?.style ?? null,
        split,
        // An edit from the Hub says no slot, so the note keeps the one it was written for.
        ...(placement ? { slot: noteSlot } : {}),
      });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      return;
    }
    if (!target || where === 'none') {
      onDone(t('noteSavedOnly', { title: saved.title }), saved);
      return;
    }
    try {
      await insert([{ module: 'notes', sourceId: String(saved.id), label: saved.title }], target);
      onDone(t('noteAdded', { title: saved.title }), saved);
    } catch (err) {
      // The entry is kept: it is in the Hub, and can be put into the Mass from there.
      onDone(t('noteSavedNotAdded', { title: saved.title, error: errorText(err) }), saved);
    }
  };

  // Esc closes (asking first when something was typed), and Ctrl+Enter saves from anywhere in the form. The latest values are read from a ref,
  // so the listener is added once.
  const keys = useRef({ save, close: () => {} });
  const close = () => {
    if (busy) return;
    if (!changed || window.confirm(t('noteDiscard'))) onClose();
  };
  keys.current = { save, close };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        keys.current.close();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void keys.current.save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const presetName = slotById(presetSlot)?.name;
  const typeInfo = TYPES.find((x) => x.id === type)!;
  const operatorOnly = categories.filter((c) => OPERATOR_CATEGORIES.includes(c));
  const sharedCategories = categories.filter((c) => !OPERATOR_CATEGORIES.includes(c));

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="note-modal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={close}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-2xl flex-col gap-4 rounded-xl border border-fg/20 bg-panel p-6 shadow-2xl">
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="note-modal-title" className="text-lg font-bold tracking-tight text-fg">{t(note ? 'noteEditTitle' : 'noteModalTitle')}</h2>
            <p className="truncate text-xs text-fg/60">{presetName ?? t('noteModalSubtitle')}</p>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label={t('inflowClose')} className="grid size-8 shrink-0 place-items-center rounded-md border border-fg/20 text-fg/60 hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[11px] font-bold tracking-wider text-fg/60 uppercase">{t('noteType')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {TYPES.map((x) => (
                <button key={x.id} type="button" aria-pressed={type === x.id} onClick={() => pickType(x.id)} className={TYPE_BUTTON(type === x.id, x.tone)}>
                  <span className="truncate text-sm font-bold text-fg">
                    <span aria-hidden>{x.icon} </span>
                    {t(x.label)}
                  </span>
                  <span className="truncate text-[11px] text-fg/60">{t(x.hint)}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
            <label className="flex flex-col gap-1 text-xs font-semibold text-fg/70">
              {t('noteTitle')}
              <input value={title} autoFocus maxLength={MAX_NOTE_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder={t(typeInfo.example)} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-fg/70">
              {t('noteCategory')}
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD}>
                {operator ? (
                  <>
                    <optgroup label={t('noteTypeOperator')}>
                      {operatorOnly.map((c) => (
                        <option key={c} value={c}>{noteCategoryLabel(c)}</option>
                      ))}
                    </optgroup>
                    <optgroup label="—">
                      {sharedCategories.map((c) => (
                        <option key={c} value={c}>{noteCategoryLabel(c)}</option>
                      ))}
                    </optgroup>
                  </>
                ) : (
                  categories.map((c) => (
                    <option key={c} value={c}>{noteCategoryLabel(c)}</option>
                  ))
                )}
                {/* A category saved before it moved to another type is still offered, so an edit never changes it by accident. */}
                {!categories.includes(category) && <option value={category}>{noteCategoryLabel(category)}</option>}
              </select>
            </label>
          </div>

          {!operator && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[11px] font-bold tracking-wider text-fg/60 uppercase">{t('noteDisplay')}</legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['full', MonitorPlay, 'noteDisplayFull', 'noteDisplayFullHint'],
                    ['lower', PanelBottom, 'noteDisplayLower', 'noteDisplayLowerHint'],
                  ] as const
                ).map(([id, Icon, label, hint]) => (
                  <button key={id} type="button" aria-pressed={projectedAs === id} onClick={() => setProjectedAs(id)} className={DISPLAY_BUTTON(projectedAs === id)}>
                    <Icon size={16} aria-hidden className="shrink-0 text-accent" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold">{t(label)}</span>
                      <span className="truncate text-[11px] text-fg/60">{t(hint)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <label className="flex flex-col gap-1 text-xs font-semibold text-fg/70">
            {t('noteBody')}
            <textarea value={text} rows={9} onChange={(e) => setText(e.target.value)} className={`${FIELD} resize-y font-mono text-[13px] leading-relaxed`} />
          </label>
          <p className={`-mt-2 flex flex-wrap items-center gap-x-2 text-xs ${tooLong ? 'text-danger' : 'text-fg/55'}`}>
            {operator ? (
              <span className="flex items-center gap-1.5">
                <Lock size={12} aria-hidden /> {t('noteBodyOperatorHint')}
              </span>
            ) : display === 'lower' ? (
              t('noteBodyLowerHint')
            ) : (
              <>
                {t('noteBodyHint')}
                {slideCount > 0 && <strong className="font-semibold text-fg/75">{slideCount === 1 ? t('noteOneSlide') : t('inflowPages', { n: slideCount })}</strong>}
              </>
            )}
            {tooLong && <span>({parts.body.length} / {MAX_NOTE_BODY})</span>}
          </p>

          {placement && (
            <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
              <legend className="mb-1 text-[11px] font-bold tracking-wider text-fg/60 uppercase">{t('inflowWhere')}</legend>
              <button type="button" aria-pressed={where === 'slot'} onClick={() => setWhere('slot')} className={CHOICE(where === 'slot')}>
                <span className="min-w-0 flex-1 truncate">
                  {t('noteInSlot')}
                  {where === 'slot' && slot && <strong className="font-semibold"> · {slotById(slot)?.position}. {slotById(slot)?.name}</strong>}
                </span>
              </button>
              {where === 'slot' && (
                <div className="max-h-64 overflow-y-auto pl-2">
                  <MassSlotPicker value={slot} onChange={setSlot} />
                </div>
              )}
              {current && (
                <button type="button" aria-pressed={where === 'next'} onClick={() => setWhere('next')} className={CHOICE(where === 'next')}>
                  <span className="min-w-0 flex-1 truncate">{t('inflowAfterLive', { item: current.label })}</span>
                </button>
              )}
              <button type="button" aria-pressed={where === 'none'} onClick={() => setWhere('none')} className={CHOICE(where === 'none')}>
                <span className="min-w-0 flex-1 truncate">{t('noteDetached')}</span>
              </button>
            </fieldset>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <footer className="flex items-center justify-end gap-2">
          <span className="mr-auto hidden text-xs text-fg/50 sm:inline">{t('noteKeys')}</span>
          <button type="button" onClick={close} disabled={busy} className={BTN}>
            {t('inflowCancel')}
          </button>
          <button type="button" onClick={() => void save()} disabled={!ready || busy} className={PRIMARY}>
            {busy ? t('noteSaving') : note ? t('noteSaveChanges') : where === 'none' ? t('noteSaveOnly') : t('noteSaveAndAdd')}
          </button>
        </footer>
      </div>
    </div>
  );
}
