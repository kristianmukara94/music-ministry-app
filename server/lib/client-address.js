// The client's address for the rate limits. The address comes from a header Vercel sets, never from the request body.
// Order: x-real-ip (Vercel sets it to the client's address and overwrites any copy the client sent), then the LAST entry of
// x-forwarded-for (the proxy appends the real client there, so an entry the client sent first cannot choose another bucket),
// then the connection's own address. No other header is trusted: a header the platform does not set could be sent by anyone.

const lowerKeys = (headers = {}) => Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

/** The address for one request. `event.headers` and, when the platform gives it, `event.remoteAddress`. */
export function clientAddress(event) {
  const headers = lowerKeys(event?.headers);
  const real = headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const entries = forwarded.split(',').map((e) => e.trim()).filter(Boolean);
    if (entries.length) return entries[entries.length - 1];
  }
  if (typeof event?.remoteAddress === 'string' && event.remoteAddress) return event.remoteAddress;
  return 'unknown';
}
