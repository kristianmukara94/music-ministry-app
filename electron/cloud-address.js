// The cloud address this laptop talks to. The default is the church's live site. An environment variable (APCCMMA_CLOUD_URL) overrides
// it, then the address the operator saved in config.json. Only https addresses are allowed, and http only for localhost. Pure: no
// Electron imports, so it runs in Node and in the tests.

export const DEFAULT_CLOUD_ADDRESS = 'https://music-ministry-app.vercel.app';
const MAX_LENGTH = 200;
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/**
 * Checks an address the operator typed, or one read from an environment variable or config.json. Returns { ok: true, address } with
 * the address in its plain form (no trailing slash), or { ok: false, message } with a plain reason. The text itself is never echoed.
 */
export function checkCloudAddress(input) {
  const text = String(input ?? '').trim();
  if (text === '') return { ok: false, message: 'Enter the cloud address.' };
  if (text.length > MAX_LENGTH) return { ok: false, message: 'The cloud address is too long.' };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: 'The cloud address must start with https://, for example https://music-ministry-app.vercel.app' };
  }
  const local = LOCAL_HOSTS.includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local))) {
    return { ok: false, message: 'The cloud address must start with https://. Only localhost may use http://.' };
  }
  if (url.username || url.password) return { ok: false, message: 'The cloud address must not contain a user name or password.' };
  if (url.search || url.hash) return { ok: false, message: 'The cloud address must be the site address only, with nothing after it.' };
  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, address: `${url.origin}${path}` };
}

/**
 * The address to use: the environment variable if it is valid, then the saved address if it is valid, then the default. An invalid
 * value is ignored, so a bad override never leaves the laptop with no address.
 */
export function resolveCloudAddress({ env, config } = {}) {
  for (const candidate of [env, config]) {
    const checked = checkCloudAddress(candidate);
    if (checked.ok) return checked.address;
  }
  return DEFAULT_CLOUD_ADDRESS;
}

/**
 * The config patch for a new address the operator typed. Only `cloud_url` is changed. Nothing else in the config is touched, and no
 * token can be part of it. Returns { ok: true, patch } or { ok: false, message }.
 */
export function saveCloudAddress(text) {
  const checked = checkCloudAddress(text);
  if (!checked.ok) return { ok: false, message: checked.message };
  return { ok: true, patch: { cloud_url: checked.address } };
}
