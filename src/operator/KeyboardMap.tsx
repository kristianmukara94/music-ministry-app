import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useT, type StringKey } from '../i18n/strings';
import { useLive } from '../live/store';
import { setUi, useUi } from '../state/ui';
import { DEFAULT_SHORTCUTS, comboOf, displayCombo, findConflict, isReserved, type Shortcut } from '../../shared/shortcuts.js';
import { Panel } from './Panel';
import { SHORTCUT_ACTIONS, actionById } from './shortcuts';

/** The four original actions have translated names. The others show their English name. */
const TRANSLATED: Record<string, StringKey> = {
  announcements: 'keys.announcements',
  welcome: 'keys.welcome',
  blackout: 'keys.blackout',
  clear: 'keys.clear',
};

const KEYCAP = 'min-w-[52px] shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-center font-mono text-xs font-bold shadow-md shadow-black/30 transition';
const KEYCAP_TONE = {
  idle: 'border-fg/[0.15] bg-panel-2 text-fg hover:border-fg/35',
  /** The thing this shortcut puts on air is showing now. */
  active: 'border-accent bg-accent text-on-accent shadow-[0_0_12px_color-mix(in_oklab,var(--color-accent)_40%,transparent)]',
  /** Waiting for the operator to press the new key. */
  rebinding: 'animate-pulse border-accent bg-accent/20 text-accent',
};

