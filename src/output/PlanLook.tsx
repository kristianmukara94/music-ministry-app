// Plan Appearance on screen: the plan's background layer and its text styling. Every surface that draws a plan's slides (the congregation
// projector, the Stage Mirror, the Output Preview, the Go Live program and preview monitors, the Planner's preview) draws them through these,
// so the plan looks the same everywhere. The rules are in shared/plan-appearance.js.
import type { CSSProperties, ReactNode } from 'react';
import { planLookSignature, planTextLook, type PlanAppearance, type ResolvedPlanBackground } from '../../shared/plan-appearance.js';
import { BackgroundMedia } from './BackgroundMedia';

/**
 * The plan's background: its colour, with its picture or looping muted motion clip covering it, and the dim over both. It stays mounted while
 * the plan's slides change, so a motion clip keeps playing from slide to slide; `visible` fades it out for a slide that is not the plan's (the
 * Welcome screen, a picture) and back.
 */
export function PlanBackgroundLayer({ background, visible = true }: { background: ResolvedPlanBackground; visible?: boolean }) {
  return (
    <div
      aria-hidden
      data-plan-background={background.type}
      className={`pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ backgroundColor: background.color }}
    >
      {background.media && <BackgroundMedia key={background.media.src} media={background.media} />}
      {background.dim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: background.dim }} />}
    </div>
  );
}

/**
 * The plan's weight, colour and drop shadow for the words of the slide inside (`[data-slide-words]`, see src/styles.css). A `display: contents`
 * box, so it adds nothing to the layout the fits measure. The slide is keyed by the look, so its fit runs again when one of them changes.
 */
export function PlanTextLook({ appearance, children }: { appearance: PlanAppearance | null; children: ReactNode }) {
  const look = planTextLook(appearance);
  if (!look.weight && !look.color && look.shadow === null) return <>{children}</>;
  const style = {
    ...(look.weight ? { '--apcc-plan-weight': String(look.weight) } : {}),
    ...(look.color ? { '--apcc-plan-text-color': look.color } : {}),
  } as CSSProperties;
  return (
    <div
      className="apcc-plan-text contents"
      data-plan-weight={look.weight ? '' : undefined}
      data-plan-color={look.color ? '' : undefined}
      data-plan-shadow={look.shadow === true ? '' : undefined}
      data-plan-flat={look.shadow === false ? '' : undefined}
      style={style}
    >
      <PlanKeyed key={planLookSignature(appearance)}>{children}</PlanKeyed>
    </div>
  );
}

/** A keyed boundary: a new key mounts the slide again, so every fit measures the words as they are now painted. */
function PlanKeyed({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
