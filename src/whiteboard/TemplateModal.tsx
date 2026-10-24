import { useEffect, type ComponentType } from 'react';
import { BookOpen, FileText, Heart, Megaphone, Music, X, type LucideProps } from 'lucide-react';
import type { SLIDE_TEMPLATES } from '../../shared/whiteboard.js';

export type TemplateId = keyof typeof SLIDE_TEMPLATES;

const CHOICES: { id: TemplateId; label: string; hint: string; Icon: ComponentType<LucideProps> }[] = [
  { id: 'sermon', label: 'Sermon', hint: 'Classic sermon outline', Icon: FileText },
  { id: 'scripture', label: 'Scripture', hint: 'Featured Bible verse', Icon: BookOpen },
  { id: 'announcement', label: 'Announcement', hint: 'Event or news', Icon: Megaphone },
  { id: 'worship', label: 'Worship', hint: 'Worship song or hymn', Icon: Music },
  { id: 'prayer', label: 'Prayer Points', hint: 'Prayer list or requests', Icon: Heart },
];

/** Picks a starting point for a new slide. The choice pre-fills the title and outline, and the slide editor opens on it. */
export function TemplateModal({ onPick, onClose }: { onPick: (id: TemplateId) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Choose template" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-xl border border-stone-700 bg-stone-950 p-6 shadow-2xl">
        <header className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-black tracking-wide text-stone-100">Choose Template</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md border border-stone-700 text-stone-400 hover:text-stone-100">
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {CHOICES.map(({ id, label, hint, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              className="flex flex-col items-start gap-3 rounded-lg border border-stone-800 bg-stone-900/60 p-4 text-left transition-colors hover:border-amber-500/40 hover:bg-stone-900"
            >
              <span className="grid size-10 place-items-center rounded-md border border-amber-500/30 bg-stone-950 text-amber-300">
                <Icon size={18} aria-hidden />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-bold text-stone-100">{label}</span>
                <span className="text-xs text-stone-400">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
