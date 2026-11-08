import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import { dispatch, useLive } from '../live/store';
import { bridge } from '../live/bridge';
import { useNow } from './useNow';
import {
  ALERT_DURATIONS,
  ALERT_PRESETS,
  ALERT_TEXT_MAX,
  DEFAULT_ALERT_DURATION,
  alertExpired,
  cleanAlertText,
  formatPresetField,
  newAlertId,
  presetText,
  type AlertPreset,
  type AlertSeverity,
} from '../../shared/sanctuary-alert.js';

interface AlertModalState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** Whether the Sanctuary Alert dialog is open. Not saved. */
export const useSanctuaryAlertModal = create<AlertModalState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/**
 * Opens the dialog on Ctrl+Shift+A from any app window. The main process catches the key (electron/hotkeys.js), so it works even while the
 * projector or the mirror has focus. A second press inside the console closes it again.
 */
export function useSanctuaryAlertHotkey() {
  useEffect(
    () =>
      bridge.onSanctuaryAlertHotkey(({ toggle }) => {
        const { open, setOpen } = useSanctuaryAlertModal.getState();
        setOpen(toggle ? !open : true);
        // Already open and brought forward from another window: put the caret back in the field.
        if (!toggle || !open) requestAnimationFrame(() => document.getElementById(FIRST_FIELD_ID)?.focus());
      }),
    [],
  );
}

const FIRST_FIELD_ID = 'sanctuary-alert-field';

function durationLabel(d: number | null) {
  return d === null ? 'Until Dismissed' : `${d}s`;
}

/** The alert that is on the projector now, or null. A timed one that has run out counts as gone, even before its clear arrives. */
function useActiveAlert() {
  const alert = useLive((s) => s.state.sanctuaryAlert ?? null);
  const now = useNow().getTime();
  return alert && !alertExpired(alert, now) ? { alert, secondsLeft: alert.expiresAt === null ? null : Math.ceil((alert.expiresAt - now) / 1000) } : null;
}

/**
 * The operator's Sanctuary Alert dialog: a preset (car blocking the driveway, a nursery tag, an urgent booth call) or a custom notice, how
 * long it stays up, and the buttons to push it live or clear it. Enter pushes; Esc closes the dialog and leaves any live alert on screen.
 */
export function SanctuaryAlertModal() {
  const open = useSanctuaryAlertModal((s) => s.open);
  return open ? <AlertDialog /> : null;
}

