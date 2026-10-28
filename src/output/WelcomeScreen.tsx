import { useEffect, useState } from 'react';
import { WELCOME_CANVAS_COLOR, welcomeBackground, type WelcomeSettings } from '../../shared/welcome-settings.js';
import { getSlideImageUrl, onSlideImageError } from './slideImage';
import { BackgroundMedia, BackgroundShade } from './BackgroundMedia';
import { useOutput } from './outputState';

/** The welcome screen on the projector: reads the saved content and style, so a change shows as soon as it is saved. */
export function WelcomeFrame() {
  const welcome = useOutput((s) => s.welcome);
  return <WelcomeCanvas settings={welcome} />;
}

/**
 * The welcome screen, full bleed. Behind everything is the background colour. Over it, when one is chosen and present, is a picture or a
 * video clip, filled or shown whole, with a shade behind the text when that is on. Then the message, or the welcome picture. The projector and
 * the settings preview draw this same canvas, so they match. `onBackgroundMissing` is called when the chosen background will not load; the
 * screen then shows the colour instead. The font size is a share of the stage width (1920 reference, as elsewhere).
 */
export function WelcomeCanvas({ settings, onBackgroundMissing }: { settings: WelcomeSettings; onBackgroundMissing?: () => void }) {
  const [failed, setFailed] = useState(false);
  // A new background gets a fresh try: a file that failed before may now be there.
  useEffect(() => setFailed(false), [settings.backgroundUrl, settings.backgroundType]);
  const background = welcomeBackground(settings, failed);
  const onBackgroundError = () => {
    setFailed(true);
    onBackgroundMissing?.();
  };

  const image = settings.imageUrl ? getSlideImageUrl(settings.imageUrl) : '';
  // A filled welcome picture covers the whole output, so it is not padded; every other view keeps the padding.
  const filled = settings.welcomeType === 'IMAGE' && image !== '' && settings.imageFit !== 'FIT';
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center overflow-hidden text-center ${filled ? '' : 'p-[6cqw]'}`}
      style={{ backgroundColor: background.color ?? WELCOME_CANVAS_COLOR, color: settings.textColor }}
    >
      {background.media && <BackgroundMedia media={background.media} onFail={onBackgroundError} />}
      {background.media && background.shade && settings.welcomeType === 'TEXT' && <BackgroundShade />}

      {settings.welcomeType === 'IMAGE' ? (
        image ? (
          filled ? (
            <img src={image} onError={onSlideImageError} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover object-center" />
          ) : (
            <img src={image} onError={onSlideImageError} alt="" draggable={false} className="h-full w-full object-contain object-center" />
          )
        ) : (
          <p className="text-[1.6cqw] opacity-60">No image chosen.</p>
        )
      ) : (
        <p className="relative font-serif leading-tight font-semibold whitespace-pre-line" style={{ fontSize: `${settings.fontSize / 19.2}cqw` }}>
          {settings.message}
        </p>
      )}
    </div>
  );
}
