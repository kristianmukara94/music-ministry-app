// The checks shared by the two small web servers on this laptop (Remote view and the OBS browser source). They answer only the local network,
// and only when reached by the laptop's own address or name. No Electron import here, so it can be tested under plain Node.
import net from 'node:net';
import os from 'node:os';
import { pipeline } from 'node:stream';

/** True for a loopback, private or link-local address: the local network. Anything else is the public internet. */
export function isPrivateAddress(address) {
  const ip = String(address ?? '').replace(/^::ffff:/i, '').toLowerCase();
  if (net.isIPv4(ip)) return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  if (net.isIPv6(ip)) return ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  return false;
}

/**
 * True when a request names this laptop: by a numeric address, `localhost`, or the computer's own name. A web page that points its own domain
 * at this laptop (DNS rebinding) sends that domain here, so it is refused and cannot drive the projector from a browser on the network.
 */
export function hostAllowed(hostHeader, { hostname = os.hostname() } = {}) {
  if (hostHeader === undefined || hostHeader === null || hostHeader === '') return true;
  const name = String(hostHeader).trim().replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(name)) return true;
  const own = String(hostname ?? '').toLowerCase();
  return name === 'localhost' || (own !== '' && (name === own || name === `${own}.local`));
}

/**
 * Sends a file stream to a response. A plain `pipe` leaves the file open when the phone goes away, which a TV page does at every seek, and an
 * error on the file would stop the whole app. Here the file is closed either way, and a read that fails only ends that one response.
 */
export function sendStream(source, res, label) {
  pipeline(source, res, (err) => {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.warn(`[${label}] ${err.message}`);
  });
}
