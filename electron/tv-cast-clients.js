// The two ways a frame reaches a TV: a DLNA / UPnP renderer (SOAP SetAVTransportURI + Play) and a Chromecast / Google TV (the Cast v2 protocol
// over TLS on port 8009, hand-encoded: no protobuf package). Pure Node, no Electron import. The network calls are passed in, so the tests use
// fakes. Each client shows one picture address at a time; the manager gives it the newest and never queues.
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { escapeXml } from './tv-cast-discovery.js';
import { isPrivateAddress } from './lan-guard.js';

export const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';
const AV_TRANSPORT = 'urn:schemas-upnp-org:service:AVTransport:1';
const SOAP_TIMEOUT_MS = 4000;
const MAX_SOAP_REPLY = 64 * 1024;

// ---------------------------------------------------------------------------------------------------------------------------------
// DLNA

/** The DLNA description of one JPEG picture. It goes into the SOAP body escaped, so a TV reads it as text and parses it itself. */
export function didlLite(url, title = 'APCCMMA Live') {
  return (
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">' +
    `<item id="0" parentID="-1" restricted="1"><dc:title>${escapeXml(title)}</dc:title><upnp:class>object.item.imageItem.photo</upnp:class>` +
    `<res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_LRG;DLNA.ORG_OP=01;DLNA.ORG_FLAGS=00f00000000000000000000000000000" resolution="1920x1080">${escapeXml(url)}</res>` +
    '</item></DIDL-Lite>'
  );
}

