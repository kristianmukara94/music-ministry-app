// Praise & Worship only: the Plan dialog and the Live view. It is built on PwSlideFace, not on SlidePreview, on purpose.
// SlidePreview draws one plain text slide for the Announcements, Bible, Lectionary and Song Lyrics decks, and its look is
// theirs to keep. P&W slides have their own design (labels, footers, the title slide, the placeholders), which
// PwSlideFace draws and the projector draws too. Merging the two would change one of those looks. Don't merge them.
import type { ReactNode } from 'react';
import type { PwSlide, PwType } from '../../shared/pw.js';
import { useLive } from '../live/store';
import { welcomeBackground, type WelcomeBackground } from '../../shared/welcome-settings.js';
import { PwSlideFace } from './PwSlideFace';
import { SlideBackgroundLayer } from '../output/BackgroundMedia';
import { slideFooter } from './SlideThumb';
import { usePwT } from './strings';

/** One slide as it is shown: the slide and where it sits, or a black screen (the end-of-segment step). */
export interface Shown {
  slide: PwSlide | null;
  segmentName: string;
  type: PwType;
  index: number;
  total: number;
}

const STAGE = 'relative aspect-video w-full overflow-hidden rounded-xl border border-line-strong [container-type:size]';

/** A slide, drawn with the projector's own design, or a black screen when the step is blank. */
function Face({ shown, blackLabel, background }: { shown: Shown; blackLabel: string; background: WelcomeBackground }) {
  const t = usePwT();
  if (!shown.slide) {
    return (
      <div data-theme="default" className="absolute inset-0 grid place-items-center bg-canvas text-muted">
        {blackLabel}
      </div>
    );
  }
  return (
    <PwSlideFace
      slide={shown.slide}
      segmentName={shown.segmentName}
      type={shown.type}
      index={shown.index}
      total={shown.total}
      footer={slideFooter(shown.slide, t('prayTogether'))}
      background={background}
    />
  );
}

/**
 * The current slide large, with the next slide beside it. Used by the Plan view's preview and the Live console, so both
 * read the same. `next` is null at the end of the lineup or the segment: the panel then says so instead of drawing a slide.
 */
export function CurrentNextPreview({
  current,
  next,
  endLabel,
}: {
  current: Shown;
  next: Shown | null;
  /** Shown in the next panel when there is no next slide. */
  endLabel: string;
}) {
  const t = usePwT();
  // The same background as the projector: the Live slide background, so the preview matches the output.
  const background = welcomeBackground(useLive((s) => s.state.welcome.slideBackground));
  const panel = (heading: string, body: ReactNode) => (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="eyebrow !text-accent">{heading}</figcaption>
      {body}
    </figure>
  );
  // The container is the wrapper: a container query cannot restyle the element that declares it.
  return (
    <div className="@container/preview">
    <div className="grid grid-cols-1 gap-4 @md/preview:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      {panel(
        t('previewCurrent'),
        <div className={STAGE}>
          {/* Each panel keeps its own background layer, so a slide change never restarts the video. */}
          {background.media && <SlideBackgroundLayer media={background.media} visible={current.slide !== null} />}
          <Face shown={current} blackLabel={t('previewBlack')} background={background} />
        </div>,
      )}
      {panel(
        t('previewNext'),
        next ? (
          <div className={STAGE}>
            {background.media && <SlideBackgroundLayer media={background.media} visible={next.slide !== null} />}
            <Face shown={next} blackLabel={t('previewBlack')} background={background} />
          </div>
        ) : (
          <div className="grid aspect-video w-full place-items-center rounded-xl border border-dashed border-line-strong p-3 text-center text-sm text-muted">
            {endLabel}
          </div>
        ),
      )}
    </div>
    </div>
  );
}
