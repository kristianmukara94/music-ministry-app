export const MEDIA_ERR: { ABORTED: 1; NETWORK: 2; DECODE: 3; SRC_NOT_SUPPORTED: 4 };
/** The reason a background picture or video could not be shown, in words the operator can act on. */
export function describeMediaError(kind: 'video' | 'image', code: number | null, networkState?: number | null): string;