/** One SOAP envelope for an AVTransport action. `args` are plain text values, escaped here. */
export function soapEnvelope(serviceType, action, args) {
  const body = Object.entries(args)
    .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body></s:Envelope>`
  );
}

/** A SOAP POST to a TV on the local network. Resolves `{ status }`; rejects on a public address, a timeout or a connection error. */
export function soapRequest({ url, action, body, timeoutMs = SOAP_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error('The TV address is not valid.'));
    }
    if (target.protocol !== 'http:' || !net.isIPv4(target.hostname) || !isPrivateAddress(target.hostname)) {
      return reject(new Error('Only a TV on this local network can be reached.'));
    }
    const payload = Buffer.from(body, 'utf8');
    const req = http.request(
      target,
      {
        method: 'POST',
        timeout: timeoutMs,
        headers: { 'Content-Type': 'text/xml; charset="utf-8"', 'Content-Length': payload.length, SOAPACTION: `"${action}"` },
      },
      (res) => {
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_SOAP_REPLY) req.destroy(new Error('The TV reply was too large.'));
        });
        res.on('end', () => resolve({ status: res.statusCode }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('The TV did not answer in time.')));
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * A DLNA / Smart View renderer. `show(url)` sends SetAVTransportURI and then Play; `stop()` sends Stop. Both resolve when the TV has
 * answered and reject with a short message the operator can read.
 */
export function createDlnaClient({ device, request = soapRequest }) {
  const service = device.serviceType || AV_TRANSPORT;
  const call = async (action, args) => {
    const result = await request({ url: device.controlUrl, action: `${service}#${action}`, body: soapEnvelope(service, action, { InstanceID: 0, ...args }) });
    if (result.status < 200 || result.status >= 300) throw new Error(`The TV refused ${action} (${result.status}).`);
  };
  let closed = false;
  return {
    protocol: 'dlna',
    async show(url) {
      if (closed) return;
      await call('SetAVTransportURI', { CurrentURI: url, CurrentURIMetaData: didlLite(url) });
      await call('Play', { Speed: 1 });
    },
    async stop() {
      try {
        await call('Stop', {});
      } catch {
        // A TV that is already off or unreachable has nothing to stop.
      }
    },
    close() {
      closed = true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Chromecast (Cast v2): CastMessage protobuf

const NS = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
};

const varint = (n) => {
  const out = [];
  let v = n;
  while (v > 127) {
    out.push((v & 127) | 128);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Buffer.from(out);
};
const readVarint = (buf, start) => {
  let value = 0;
  let scale = 1;
  let at = start;
  for (;;) {
    if (at >= buf.length) throw new RangeError('varint runs past the message');
    const byte = buf[at++];
    value += (byte & 127) * scale;
    if (!(byte & 128)) return [value, at];
    scale *= 128;
  }
};
const stringField = (num, text) => {
  const data = Buffer.from(text, 'utf8');
  return Buffer.concat([varint((num << 3) | 2), varint(data.length), data]);
};

/** One framed CastMessage: a 4-byte big-endian length, then the protobuf (version 0, string payload). */
export function encodeCastMessage({ source, destination, namespace, payload }) {
  const message = Buffer.concat([
    varint(1 << 3), varint(0),
    stringField(2, source),
    stringField(3, destination),
    stringField(4, namespace),
    varint(5 << 3), varint(0),
    stringField(6, JSON.stringify(payload)),
  ]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(message.length);
  return Buffer.concat([header, message]);
}

/** The CastMessages in `buffer`, and what is left over when the last one is not all here yet. A bad length drops the buffer. */
export function decodeCastMessages(buffer) {
  const messages = [];
  let pos = 0;
  while (buffer.length - pos >= 4) {
    const length = buffer.readUInt32BE(pos);
    if (length > 1024 * 1024) return { messages, rest: Buffer.alloc(0) };
    if (buffer.length - pos - 4 < length) break;
    const body = buffer.subarray(pos + 4, pos + 4 + length);
    pos += 4 + length;
    const message = { source: '', destination: '', namespace: '', payload: null };
    let at = 0;
    try {
      while (at < body.length) {
        const [tag, afterTag] = readVarint(body, at);
        at = afterTag;
        const field = Math.floor(tag / 8);
        const wire = tag % 8;
        if (wire === 0) {
          at = readVarint(body, at)[1];
        } else if (wire === 2) {
          const [len, afterLen] = readVarint(body, at);
          const text = body.toString('utf8', afterLen, afterLen + len);
          at = afterLen + len;
          if (field === 2) message.source = text;
          else if (field === 3) message.destination = text;
          else if (field === 4) message.namespace = text;
          else if (field === 6) message.payload = JSON.parse(text);
        } else break;
      }
    } catch {
      continue;
    }
    messages.push(message);
  }
  return { messages, rest: buffer.subarray(pos) };
}

const HEARTBEAT_MS = 5000;
const SILENCE_MS = 15000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

/**
 * A Chromecast / Google TV. It connects over TLS, launches the Default Media Receiver, and loads the newest picture address on `show(url)`.
 * It answers and sends heartbeats, and reconnects with a growing wait when the TV drops off Wi-Fi, until `disconnect()`. `onStatus(state, detail)`
 * hears `connecting`, `casting`, `reconnecting` and `error`.
 */
export function createCastClient({ device, tlsConnect = tls.connect, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now, onStatus = () => {}, log = console }) {
  let socket = null;
  let buffer = Buffer.alloc(0);
  let requestId = 0;
  let transportId = null;
  let sessionId = null;
  let wanted = null;
  let loaded = null;
  let closed = false;
  let attempt = 0;
  let heartbeat = null;
  let watchdog = null;
  let retry = null;
  let lastHeard = 0;
  let launching = false;

  const send = (destination, namespace, payload) => {
    if (!socket || socket.destroyed) return false;
    socket.write(encodeCastMessage({ source: 'sender-0', destination, namespace, payload }));
    return true;
  };
  const nextId = () => (requestId += 1);

  function teardownTimers() {
    clearTimer(heartbeat);
    clearTimer(watchdog);
    heartbeat = null;
    watchdog = null;
  }

  function lose(reason) {
    teardownTimers();
    const old = socket;
    socket = null;
    transportId = null;
    sessionId = null;
    launching = false;
    loaded = null;
    try {
      old?.destroy();
    } catch {
      // Already closed.
    }
    if (closed) return;
    onStatus('reconnecting', reason);
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    clearTimer(retry);
    retry = setTimer(connect, wait);
  }

  function flush() {
    if (!transportId || wanted === null || wanted === loaded) return;
    loaded = wanted;
    send(transportId, NS.media, {
      type: 'LOAD',
      requestId: nextId(),
      sessionId,
      autoplay: true,
      media: { contentId: wanted, contentType: 'image/jpeg', streamType: 'BUFFERED' },
    });
    onStatus('casting');
  }

  function handle(message) {
    lastHeard = now();
    const type = message.payload?.type;
    if (message.namespace === NS.heartbeat) {
      if (type === 'PING') send('receiver-0', NS.heartbeat, { type: 'PONG' });
      return;
    }
    if (message.namespace === NS.receiver && type === 'RECEIVER_STATUS') {
      const app = message.payload.status?.applications?.find((a) => a.appId === DEFAULT_MEDIA_RECEIVER);
      if (app) {
        launching = false;
        if (transportId !== app.transportId) {
          transportId = app.transportId;
          sessionId = app.sessionId;
          loaded = null;
          send(transportId, NS.connection, { type: 'CONNECT' });
        }
        flush();
      } else if (transportId) {
        // The viewer changed the TV's input or another app took over. The next picture launches the receiver again.
        transportId = null;
        sessionId = null;
        loaded = null;
        if (wanted !== null) launch();
      }
      return;
    }
    if (message.namespace === NS.media && (type === 'LOAD_FAILED' || type === 'INVALID_REQUEST')) {
      loaded = null;
      onStatus('error', 'The TV could not load the picture.');
    }
    if (message.namespace === NS.connection && type === 'CLOSE') lose('The TV closed the connection.');
  }

  function launch() {
    if (launching) return;
    launching = true;
    send('receiver-0', NS.receiver, { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER, requestId: nextId() });
  }

  function connect() {
    if (closed || socket) return;
    onStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    let secure;
    try {
      // A Chromecast's certificate is signed by Google's device authority and is not in any trust store, so it is not verified. Only this
      // socket skips the check, and the address was already limited to the local network.
      secure = tlsConnect({ host: device.ip, port: device.port || 8009, rejectUnauthorized: false });
    } catch (err) {
      return lose(err.message);
    }
    socket = secure;
    buffer = Buffer.alloc(0);
    secure.on('error', (err) => {
      log.warn?.(`[tv cast] ${device.ip}: ${err.message}`);
      if (socket === secure) lose(err.message);
    });
    secure.on('close', () => {
      if (socket === secure) lose('The TV disconnected.');
    });
    secure.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { messages, rest } = decodeCastMessages(buffer);
      buffer = rest;
      for (const message of messages) handle(message);
    });
    secure.once('secureConnect', () => {
      attempt = 0;
      lastHeard = now();
      send('receiver-0', NS.connection, { type: 'CONNECT' });
      send('receiver-0', NS.receiver, { type: 'GET_STATUS', requestId: nextId() });
      launch();
      heartbeat = setTimer(function beat() {
        send('receiver-0', NS.heartbeat, { type: 'PING' });
        heartbeat = setTimer(beat, HEARTBEAT_MS);
      }, HEARTBEAT_MS);
      watchdog = setTimer(function check() {
        if (now() - lastHeard > SILENCE_MS) return lose('The TV stopped answering.');
        watchdog = setTimer(check, HEARTBEAT_MS);
      }, HEARTBEAT_MS);
    });
  }

  return {
    protocol: 'chromecast',
    /** Starts the connection. Safe to call again. */
    connect,
    /** Shows `url`: now when the receiver is ready, otherwise as soon as it is. */
    async show(url) {
      wanted = url;
      if (!socket && !closed && retry === null) connect();
      flush();
    },
    /** Ends what the TV is showing, then closes. The TV returns to its own screen. */
    async stop() {
      if (sessionId) send('receiver-0', NS.receiver, { type: 'STOP', sessionId, requestId: nextId() });
    },
    /** Ends the cast for good: no more reconnects. */
    close() {
      closed = true;
      clearTimer(retry);
      retry = null;
      teardownTimers();
      try {
        socket?.end();
        socket?.destroy();
      } catch {
        // Already closed.
      }
      socket = null;
    },
  };
}