export function KeyboardMap() {
  const t = useT();
  const shortcuts = useUi((s) => s.shortcuts);
  const live = useLive((s) => s.state);
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const nameOf = (s: Shortcut) => (TRANSLATED[s.actionId] ? t(TRANSLATED[s.actionId]) : (actionById(s.actionId)?.label ?? s.label));
  const save = (next: Shortcut[]) => setUi({ shortcuts: next });
  const stopCapture = () => {
    // A shortcut that was just added and never given a key is dropped, not left behind as an empty row.
    const open = useUi.getState().shortcuts.find((s) => s.id === capturingId);
    if (open && open.key === '') save(useUi.getState().shortcuts.filter((s) => s.id !== open.id));
    setNotice(null);
    setCapturingId(null);
  };

  // While a shortcut waits for its key, every key press goes to it and the global hotkeys stand down.
  useEffect(() => {
    if (!capturingId) return;
    setUi({ capturingHotkey: true });

    const onKey = (e: KeyboardEvent) => {
      // Keep the key from doing what it normally does (F5 reloading, Space scrolling, Ctrl+W closing).
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        stopCapture();
        return;
      }
      const combo = comboOf(e);
      if (!combo) return; // a modifier on its own: wait for the key it modifies
      if (isReserved(combo)) {
        setNotice(`${displayCombo(combo)} ${t('keys.reserved')}`);
        return;
      }
      const current = useUi.getState().shortcuts;
      const clash = findConflict(current, combo, capturingId);
      if (clash) {
        setNotice(`${displayCombo(combo)} ${t('keys.inUse')} ${nameOf(clash)}.`);
        return;
      }
      save(current.map((s) => (s.id === capturingId ? { ...s, key: combo } : s)));
      setNotice(null);
      setCapturingId(null);
    };
    // Clicking anywhere else, or leaving the window, ends the capture so the hotkeys cannot stay switched off by accident.
    const onPointer = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('[data-rebinding]')) stopCapture();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('mousedown', onPointer, { capture: true });
    window.addEventListener('blur', stopCapture);
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('mousedown', onPointer, { capture: true });
      window.removeEventListener('blur', stopCapture);
      setUi({ capturingHotkey: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturingId]);

  const remove = (id: string) => {
    if (capturingId === id) setCapturingId(null);
    save(shortcuts.filter((s) => s.id !== id));
  };

  const unassigned = SHORTCUT_ACTIONS.filter((a) => !shortcuts.some((s) => s.actionId === a.id));
  const add = (actionId: string) => {
    const action = actionById(actionId);
    if (!action) return;
    const created: Shortcut = { id: crypto.randomUUID(), key: '', label: action.label, actionId };
    save([...shortcuts, created]);
    setAdding(false);
    setCapturingId(created.id); // straight into "Press key…"
  };

  const isDefault =
    shortcuts.length === DEFAULT_SHORTCUTS.length && DEFAULT_SHORTCUTS.every((d) => shortcuts.some((s) => s.actionId === d.actionId && s.key === d.key));
  const restore = () => {
    if (!window.confirm(t('keys.restore') + '?')) return;
    setCapturingId(null);
    save(DEFAULT_SHORTCUTS.map((s) => ({ ...s })));
  };

  let body;
  if (adding) {
    body = (
      <div className="flex flex-col gap-1.5 p-3">
        <div className="px-1 pb-1 text-xs font-semibold text-fg/60">{t('keys.pickAction')}</div>
        {unassigned.length === 0 ? (
          <p className="px-1 py-3 text-sm text-fg/60">{t('keys.allAssigned')}</p>
        ) : (
          unassigned.map((a) => (
            <button key={a.id} type="button" onClick={() => add(a.id)}
              className="flex flex-col rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2 text-left transition hover:border-accent/50 hover:bg-fg/[0.07]">
              <span className="text-sm font-medium text-fg">{a.label}</span>
              <span className="text-xs text-fg/50">{a.description}</span>
            </button>
          ))
        )}
      </div>
    );
  } else if (shortcuts.length === 0) {
    body = <p className="px-4 py-6 text-center text-sm text-fg/60">{t('keys.empty')}</p>;
  } else {
    body = (
      <ul className="flex flex-col gap-2 p-3">
        {shortcuts.map((s) => {
          const action = actionById(s.actionId);
          const rebinding = capturingId === s.id;
          const active = !rebinding && s.key !== '' && Boolean(action?.isActive?.(live));
          return (
            <li key={s.id} className="group flex items-center gap-3 rounded-lg border border-fg/10 bg-fg/[0.03] px-3 py-2">
              <button type="button" onClick={() => { setNotice(null); setCapturingId(s.id); }} title="Reassign"
                data-rebinding={rebinding ? '' : undefined}
                className={`${KEYCAP} ${rebinding ? KEYCAP_TONE.rebinding : active ? KEYCAP_TONE.active : KEYCAP_TONE.idle}`}>
                {rebinding ? t('keys.press') : s.key ? displayCombo(s.key) : t('keys.unassigned')}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-fg">{nameOf(s)}</div>
                <div className="truncate text-xs text-fg/50">{s.description ?? action?.description}</div>
              </div>
              {active && (
                <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold tracking-wider text-ok uppercase">
                  <span className="size-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
                  {t('keys.live')}
                </span>
              )}
              <button type="button" onClick={() => remove(s.id)} aria-label={`${t('keys.remove')}: ${nameOf(s)}`} title={t('keys.remove')}
                className="shrink-0 rounded-md p-1 text-fg/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger focus-visible:opacity-100">
                <Trash2 size={16} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Panel
      eyebrow={t('keys.eyebrow')}
      title={t('keys.title')}
      action={
        <button type="button" onClick={() => { stopCapture(); setAdding((a) => !a); }}
          className="shrink-0 rounded-md border border-accent/30 bg-fg/5 px-2.5 py-1 text-xs text-accent transition hover:bg-fg/10">
          {adding ? t('keys.cancel') : t('keys.add')}
        </button>
      }
    >
      {body}
      <div className="flex flex-col gap-1 px-4 pb-3">
        {notice && <p role="alert" className="text-xs font-medium text-danger">{notice}</p>}
        <p className="text-xs leading-normal font-normal text-fg/60">{t('keys.hint')}</p>
        {!isDefault && !adding && (
          <button type="button" onClick={restore} className="self-start text-xs text-fg/60 underline underline-offset-2 hover:text-accent">{t('keys.restore')}</button>
        )}
      </div>
    </Panel>
  );
}
