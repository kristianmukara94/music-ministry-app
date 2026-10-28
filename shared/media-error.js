// Why a background picture or video could not be shown, in words the operator can act on. The browser reports a numeric error code on the
// element (MediaError), and the network state; this turns them into one short reason for the warning. Pure: no browser or Electron imports.

/** The MediaError codes the browser uses for a video that cannot be played. */
export const MEDIA_ERR = { ABORTED: 1, NETWORK: 2, DECODE: 3, SRC_NOT_SUPPORTED: 4 };

/**
 * The reason a background file could not be shown. `kind` is 'video' or 'image'; `code` is the MediaError code (or null when the browser
 * gave none); `networkState` is the element's network state, where it helps. Returns the reason, without the "This video cannot play:" part.
 */
export function describeMediaError(kind, code, networkState = null) {
  if (kind === 'image') return 'the picture could not be read (the file may be missing, or not a picture the app can show)';
  if (code === MEDIA_ERR.SRC_NOT_SUPPORTED) return 'the file format or its codec is not supported by this app (for example HEVC/H.265, or MKV)';
  if (code === MEDIA_ERR.DECODE) return 'the video could not be decoded (its codec or profile is not supported)';
  if (code === MEDIA_ERR.NETWORK || networkState === 3) return 'the file could not be read from the Media Library (it may be missing)';
  if (code === MEDIA_ERR.ABORTED) return 'loading was stopped before the video started';
  return 'the browser did not report a reason';
}
