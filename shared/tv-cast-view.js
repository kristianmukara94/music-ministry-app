// What the Nearby TV Cast settings and the top bar say about a TV: badges, state words, button words and enable rules. Kept here, free of React,
// so node:test checks the wording and the rules (the UI in src/settings/TvCastSettings.tsx only draws them).

export const FEED_OPTIONS = [
  { value: 'projector', label: 'Projector' },
  { value: 'stage', label: 'Stage Mirror' },
];

const PROTOCOL_BADGES = { chromecast: 'Chromecast / Google TV', dlna: 'DLNA / Smart View' };
const STATE_WORDS = { ready: 'Ready', connecting: 'Connecting…', casting: 'Casting Live', reconnecting: 'Reconnecting' };

/** The protocol badge text for a TV. */
export function protocolBadge(tv) {
  return PROTOCOL_BADGES[tv?.protocol] ?? 'Smart TV';
}

/** The line under a TV name: maker and model when known, then its address. */
export function tvSubtitle(tv) {
  const make = [tv?.manufacturer, tv?.model].filter(Boolean).join(' ');
  return [make, tv?.ip].filter(Boolean).join(' · ');
}

/** True while a TV has a cast session, in any state: it is then shown a Disconnect button. */
export function isCasting(tv) {
  return Boolean(tv) && tv.state !== 'ready';
}

/** The status pill: its text and its tone (`ok`, `warn`, `danger` or `idle`). An error shows its own message. */
export function statePill(tv) {
  if (tv?.state === 'error') return { text: tv.error || 'The TV could not be reached.', tone: 'danger' };
  if (tv?.state === 'reconnecting') return { text: STATE_WORDS.reconnecting, tone: 'warn' };
  if (tv?.state === 'connecting') return { text: STATE_WORDS.connecting, tone: 'warn' };
  if (tv?.state === 'casting') return { text: STATE_WORDS.casting, tone: 'ok' };
  return { text: STATE_WORDS.ready, tone: 'idle' };
}

/** The button on a TV card. */
export function castButtonLabel(tv) {
  return isCasting(tv) ? 'Disconnect' : 'Cast';
}

/** The feed label, for the dropdown and the cards. */
export function feedLabel(feed) {
  return FEED_OPTIONS.find((o) => o.value === feed)?.label ?? 'Projector';
}

/** The top bar badge: `Casting · 2 TVs`. Null when nothing is casting, so the badge is not drawn. */
export function topBarCastLabel(casting) {
  const count = Number(casting) || 0;
  return count > 0 ? `Casting · ${count} ${count === 1 ? 'TV' : 'TVs'}` : null;
}

/** Which of the header buttons can be used. Cast to All needs a TV that is not casting yet; Stop All needs one that is. */
export function castControls(status, { busy = false } = {}) {
  const tvs = status?.tvs ?? [];
  return {
    scan: !busy && !status?.scanning,
    castAll: !busy && tvs.some((tv) => !isCasting(tv)),
    stopAll: !busy && tvs.some(isCasting),
  };
}
