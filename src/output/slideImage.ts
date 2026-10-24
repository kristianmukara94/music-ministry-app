import type { SyntheticEvent } from 'react';

/**
 * The URL a slide image is shown from. The main process gives every slide and media image an `apcc-media://` URL
 * (`apcc-media://slide/<id>`, `apcc-media://media/<id>`), and those are used as they are. The renderer never sees
 * a file path, so a path encoded into the URL would not match any route. Anything else is logged and not shown.
 */
export function getSlideImageUrl(src: string | null | undefined): string {
  if (!src) return '';
  if (src.startsWith('apcc-media://') || src.startsWith('http')) return src;
  console.warn(`[slide] Not a media URL, so the image is not shown: ${src}`);
  return '';
}

/** Logs an image that failed to load, and hides it so the screen shows nothing rather than a broken-image icon. */
export function onSlideImageError(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  console.warn(`[slide] Image failed to load: ${img.currentSrc || img.src}`);
  img.style.visibility = 'hidden';
}
