import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { MediaAsset } from './types';

export interface MediaMenuState {
  asset: MediaAsset;
  x: number;
  y: number;
}

export interface MediaMenuActions {
  onStage: (m: MediaAsset) => void;
  onTakeLive: (m: MediaAsset) => void;
  onDefaultMass: (m: MediaAsset) => void;
  onDefaultPraise: (m: MediaAsset) => void;
  onQueue: (m: MediaAsset) => void;
  onUnfile: (m: MediaAsset) => void;
  onRename: (m: MediaAsset) => void;
  onReveal: (m: MediaAsset) => void;
  onDelete: (m: MediaAsset) => void;
}

interface Item {
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
}

/**
 * Quick actions for one library item, opened by right-click or the card's … button. Actions that do not apply to the item's type are shown
 * disabled with the reason as a tooltip, so the menu always has the same shape. It closes on any click elsewhere, on Escape and on scroll.
 */
export function MediaContextMenu({ state, onClose, actions }: { state: MediaMenuState; onClose: () => void; actions: MediaMenuActions }) {
  const { asset: m } = state;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });

  // Kept on screen when opened near an edge: measured once it has its real size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(state.x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(state.y, window.innerHeight - height - 8)) });
  }, [state.x, state.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onClose);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      window.removeEventListener('pointerdown', onClose);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const isAudio = m.mediaType === 'audio';
  const notBackground = isAudio ? 'Audio cannot be a background.' : undefined;
  const groups: Item[][] = [
    [
      { label: 'Stage Background', hint: notBackground, disabled: isAudio, run: () => actions.onStage(m) },
      { label: 'Take Live', hint: notBackground, disabled: isAudio, run: () => actions.onTakeLive(m) },
    ],
    [
      {
        label: 'Set as Default for Holy Mass',
        hint: m.mediaType === 'image' ? 'Shown on the projector whenever nothing is live.' : 'Only a still image can be the Holy Mass default.',
        disabled: m.mediaType !== 'image',
        run: () => actions.onDefaultMass(m),
      },
      {
        label: 'Set as Default for Praise & Worship',
        hint: notBackground ?? 'The background behind the Praise & Worship Live set slides.',
        disabled: isAudio,
        run: () => actions.onDefaultPraise(m),
      },
      { label: 'Add to Holy Mass Queue', run: () => actions.onQueue(m) },
      ...(m.folderId !== null ? [{ label: 'Remove from Folder', run: () => actions.onUnfile(m) }] : []),
    ],
    [
      { label: 'Rename Asset', run: () => actions.onRename(m) },
      { label: 'Reveal in File Explorer', run: () => actions.onReveal(m) },
      { label: 'Delete Asset', danger: true, run: () => actions.onDelete(m) },
    ],
  ];

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={m.filename}
      style={pos}
      // A click inside the menu must not reach the window listener, which would close it before the item runs.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onMenuKey}
      className="fixed z-50 flex w-64 flex-col rounded-lg border border-fg/20 bg-surface p-1 shadow-2xl"
    >
      <div className="truncate px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase" title={m.filename}>
        {m.filename}
      </div>
      {groups.map((group, i) => (
        <div key={i} className={`flex flex-col gap-0.5 ${i > 0 ? 'mt-1 border-t border-line pt-1' : ''}`}>
          {group.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              title={item.hint}
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.run();
              }}
              className={`rounded-md px-3 py-1.5 text-left text-sm font-semibold transition outline-none disabled:cursor-not-allowed disabled:opacity-35 ${
                item.danger ? 'text-danger hover:bg-danger/10 focus:bg-danger/10' : 'text-fg/90 hover:bg-fg/10 focus:bg-fg/10'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
