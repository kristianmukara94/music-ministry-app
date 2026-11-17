import type { MediaFrame } from '../../shared/live.js';
import type { MediaAsset } from './types';

/**
 * A library picture or video as a background frame, carrying its saved Media Studio edits so every screen draws them. Unedited items give
 * the same plain frame as before the Studio. Audio is never a background, so it has none.
 */
export function assetFrame(asset: Pick<MediaAsset, 'mediaType' | 'src' | 'filename' | 'edit' | 'edited'>): MediaFrame | null {
  if (asset.mediaType === 'audio') return null;
  const frame: MediaFrame = { kind: 'media', mediaType: asset.mediaType, src: asset.src, title: asset.filename };
  if (asset.edited && asset.edit) frame.edit = asset.edit;
  return frame;
}
