import { X } from 'lucide-react';
import { useLyT } from './strings';
import { SongCategoriesEditor } from './SongCategoriesEditor';

/** The operator's list of song categories for the Mass, in a dialog over the library. The list itself is the shared editor. */
export function SongCategoriesModal({ onClose }: { onClose: () => void }) {
  const t = useLyT();

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" role="dialog" aria-modal="true" aria-label={t('songCategoriesTitle')}>
      <div className="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-fg/15 bg-panel">
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-2xl font-bold tracking-tight">{t('songCategoriesTitle')}</h2>
          <button type="button" onClick={onClose} aria-label={t('close')} className="text-muted hover:text-fg">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto p-6">
          <SongCategoriesEditor />
        </div>
      </div>
    </div>
  );
}
