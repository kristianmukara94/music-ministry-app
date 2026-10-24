import type { WelcomeSettings } from '../../shared/welcome-settings.js';
import { getSlideImageUrl, onSlideImageError } from './slideImage';
import { useOutput } from './outputState';

/** The welcome screen on the projector: reads the saved content and style, so a change shows as soon as it is saved. */
export function WelcomeFrame() {
  const welcome = useOutput((s) => s.welcome);
  return <WelcomeCanvas settings={welcome} />;
}

/**
 * The welcome screen, full bleed: the background colour, then either the message or the chosen image. The font size is a
 * share of the stage width (1920 reference, as elsewhere), so the projector and the settings preview show the same layout.
 * The parent must be sized and positioned; this fills it.
 */
export function WelcomeCanvas({ settings }: { settings: WelcomeSettings }) {
  const image = settings.imageUrl ? getSlideImageUrl(settings.imageUrl) : '';
  return (
    <div
      className="absolute inset-0 flex items-center justify-center overflow-hidden p-[6cqw] text-center"
      style={{ backgroundColor: settings.backgroundColor, color: settings.textColor }}
    >
      {settings.welcomeType === 'IMAGE' ? (
        image ? (
          <img src={image} onError={onSlideImageError} alt="" draggable={false} className="h-full w-full object-contain" />
        ) : (
          <p className="text-[1.6cqw] opacity-60">No image chosen.</p>
        )
      ) : (
        <p className="font-serif leading-tight font-semibold whitespace-pre-line" style={{ fontSize: `${settings.fontSize / 19.2}cqw` }}>
          {settings.message}
        </p>
      )}
    </div>
  );
}
