import { createContext, useContext, type CSSProperties } from 'react';
import { LOGO_SCALE_DEFAULT } from '../../shared/parish-profile.js';
import { useChurchLogo, useChurchLogoFrame } from './profile';

/** The light disc or tile behind a logo on a dark screen: warm off-white, slightly see-through so it reads as part of the scene. */
export const LOGO_BACKING_COLOR = 'rgba(245, 243, 238, 0.92)';
/** With a backing, the logo sits a little inside it, so a square crest does not touch the disc's edge. */
const BACKING_INSET = 0.84;

/** Unsaved logo values for the Settings previews. Every ChurchEmblem inside the provider (the real lower third card too) draws these. */
export interface EmblemOverride {
  src: string;
  scale: number;
  backing: boolean;
}
export const EmblemPreview = createContext<EmblemOverride | null>(null);

/**
 * The parish logo in its frame, drawn the same way on every surface: the sidebar, the projector crest, the failover screen, the lower third
 * and the Settings previews. The caller sizes the box (className or style); the logo is scaled inside it by the profile's logo size, and a
 * light backing is drawn behind it on a dark surface when the profile asks for one.
 *
 * `src`, `scale` and `backing` default to the saved profile. The Settings previews pass the unsaved values instead.
 */
export function ChurchEmblem({
  src,
  scale,
  backing,
  shape = 'free',
  dark = true,
  alt = '',
  className = '',
  style,
  imgClassName = '',
}: {
  src?: string;
  /** The logo size in percent (75–120). */
  scale?: number;
  backing?: boolean;
  /**
   * The frame the logo is clipped to. 'free' (the live surfaces): an unrounded box, so a logo at 100 % looks exactly as uploaded, and a
   * disc only when the backing is on. 'round' and 'square': the tiles the Settings contrast strip checks.
   */
  shape?: 'free' | 'round' | 'square';
  /** True when the surface behind is dark: only then is the backing drawn. */
  dark?: boolean;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  imgClassName?: string;
}) {
  const savedSrc = useChurchLogo();
  const saved = useChurchLogoFrame();
  const preview = useContext(EmblemPreview);
  const logo = src ?? preview?.src ?? savedSrc;
  const percent = scale ?? preview?.scale ?? saved.scale ?? LOGO_SCALE_DEFAULT;
  const backed = (backing ?? preview?.backing ?? saved.backing) && dark;
  const factor = (percent / 100) * (backed ? BACKING_INSET : 1);
  const rounding = shape === 'square' ? 'rounded-[14%]' : shape === 'round' || backed ? 'rounded-full' : '';
  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden ${rounding} ${className}`}
      style={{ ...(backed ? { background: LOGO_BACKING_COLOR, boxShadow: '0 0 0 1px rgba(255,255,255,0.18) inset' } : {}), ...style }}
    >
      <img
        src={logo}
        alt=""
        draggable={false}
        decoding="sync"
        className={`pointer-events-none size-full object-contain ${imgClassName}`}
        style={{ transform: factor === 1 ? undefined : `scale(${factor})` }}
      />
    </span>
  );
}
