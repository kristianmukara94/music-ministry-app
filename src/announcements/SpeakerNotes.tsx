import type { Frame } from '../../shared/live.js';
import type { AnnT } from './strings';
import { SlidePreview } from './TextSlideModal';
import { getSlideImageUrl, onSlideImageError } from '../output/slideImage';

/**
 * Operator-only panel beside the staged slide: a preview of the slide and its speaker notes, large enough to read
 * from the lectern. The projector never receives this component, so the notes stay off the congregation screens.
 */
export function SpeakerNotes({ tr, staged }: { tr: AnnT; staged: Frame }) {
  const notes = staged.kind === 'text' || staged.kind === 'image' ? staged.notes?.trim() : '';

  return (
    <aside aria-label={tr('notesTitle')} className="flex w-[320px] shrink-0 flex-col gap-4 border-l border-line bg-panel p-4">
      <h2 className="text-[11px] font-semibold tracking-wider text-accent uppercase">{tr('notesTitle')}</h2>

      {staged.kind === 'text' && (
        <div className="aspect-video w-full overflow-hidden rounded-md border border-line">
          <SlidePreview text={staged.text} headline={staged.headline} bgSrc={staged.bg} style={staged.style} className="h-full w-full" />
        </div>
      )}
      {staged.kind === 'image' && (
        <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-line bg-black/80">
          <img src={getSlideImageUrl(staged.src)} onError={onSlideImageError} alt={staged.title} className="h-full w-full object-contain" />
        </div>
      )}

      {notes ? (
        <p
          aria-live="polite"
          className="max-h-[calc(100vh-420px)] min-h-[160px] overflow-y-auto text-lg leading-relaxed whitespace-pre-line text-fg"
        >
          {notes}
        </p>
      ) : (
        <p className="text-sm text-muted">{staged.kind === 'idle' || staged.kind === 'blackout' ? tr('notesNothing') : tr('notesEmpty')}</p>
      )}
    </aside>
  );
}
