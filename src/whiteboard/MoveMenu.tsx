import { useEffect, useRef } from 'react';
import { Check, Folder, Inbox } from 'lucide-react';
import type { WhiteboardFolder } from './types';

/**
 * The list of folders slides can move to, plus Unfiled. Closes on Escape or a click outside.
 * `current` is the folder the slides are already in: it is marked and cannot be chosen. Leave it out when they are in different folders.
 */
export function MoveMenu({
  folders,
  current,
  title = 'Move to folder',
  className = 'top-11 right-2',
  onPick,
  onClose,
}: {
  folders: WhiteboardFolder[];
  current?: number | null;
  title?: string;
  /** Where the menu sits in its positioned parent. */
  className?: string;
  onPick: (folderId: number | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const item = (label: string, id: number | null, icon: typeof Folder) => {
    const Icon = icon;
    const here = current !== undefined && id === current;
    return (
      <button
        key={id ?? 'unfiled'}
        type="button"
        role="menuitem"
        disabled={here}
        onClick={() => onPick(id)}
        className="flex min-h-9 w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-fg/90 transition hover:bg-fg/10 focus-visible:bg-fg/10 focus-visible:outline-none disabled:cursor-default disabled:text-fg/45 disabled:hover:bg-transparent"
      >
        <Icon size={14} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {here && <Check size={14} className="shrink-0 text-accent" aria-label="Current folder" />}
      </button>
    );
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      className={`absolute z-30 flex max-h-64 w-56 flex-col gap-0.5 overflow-y-auto rounded-lg border border-fg/20 bg-panel p-1.5 shadow-xl shadow-black/50 ${className}`}
    >
      <p className="px-2.5 pt-1 pb-1.5 text-[10px] font-bold tracking-wider text-fg/50 uppercase">{title}</p>
      {folders.map((f) => item(f.name, f.id, Folder))}
      {item('Unfiled', null, Inbox)}
    </div>
  );
}
