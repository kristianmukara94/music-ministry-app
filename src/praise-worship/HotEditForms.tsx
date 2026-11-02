import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Scissors } from 'lucide-react';
import type { PwT } from './strings';
import { ADD_LABELS, labelFor, type AddLabel, type LiveHotEditor } from './useLiveHotEditor';
import type { Stanza } from '../lyrics/types';

export const SMALL_BTN = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-bold tracking-wide uppercase transition disabled:cursor-wait disabled:opacity-50';
const FIELD = 'w-full rounded-md border border-fg/15 bg-panel px-2 py-1.5 text-sm leading-snug text-fg outline-none focus:border-accent';

/** Ctrl or Cmd + Enter saves, Escape cancels, inside an edit box. */
export function editKeys(e: ReactKeyboardEvent, save: () => void, cancel: () => void) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    save();
  } else if (e.key === 'Escape' && !e.shiftKey) {
    e.preventDefault();
    // The edit box keeps its Escape: the Live panel's own Escape (closing the background panel) is not run as well.
    e.stopPropagation();
    cancel();
  }
}

/**
 * The box that changes one stanza's words. Ctrl + Enter saves, Escape cancels. With `onSplit`, Auto-split at midpoint cuts the stanza in two
 * that follow each other, for a stanza too long for one slide.
 */
export function StanzaEditBox({ t, hot, stanza, live, onSave, onSplit }: { t: PwT; hot: LiveHotEditor; stanza: Pick<Stanza, 'stanzaType'>; live: boolean; onSave: () => void; onSplit?: () => void }) {
  if (!hot.editing) return null;
  return (
    <div className={`flex flex-col gap-2 rounded-lg border p-3 ${live ? 'border-danger bg-danger/10' : 'border-accent/50 bg-panel'}`}>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-bold tracking-wider text-accent uppercase">{stanza.stanzaType}</span>
        {live && <span className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-extrabold text-white uppercase">{t('onAirBadge')}</span>}
        <span className="text-[11px] text-muted">{live ? t('editLiveNote') : t('editNote')}</span>
      </span>
      <textarea
        autoFocus
        rows={Math.max(3, hot.editing.text.split('\n').length)}
        value={hot.editing.text}
        aria-label={t('editWords', { name: stanza.stanzaType })}
        onChange={(e) => hot.changeEdit(e.target.value)}
        onKeyDown={(e) => editKeys(e, onSave, hot.cancel)}
        className={FIELD}
      />
      <div className="flex flex-wrap justify-end gap-2">
        {onSplit && (
          <button
            type="button"
            onClick={onSplit}
            disabled={hot.busy || !hot.canSplit}
            title={t('autoSplitTip', { name: stanza.stanzaType })}
            className={`${SMALL_BTN} mr-auto border-warn/60 text-warn hover:bg-warn/10`}
          >
            <Scissors size={13} aria-hidden />
            {t('autoSplit')}
          </button>
        )}
        <button type="button" onClick={hot.cancel} disabled={hot.busy} className={`${SMALL_BTN} border-fg/15 text-fg/70 hover:text-fg`}>
          {t('cancelEdit')}
        </button>
        <button type="button" onClick={onSave} disabled={hot.busy} className={`${SMALL_BTN} border-accent bg-accent text-on-accent hover:brightness-110`} title="Ctrl + Enter">
          {t('saveEdit')}
        </button>
      </div>
    </div>
  );
}

/** The box that adds a stanza: its section, its words, and Add or Add and show. Ctrl + Enter adds and shows, Escape cancels. */
export function StanzaAddBox({ t, hot, stanzas, where, onAdd }: { t: PwT; hot: LiveHotEditor; stanzas: Pick<Stanza, 'stanzaType'>[]; where: string; onAdd: (show: boolean) => void }) {
  if (!hot.adding) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/50 bg-accent/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('newSlide')}</span>
        <select
          aria-label={t('newSlideLabel')}
          value={hot.adding.label}
          onChange={(e) => hot.changeAdd({ label: e.target.value as AddLabel })}
          className="h-8 rounded-md border border-fg/15 bg-panel px-2 text-xs text-fg outline-none focus:border-accent"
        >
          {ADD_LABELS.map((label) => (
            <option key={label} value={label}>
              {labelFor(label, stanzas)}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">{where}</span>
      </div>
      <textarea
        autoFocus
        rows={4}
        value={hot.adding.text}
        aria-label={t('newSlideWords')}
        placeholder={t('newSlideWords')}
        onChange={(e) => hot.changeAdd({ text: e.target.value })}
        onKeyDown={(e) => editKeys(e, () => onAdd(true), hot.cancel)}
        className={FIELD}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={hot.cancel} disabled={hot.busy} className={`${SMALL_BTN} border-fg/15 text-fg/70 hover:text-fg`}>
          {t('cancelEdit')}
        </button>
        <button type="button" onClick={() => onAdd(false)} disabled={hot.busy} className={`${SMALL_BTN} border-accent/50 text-accent hover:bg-accent/10`}>
          {t('addOnly')}
        </button>
        <button type="button" onClick={() => onAdd(true)} disabled={hot.busy} className={`${SMALL_BTN} border-danger bg-danger text-white hover:brightness-110`} title="Ctrl + Enter">
          {t('addAndShow')}
        </button>
      </div>
    </div>
  );
}
