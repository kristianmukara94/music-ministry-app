// Praise & Worship only: the Plan dialog and the Live view. It is built on PwSlideFace, not on SlidePreview, on purpose.
// SlidePreview draws one plain text slide for the Announcements, Bible, Lectionary and Song Lyrics decks, and its look is
// theirs to keep. P&W slides have their own design (labels, footers, the title slide, the placeholders), which
// PwSlideFace draws and the projector draws too. Merging the two would change one of those looks. Don't merge them.
import { useContext, useMemo, type ReactNode } from 'react';
import type { PwSlide, PwType } from '../../shared/pw.js';
import { useLive } from '../live/store';
import { slotTitleShown } from '../../shared/live.js';
import { welcomeBackground, type WelcomeBackground } from '../../shared/welcome-settings.js';
import { frameOwnLook, frameWithAlign, slideLookAt, type SlideLook } from '../../shared/slide-look.js';
import { withBackdropTheme } from '../../shared/stage-cue.js';
import { slideFontCss } from '../../shared/text-style.js';
import { applyPwSlideTextCase, applyTextCase, textCaseOf } from '../../shared/text-fit.js';
import { PwSlideFace } from './PwSlideFace';
import { SlideBackgroundLayer } from '../output/BackgroundMedia';
import { PlanLookOverride } from '../output/outputState';
import { PlanBackgroundLayer, PlanTextLook } from '../output/PlanLook';
import { applyPlanAppearance, loadedPlanAppearance, planBackgroundShown, type PlanAppearance } from '../../shared/plan-appearance.js';
import { slideFooter } from './SlideThumb';
import { usePwT } from './strings';

/** One slide as it is shown: the slide and where it sits, or a black screen (the end-of-segment step). */
export interface Shown {
  slide: PwSlide | null;
  segmentName: string;
  type: PwType;
  index: number;
  total: number;
  /** The step's key for its own look (shared/slide-look.js pwLookKey), so the monitors draw the slide as the projector does. */
  lookKey?: string;
}

const STAGE = 'relative aspect-video w-full overflow-hidden rounded-lg border border-fg/15 [container-type:size]';

/** The face of a slide drawn over the plan's background: no colour or shade of its own, so the plan layer under it shows. */
const SEE_THROUGH: WelcomeBackground = { color: null, media: { kind: 'image', src: '', fit: 'cover', loop: false }, shade: false };

/**
 * The Plan Appearance the Praise & Worship slides here are drawn with: the Planner's draft while its preview is open, else the look of the
 * Praise & Worship plan loaded for Go Live (shared/plan-appearance.js), else null (the Global Appearance).
 */
export function usePwPlanLook(): PlanAppearance | null {
  const override = useContext(PlanLookOverride);
  const loaded = useLive((s) => loadedPlanAppearance(s.state, 'pw'));
  return override !== undefined ? override : loaded;
}

/** A Praise & Worship frame stand-in, for the shared rule on when the plan's background shows (planBackgroundShown). */
const PW_FRAME = { kind: 'pw' } as const;

