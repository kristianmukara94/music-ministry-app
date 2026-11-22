export interface TvCastTv {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  ip: string;
  protocol: 'chromecast' | 'dlna';
  feed: 'projector' | 'stage';
  state: 'ready' | 'connecting' | 'casting' | 'reconnecting' | 'error';
  error: string | null;
}
export const FEED_OPTIONS: { value: 'projector' | 'stage'; label: string }[];
export function protocolBadge(tv: Pick<TvCastTv, 'protocol'>): string;
export function tvSubtitle(tv: Partial<TvCastTv>): string;
export function isCasting(tv: Pick<TvCastTv, 'state'>): boolean;
export function statePill(tv: Pick<TvCastTv, 'state' | 'error'>): { text: string; tone: 'ok' | 'warn' | 'danger' | 'idle' };
export function castButtonLabel(tv: Pick<TvCastTv, 'state'>): 'Cast' | 'Disconnect';
export function feedLabel(feed: string): string;
export function topBarCastLabel(casting: number): string | null;
export function castControls(status: { tvs: TvCastTv[]; scanning?: boolean } | null | undefined, options?: { busy?: boolean }): { scan: boolean; castAll: boolean; stopAll: boolean };
