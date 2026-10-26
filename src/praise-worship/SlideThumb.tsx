import type { PwSlide, PwType } from '../../shared/pw.js';
import { PwSlideFace } from './PwSlideFace';
import { usePwT } from './strings';

/** The bottom-left caption on a slide: the song for lyrics, "Pray together" for prayers. */
export function slideFooter(slide: PwSlide, prayTogether: string) {
  if (slide.kind === 'lyrics') return slide.hymnTitle;
  if (slide.kind === 'prayer') return prayTogether;
  return undefined;
}

/** A 16:9 thumbnail of one projector slide, with its number above it. */
export function SlideThumb({ slide, index, total, segmentName, type }: { slide: PwSlide; index: number; total: number; segmentName: string; type: PwType }) {
  const t = usePwT();
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="eyebrow !text-accent">{t('slideN', { n: index + 1 })}</figcaption>
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line [container-type:size]">
        <PwSlideFace slide={slide} segmentName={segmentName} type={type} index={index} total={total} footer={slideFooter(slide, t('prayTogether'))} />
      </div>
    </figure>
  );
}
