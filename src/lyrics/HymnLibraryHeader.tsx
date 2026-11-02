import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, FileUp, FolderTree, Music, PenLine, Plus } from 'lucide-react';
import type { AddSongTab } from './AddSongModal';
import type { LyT } from './strings';

export type LibraryTab = 'library' | 'categories';

/** One way to add a song, in the Add song menu. */
function MenuItem({ icon, label, hint, onSelect, itemRef }: { icon: ReactNode; label: string; hint: string; onSelect: () => void; itemRef?: (el: HTMLButtonElement | null) => void }) {
  return (
    <button
      ref={itemRef}
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none"
    >
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold text-fg">{label}</span>
        <span className="text-xs text-fg/60">{hint}</span>
      </span>
    </button>
  );
}

/**
 * The top of the Hymn Library: what the panel shows (the songs, or the song categories) on the left, and one way to add songs on the right.
 * "Add song" opens the song form; its arrow opens a menu with the two ways to add: type the lyrics, or import a Word or text file of many
 * songs. The menu works from the keyboard: arrows move, Enter chooses, Escape closes it.
 */
export function HymnLibraryHeader({
  tab,
  onTab,
  count,
  onAdd,
  t,
}: {
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  /** How many songs the list shows, beside the Library tab. */
  count: number;
  onAdd: (how: AddSongTab) => void;
  t: LyT;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    requestAnimationFrame(() => items.current[0]?.focus());
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const choose = (how: AddSongTab) => {
    setMenuOpen(false);
    onAdd(how);
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    const list = items.current.filter(Boolean) as HTMLButtonElement[];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
      list[next]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setMenuOpen(false);
      caret.current?.focus();
    } else if (e.key === 'Tab') {
      setMenuOpen(false);
    }
  };

  const tabs: { id: LibraryTab; label: string; icon: ReactNode }[] = [
    { id: 'library', label: t('tabLibrary'), icon: <Music size={14} aria-hidden /> },
    { id: 'categories', label: t('tabCategories'), icon: <FolderTree size={14} aria-hidden /> },
  ];

  return (
    <div className="flex items-center justify-between gap-3">
      <div role="tablist" aria-label={t('libraryTitle')} className="inline-flex min-w-0 rounded-lg border border-fg/15 bg-panel-2 p-0.5">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            title={x.id === 'library' ? `${x.label} (${count})` : x.label}
            onClick={() => onTab(x.id)}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-bold whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
              tab === x.id ? 'bg-canvas text-accent shadow-sm ring-1 ring-accent/40' : 'text-fg/65 hover:text-fg'
            }`}
          >
            {x.icon}
            {x.label}
          </button>
        ))}
      </div>

      <div ref={wrap} className="relative flex shrink-0">
        <button
          type="button"
          onClick={() => onAdd('type')}
          className="flex h-9 items-center gap-1.5 rounded-l-md border border-accent bg-accent pr-2.5 pl-3 text-xs font-extrabold tracking-wide whitespace-nowrap text-on-accent uppercase transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden /> {t('addSong')}
        </button>
        <button
          ref={caret}
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t('addSongMore')}
          title={t('addSongMore')}
          className="grid h-9 w-8 place-items-center rounded-r-md border border-l-0 border-accent bg-accent text-on-accent transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          style={{ boxShadow: 'inset 1px 0 0 rgb(0 0 0 / 0.18)' }}
        >
          <ChevronDown size={15} strokeWidth={2.5} className={`transition ${menuOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {menuOpen && (
          <div role="menu" aria-label={t('addSong')} onKeyDown={onMenuKey} className="absolute top-full right-0 z-30 mt-1.5 w-72 rounded-lg border border-fg/15 bg-panel p-1.5 shadow-2xl shadow-black/60">
            <MenuItem icon={<PenLine size={16} aria-hidden />} label={t('composeOption')} hint={t('composeOptionHint')} onSelect={() => choose('type')} itemRef={(el) => (items.current[0] = el)} />
            <MenuItem icon={<FileUp size={16} aria-hidden />} label={t('importOption')} hint={t('importOptionHint')} onSelect={() => choose('import')} itemRef={(el) => (items.current[1] = el)} />
          </div>
        )}
      </div>
    </div>
  );
}