/** A slide, drawn with the projector's own design, or a black screen when the step is blank. */
function Face({ shown, blackLabel, background, look: given }: { shown: Shown; blackLabel: string; background: WelcomeBackground; look?: SlideLook | null }) {
  const t = usePwT();
  // The slide's own look: the one given (the editor's draft), else the one saved for its key. Each of its settings replaces the projector's.
  const saved = useLive((s) => slideLookAt(s.state, shown.lookKey)) ?? frameOwnLook(shown);
  const look = given === undefined ? saved : given;
  // The thumbnails follow the font and size the operator picks, so the change shows in the preview as it is made. The loaded plan's own
  // typography (Plan Appearance) goes over the operator's settings; the slide's own look goes over both.
  const appearance = usePwPlanLook();
  const settings = applyPlanAppearance(useLive((s) => s.state.settings), appearance);
  const slideFont = slideFontCss(settings.slideFont);
  const settingsScale = settings.slideFontScale;
  const slideScale = look?.fontScale ?? settingsScale;
  const titleShown = useLive((s) => slotTitleShown(s.state));
  // The projector's text case (Aa / AA / aa) and edge-to-edge (MAX), so the operator sees the congregation's slide 1:1. The case is applied to
  // the words before PwSlideFace fits them, as the projector does, so UPPERCASE is measured as drawn.
  const settingsCase = textCaseOf(settings.textCase);
  const textCase = look?.textCase ?? settingsCase;
  const edgeToEdge = look?.maxFit ?? settings.edgeToEdge === true;
  const align = look?.align ?? settings.slideAlign ?? null;
  const bandOn = useLive((s) => s.state.lowerThird.live !== null);
  const slide = useMemo(() => {
    const cased = applyPwSlideTextCase(shown.slide, textCase);
    return cased ? frameWithAlign({ kind: 'pw', slide: cased, segmentName: '', type: shown.type, index: 0, total: 1 }, align).slide : cased;
  }, [shown.slide, shown.type, textCase, align]);
  const savedBackground = useLive((s) => s.state.welcome.slideBackground);
  // The plan's background takes the place of the Live slide background, unless the slide has its own backdrop.
  const planBackground = planBackgroundShown({ frame: PW_FRAME, appearance, ownBackdrop: look?.backdrop ?? null });
  const face = useMemo(
    () => (planBackground ? SEE_THROUGH : look?.backdrop ? welcomeBackground(withBackdropTheme(savedBackground, look.backdrop)) : background),
    [planBackground, look?.backdrop, savedBackground, background],
  );
  if (!slide) {
    return (
      <div data-theme="default" className="absolute inset-0 grid place-items-center bg-canvas text-muted">
        {blackLabel}
      </div>
    );
  }
  return (
    <>
    {planBackground && <PlanBackgroundLayer background={planBackground} />}
    <PlanTextLook appearance={appearance}>
    <PwSlideFace
      slide={slide}
      segmentName={applyTextCase(shown.segmentName, textCase)}
      type={shown.type}
      index={shown.index}
      total={shown.total}
      footer={applyTextCase(slideFooter(slide, t('prayTogether')), textCase) || undefined}
      background={face}
      slideFont={slideFont}
      slideScale={slideScale}
      hideTitle={!titleShown}
      edgeToEdge={edgeToEdge}
      bandOn={bandOn}
    />
    </PlanTextLook>
    </>
  );
}

/**
 * One step drawn alone, filling a monitor that declares `container-type: size`: the Go Live console's program and preview monitors. The same
 * face, background layer, case and size as the projector, so the operator sees the congregation's slide 1:1.
 */
export function PwStageFace({ shown, look }: { shown: Shown; /** A look to draw in place of the saved one: the editor's draft. */ look?: SlideLook | null }) {
  const t = usePwT();
  const background = welcomeBackground(useLive((s) => s.state.welcome.slideBackground));
  // Under a plan's own background the Live slide background is not shown (the face draws the plan's layer).
  const planOn = planBackgroundShown({ frame: PW_FRAME, appearance: usePwPlanLook() }) !== null;
  return (
    <>
      {background.media && <SlideBackgroundLayer media={background.media} visible={shown.slide !== null && !planOn} />}
      <Face shown={shown} blackLabel={t('previewBlack')} background={background} look={look} />
    </>
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
  const planOn = planBackgroundShown({ frame: PW_FRAME, appearance: usePwPlanLook() }) !== null;
  const panel = (heading: string, body: ReactNode) => (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="text-[11px] font-semibold tracking-wider text-accent uppercase">{heading}</figcaption>
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
          {background.media && <SlideBackgroundLayer media={background.media} visible={current.slide !== null && !planOn} />}
          <Face shown={current} blackLabel={t('previewBlack')} background={background} />
        </div>,
      )}
      {panel(
        t('previewNext'),
        next ? (
          <div className={STAGE}>
            {background.media && <SlideBackgroundLayer media={background.media} visible={next.slide !== null && !planOn} />}
            <Face shown={next} blackLabel={t('previewBlack')} background={background} />
          </div>
        ) : (
          <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-fg/15 p-3 text-center text-sm text-muted">
            {endLabel}
          </div>
        ),
      )}
    </div>
    </div>
  );
}