function AlertDialog() {
  const setOpen = useSanctuaryAlertModal((s) => s.setOpen);
  const active = useActiveAlert();
  const [preset, setPreset] = useState<AlertPreset | null>(null);
  const [field, setField] = useState('');
  const [custom, setCustom] = useState('');
  const [duration, setDuration] = useState<number | null>(DEFAULT_ALERT_DURATION);
  const fieldRef = useRef<HTMLInputElement>(null);

  // A preset with a field types into that field; anything else types the custom notice.
  const usesField = Boolean(preset?.field);
  const text = cleanAlertText(usesField && preset ? presetText(preset.id, field) : custom);
  const severity: AlertSeverity = preset?.severity ?? 'warning';
  const close = () => setOpen(false);

  useEffect(() => {
    fieldRef.current?.focus();
  }, [preset]);

  const choose = (p: AlertPreset) => {
    setPreset(p);
    setDuration(p.durationSeconds);
    setField('');
    // A preset without a field (the booth call) fills the custom notice, which the operator can still edit.
    if (!p.field) setCustom(presetText(p.id, ''));
  };

  const push = () => {
    if (!text) return;
    dispatch({ type: 'sanctuaryAlert/show', value: { id: newAlertId(), text, severity, durationSeconds: duration }, now: Date.now() });
    // Back to the console, so the arrows and Space step the Mass again straight away.
    close();
  };

  const clearLive = () => {
    if (active) dispatch({ type: 'sanctuaryAlert/clear', id: active.alert.id });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter' && !e.shiftKey && !(e.target as HTMLElement).closest('button')) {
      e.preventDefault();
      push();
    }
  };

  const chip = (on: boolean) =>
    `rounded-md border px-3 py-1.5 text-xs font-bold transition-colors ${on ? 'border-[#f59e0b] bg-[#f59e0b]/15 text-[#f59e0b]' : 'border-line-strong text-fg hover:bg-panel-2'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sanctuary-alert-title"
        className="flex w-[600px] max-w-[calc(100vw-32px)] flex-col gap-4 rounded-xl border border-line-strong bg-panel p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="sanctuary-alert-title" className="text-lg font-extrabold tracking-tight">
            <span aria-hidden>⚠️ </span>Sanctuary Alert
          </h2>
          <span className="font-mono text-[11px] text-muted">Ctrl+Shift+A · Enter push · Esc close</span>
        </div>

        {active && (
          <div className="flex items-center gap-2 rounded-md border border-[#f59e0b]/50 bg-[#f59e0b]/10 px-3 py-2 text-sm" aria-live="polite">
            <span className="shrink-0 rounded bg-[#f59e0b] px-1.5 py-0.5 text-[10px] font-black tracking-wider text-black uppercase">On screen</span>
            <span className="min-w-0 flex-1 truncate">{active.alert.text}</span>
            <span className="shrink-0 font-mono text-xs text-muted">{active.secondsLeft === null ? 'until dismissed' : `${active.secondsLeft}s left`}</span>
          </div>
        )}

        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-[11px] font-bold tracking-wider text-muted uppercase">Hospitality presets</legend>
          {ALERT_PRESETS.map((p) => (
            <button key={p.id} type="button" className={chip(preset?.id === p.id)} aria-pressed={preset?.id === p.id} onClick={() => choose(p)}>
              <span aria-hidden>{p.icon} </span>
              {p.label}
            </button>
          ))}
          <button type="button" className={chip(preset === null)} aria-pressed={preset === null} onClick={() => setPreset(null)}>
            Custom notice
          </button>
        </fieldset>

        {usesField && preset?.field ? (
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            {preset.field.label}
            <input
              id={FIRST_FIELD_ID}
              ref={fieldRef}
              value={field}
              placeholder={preset.field.placeholder}
              onChange={(e) => setField(formatPresetField(preset.id, e.target.value))}
              className="rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-lg tracking-wider text-fg uppercase"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            <span className="flex justify-between">
              Notice
              <span className={custom.length >= ALERT_TEXT_MAX ? 'text-[#ef4444]' : ''}>
                {custom.length}/{ALERT_TEXT_MAX}
              </span>
            </span>
            <input
              id={FIRST_FIELD_ID}
              ref={fieldRef}
              value={custom}
              maxLength={ALERT_TEXT_MAX}
              placeholder="Type a short notice for the sanctuary screen"
              onChange={(e) => setCustom(e.target.value)}
              className="rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-fg"
              autoComplete="off"
            />
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold tracking-wider text-muted uppercase">Show for</span>
          {ALERT_DURATIONS.map((d) => (
            <button key={String(d)} type="button" className={chip(duration === d)} aria-pressed={duration === d} onClick={() => setDuration(d)}>
              {durationLabel(d)}
            </button>
          ))}
        </div>

        {/* What the congregation will read. */}
        <div className="rounded-md border-t-2 px-3 py-2 text-sm text-white" style={{ backgroundColor: 'rgba(17, 10, 14, 0.92)', borderColor: severity === 'urgent' ? '#ef4444' : '#f59e0b' }}>
          {text || <span className="text-white/40">The notice appears here.</span>}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={clearLive}
            disabled={!active}
            className="rounded-md border-2 border-[#ef4444] px-4 py-2 text-xs font-black tracking-wider text-[#ef4444] uppercase hover:bg-[#ef4444]/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear Active Alert
          </button>
          <button
            type="button"
            onClick={push}
            disabled={!text}
            className="rounded-md bg-[#f59e0b] px-4 py-2 text-xs font-black tracking-wider text-black uppercase shadow-[0_0_16px_#f59e0b80] hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            Push Alert Live
          </button>
        </div>
      </div>
    </div>
  );
}
