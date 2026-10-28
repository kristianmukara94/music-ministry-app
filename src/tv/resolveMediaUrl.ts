/**
 * The address a TV fetches a Media Library item from. The Secondary port serves items by library id, behind the PIN, so the TV page asks
 * its own origin (`base` is empty). Returns null for no media.
 */
export function resolveMediaUrl(mediaId: string | null, base = ''): string | null {
  return mediaId ? `${base}/api/remote/media/${mediaId}` : null;
}
