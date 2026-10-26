import type { KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SlidePreview } from '../announcements/TextSlideModal';
import type { PreviewSlides } from './preview';
import { useGoLiveT } from './strings';

const STEP = 'flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-line-strong transition hover:bg-panel-2 disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * Steps through the slides of one item as they look on screen. It only draws them: nothing here is staged, shown on the
 * projector or in the lower third, or sent to the Mass Queue.
 */
export function PreviewPane({ label, slides, index, onStep }: { label: string; slides: PreviewSlides; index: number; onStep: (delta: 1 | -1) => void }) {
  const t = useGoLiveT();
  const total = slides.pages.length;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onStep(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onStep(-1);
    }
  };

  return (
    <section aria-labelledby="golive-preview" onKeyDown={onKeyDown} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="golive-preview" className="eyebrow !text-accent">
            {t('previewHeading')}
          </h2>
          <h3 className="truncate font-sans condensed text-2xl font-black uppercase">{label}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={STEP} disabled={index <= 0} onClick={() => onStep(-1)} aria-label={t('prevSlide')}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <p className="min-w-[8rem] text-center text-sm text-muted" aria-live="polite">
            {t('slideCount', { n: index + 1, total })}
          </p>
          <button type="button" className={STEP} disabled={index >= total - 1} onClick={() => onStep(1)} aria-label={t('nextSlide')}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      <p className="text-xs text-muted">{t('previewHint')}</p>
      <SlidePreview text={slides.pages[index] ?? ''} bgSrc={null} style={slides.style} className="mx-auto aspect-video w-full max-w-3xl rounded-lg border border-line-strong" />
    </section>
  );
}
