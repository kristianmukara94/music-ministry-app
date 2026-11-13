import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { WhiteboardDesign } from '../../shared/whiteboard.js';
import { SlideCanvas } from './SlideCanvas';
import { CHIP, CHIP_OFF, SlideForm } from './SlideForm';
import type { WhiteboardSlideInput } from './types';

/**
 * The slide customizer. Content and every part of the design are edited on the left; the live preview on the right
 * shows the slide as it will look. Nothing is saved until Create slide.
 */
export function SlideEditorModal({ initial, onSave, onClose, onUseTemplate, mode }: {
  initial: WhiteboardSlideInput;
  onSave: (input: WhiteboardSlideInput) => Promise<void>;
  onClose: () => void;
  onUseTemplate: () => void;
  mode: 'create' | 'edit';
}) {
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [design, setDesign] = useState<WhiteboardDesign>(initial.design);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patchDesign = (patch: Partial<WhiteboardDesign>) => setDesign((d) => ({ ...d, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!title.trim()) {
      setError('A slide needs a title.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({ id: initial.id, title, content, design });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const preview = { title: title || 'Sermon Title', content: content.trim() ? content : 'Add content to see preview...', design };

  return (
    <div role="dialog" aria-modal="true" aria-label={mode === 'create' ? 'Create new slide' : 'Edit slide'} className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-fg/20 bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <div className="text-[11px] font-bold tracking-[0.2em] text-faint uppercase">Slide</div>
            <h2 className="mt-0.5 text-lg font-bold tracking-tight text-fg">{mode === 'create' ? 'Create new slide' : 'Edit slide'}</h2>
            <p className="text-xs text-muted">Customize your presentation slide</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md border border-fg/20 text-muted hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <SlideForm title={title} content={content} design={design} onTitle={setTitle} onContent={setContent} onDesign={patchDesign} />

          <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0 lg:self-start">
            <div className="text-[11px] font-bold tracking-widest text-muted uppercase">Live preview</div>
            <div className="aspect-video w-full overflow-hidden rounded-xl border-[3px] border-accent shadow-xl">
              <SlideCanvas slide={preview} className="h-full w-full" />
            </div>
            <p className="text-xs text-faint">The slide updates as you change it. Double-clicking it in the library projects it.</p>
          </div>
        </div>

        {error && <div role="alert" className="border-t border-danger/40 bg-danger/10 px-6 py-2 text-sm text-danger">{error}</div>}

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={onUseTemplate} className={`${CHIP} ${CHIP_OFF}`}>
            Use template
          </button>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} className={`${CHIP} ${CHIP_OFF}`}>
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-xs font-bold tracking-wider text-on-accent uppercase shadow-md shadow-black/40 transition-all hover:brightness-110 disabled:opacity-40">
              {mode === 'create' ? 'Create slide' : 'Save changes'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
