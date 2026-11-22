// Nearby TV discovery: DLNA / UPnP renderers (SSDP), Chromecast and Google TV (mDNS `_googlecast._tcp`), a manual "Add TV by IP", and the
// `apccmma.local` name for TVs that only have a basic browser. Pure Node (dgram, net, http): no Electron import and no native addon, so it
// runs under `node --test`. The sockets, the clock and the fetcher are passed in, so the tests drive it without a network.
import http from 'node:http';
import net from 'node:net';
import { isPrivateAddress } from './lan-guard.js';

export const SSDP_ADDRESS = '239.255.255.250';
export const SSDP_PORT = 1900;
export const MDNS_ADDRESS = '224.0.0.251';
export const MDNS_PORT = 5353;
export const CAST_PORT = 8009;
export const APCCMMA_HOSTNAME = 'apccmma.local';
export const CAST_SERVICE = '_googlecast._tcp.local';
export const SSDP_TARGETS = ['urn:schemas-upnp-org:device:MediaRenderer:1', 'urn:schemas-upnp-org:service:AVTransport:1'];

const MAX_DESCRIPTION_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 3000;
const SCAN_MS = 3000;

// ---------------------------------------------------------------------------------------------------------------------------------
// SSDP + UPnP device description

/** The M-SEARCH packet for one search target. */
export function ssdpSearch(target, { host = `${SSDP_ADDRESS}:${SSDP_PORT}`, mx = 2 } = {}) {
  return Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${host}\r\nMAN: "ssdp:discover"\r\nMX: ${mx}\r\nST: ${target}\r\n\r\n`, 'ascii');
}

/** The headers of an SSDP response (or NOTIFY), names lowercased. Null when the packet is not an HTTP-style SSDP message. */
export function parseSsdpResponse(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  if (!/^(HTTP\/1\.1 200|NOTIFY \*)/i.test(lines[0] ?? '')) return null;
  const headers = {};
  for (const line of lines.slice(1)) {
    const at = line.indexOf(':');
    if (at < 1) continue;
    headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return headers;
}

const decodeXml = (s) =>
  String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

export const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** The text inside the first `<tag>` of `xml`, entity-decoded and trimmed. Null when the tag is absent. */
function tagText(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return match ? decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : null;
}

/**
 * A UPnP device description as a TV the operator can pick: its friendly name, maker, model, and the AVTransport control address (resolved
 * against the description's own address). Returns null when the device has no AVTransport service, so it cannot show a picture.
 */
export function parseDeviceDescription(xml, location) {
  const text = String(xml ?? '');
  // The root device's own fields come before its embedded devices, so the first match of each tag is the renderer's own.
  const deviceStart = text.search(/<device[\s>]/i);
  if (deviceStart < 0) return null;
  const head = text.slice(deviceStart).split(/<deviceList[\s>]/i)[0];
  const services = [...text.matchAll(/<service>([\s\S]*?)<\/service>/gi)].map((m) => m[1]);
  const transport = services.find((s) => /AVTransport/i.test(tagText(s, 'serviceType') ?? ''));
  if (!transport) return null;
  const control = tagText(transport, 'controlURL');
  if (!control) return null;
  const urlBase = tagText(text, 'URLBase');
  let controlUrl;
  try {
    controlUrl = new URL(control, urlBase || location).toString();
  } catch {
    return null;
  }
  const udn = tagText(head, 'UDN');
  return {
    name: tagText(head, 'friendlyName') ?? 'Smart TV',
    manufacturer: tagText(head, 'manufacturer') ?? '',
    model: tagText(head, 'modelName') ?? '',
    udn,
    controlUrl,
    serviceType: tagText(transport, 'serviceType'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// mDNS (DNS packets)

const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33, ANY: 255 };

function encodeName(name) {
  const parts = String(name).replace(/\.$/, '').split('.');
  const bufs = parts.map((p) => {
    const b = Buffer.from(p, 'utf8');
    return Buffer.concat([Buffer.from([b.length]), b]);
  });
  return Buffer.concat([...bufs, Buffer.from([0])]);
}

/** A DNS query packet for one name. `unicast` sets the "reply to me directly" bit, which lets a scan use any port, not only 5353. */
export function buildMdnsQuery(name, type = TYPE.PTR, { unicast = true } = {}) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(unicast ? 0x8001 : 1, 2);
  return Buffer.concat([header, encodeName(name), tail]);
}

/** Reads a (possibly compressed) name at `offset`. Returns the name and the offset after it in the record. */
function readName(buf, offset) {
  const labels = [];
  let pos = offset;
  let next = -1;
  for (let hops = 0; hops < 32; hops += 1) {
    if (pos >= buf.length) throw new RangeError('name runs past the packet');
    const len = buf[pos];
    if (len === 0) return { name: labels.join('.'), next: next < 0 ? pos + 1 : next };
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new RangeError('pointer runs past the packet');
      if (next < 0) next = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      continue;
    }
    if (pos + 1 + len > buf.length) throw new RangeError('label runs past the packet');
    labels.push(buf.toString('utf8', pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  throw new RangeError('too many name pointers');
}

function parseTxt(data) {
  const out = {};
  let pos = 0;
  while (pos < data.length) {
    const len = data[pos];
    const entry = data.toString('utf8', pos + 1, pos + 1 + len);
    pos += 1 + len;
    const eq = entry.indexOf('=');
    if (eq > 0) out[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1);
  }
  return out;
}

/**
 * A DNS packet as `{ questions, records }`. Records are `{ name, type, ttl, ... }` with `ip` (A), `target` (PTR), `port` and `host` (SRV) or
 * `txt` (TXT). A packet that is cut short returns what was read before the cut, and a malformed one returns nothing: it never throws.
 */
export function parseDnsPacket(buf) {
  const result = { questions: [], records: [] };
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return result;
    const counts = [buf.readUInt16BE(4), buf.readUInt16BE(6), buf.readUInt16BE(8), buf.readUInt16BE(10)];
    let pos = 12;
    for (let i = 0; i < counts[0]; i += 1) {
      const { name, next } = readName(buf, pos);
      result.questions.push({ name, type: buf.readUInt16BE(next), unicast: (buf.readUInt16BE(next + 2) & 0x8000) !== 0 });
      pos = next + 4;
    }
    const total = counts[1] + counts[2] + counts[3];
    for (let i = 0; i < total; i += 1) {
      const { name, next } = readName(buf, pos);
      const type = buf.readUInt16BE(next);
      const ttl = buf.readUInt32BE(next + 4);
      const length = buf.readUInt16BE(next + 8);
      const start = next + 10;
      if (start + length > buf.length) break;
      const record = { name, type, ttl };
      const data = buf.subarray(start, start + length);
      if (type === TYPE.A && length === 4) record.ip = [...data].join('.');
      else if (type === TYPE.PTR) record.target = readName(buf, start).name;
      else if (type === TYPE.TXT) record.txt = parseTxt(data);
      else if (type === TYPE.SRV && length >= 7) {
        record.port = data.readUInt16BE(4);
        record.host = readName(buf, start + 6).name;
      }
      result.records.push(record);
      pos = start + length;
    }
  } catch {
    // A short or malformed packet: whatever was read is kept.
  }
  return result;
}

/**
 * The Chromecast / Google TV devices in a set of DNS records: PTR names the instance, SRV its host and port, TXT its `fn` (friendly name),
 * `md` (model) and `id`, and an A record the address. An instance still missing its address is left out until a later packet brings it.
 */
export function castDevicesFromRecords(records) {
  const lower = (s) => String(s).toLowerCase();
  const instances = records.filter((r) => r.type === TYPE.PTR && lower(r.name) === CAST_SERVICE).map((r) => r.target);
  const devices = [];
  for (const instance of instances) {
    const srv = records.find((r) => r.type === TYPE.SRV && lower(r.name) === lower(instance));
    const txt = records.find((r) => r.type === TYPE.TXT && lower(r.name) === lower(instance))?.txt ?? {};
    const address = srv ? records.find((r) => r.type === TYPE.A && lower(r.name) === lower(srv.host)) : null;
    if (!srv || !address?.ip) continue;
    devices.push({
      protocol: 'chromecast',
      id: `cast:${txt.id || address.ip}`,
      name: txt.fn || instance.split('.')[0],
      manufacturer: 'Google',
      model: txt.md || '',
      ip: address.ip,
      port: srv.port || CAST_PORT,
    });
  }
  return devices;
}

/** The mDNS answer for `apccmma.local`, or null when the packet does not ask for that name. `unicastTo` is not part of the packet. */
export function answerHostnameQuery(packet, address, hostname = APCCMMA_HOSTNAME) {
  if (!net.isIPv4(address)) return null;
  const { questions } = parseDnsPacket(packet);
  const asked = questions.find((q) => q.name.toLowerCase() === hostname && (q.type === TYPE.A || q.type === TYPE.ANY));
  if (!asked) return null;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(1, 6);
  const record = Buffer.alloc(14);
  record.writeUInt16BE(TYPE.A, 0);
  record.writeUInt16BE(0x8001, 2);
  record.writeUInt32BE(120, 4);
  record.writeUInt16BE(4, 8);
  Buffer.from(address.split('.').map(Number)).copy(record, 10);
  return { packet: Buffer.concat([header, encodeName(hostname), record]), unicast: asked.unicast };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Network helpers

/** Fetches a small text document from a local network address. Refuses a public address, a big body, and a slow answer. */
export function fetchLocalText(url, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_DESCRIPTION_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return reject(new Error('That address is not valid.'));
    }
    if (target.protocol !== 'http:' || !net.isIPv4(target.hostname) || !isPrivateAddress(target.hostname)) {
      return reject(new Error('Only a TV on this local network can be reached.'));
    }
    const req = http.get(target, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`The TV answered ${res.statusCode}.`));
      }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) req.destroy(new Error('The TV description was too large.'));
        else chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The TV did not answer in time.')));
    req.on('error', reject);
  });
}

/** True when something accepts a TCP connection on `ip:port` within the timeout. */
export function probeTcp(ip, port, { timeoutMs = 1500, connect = net.connect } = {}) {
  return new Promise((resolve) => {
    const socket = connect({ host: ip, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * What the operator typed in "Add TV by IP": a plain address (`192.168.1.20`), an address and port (`192.168.1.20:8009`), or a full
 * description address (`http://192.168.1.20:49152/desc.xml`). Returns `{ ip, port, url }` or `{ error }`. Public addresses are refused.
 */
export function parseTvAddress(input) {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > 300) return { error: 'Enter the TV\'s address, for example 192.168.1.20.' };
  let ip;
  let port = null;
  let url = null;
  if (/^https?:\/\//i.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return { error: 'That address is not valid.' };
    }
    if (parsed.protocol !== 'http:') return { error: 'A TV description address starts with http://.' };
    ip = parsed.hostname;
    port = parsed.port ? Number(parsed.port) : 80;
    url = parsed.toString();
  } else {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(raw);
    if (!match) return { error: 'Enter the TV\'s address, for example 192.168.1.20.' };
    ip = match[1];
    port = match[2] ? Number(match[2]) : null;
  }
  if (!net.isIPv4(ip)) return { error: 'That is not a valid address.' };
  if (!isPrivateAddress(ip)) return { error: 'Only a TV on this local network can be added.' };
  if (port !== null && (port < 1 || port > 65535)) return { error: 'That port is not valid.' };
  return { ip, port, url };
}

const DESCRIPTION_PATHS = ['/', '/description.xml', '/dmr', '/rootDesc.xml', '/upnp/desc.xml', '/MediaRenderer/desc.xml'];

/**
 * The discovery engine. `dgram` is node's module (or a fake); `localAddress()` is the laptop's Wi-Fi address, so multicast leaves by that
 * adapter and not a VPN or virtual switch. Devices found are remembered by id, and `onChange` hears when the list changes.
 */
export function createDiscovery({
  dgram,
  localAddress,
  fetchText = fetchLocalText,
  probe = probeTcp,
  scanMs = SCAN_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onChange = () => {},
  log = console,
}) {
  const known = new Map();
  let scanning = null;
  let responder = null;
  let responderNote = null;

  const list = () => [...known.values()].sort((a, b) => a.name.localeCompare(b.name) || a.ip.localeCompare(b.ip));

  function remember(device) {
    const before = known.get(device.id);
    const merged = { ...before, ...device };
    known.set(device.id, merged);
    if (!before || JSON.stringify(before) !== JSON.stringify(merged)) onChange(list());
    return merged;
  }

  async function describe(location, fromIp) {
    try {
      const url = new URL(location);
      // A description must come from the device that answered: a spoofed LOCATION cannot point the laptop at another machine.
      if (url.hostname !== fromIp || !isPrivateAddress(url.hostname)) return null;
      const info = parseDeviceDescription(await fetchText(location), location);
      if (!info) return null;
      return remember({
        protocol: 'dlna',
        id: `dlna:${info.udn || fromIp}`,
        name: info.name,
        manufacturer: info.manufacturer,
        model: info.model,
        ip: fromIp,
        port: Number(url.port) || 80,
        controlUrl: info.controlUrl,
      });
    } catch (err) {
      log.warn?.(`[tv cast] ${fromIp}: ${err.message}`);
      return null;
    }
  }

  /** One UDP socket that sends `packets` to `to` and passes every reply to `onMessage`. Never throws: a failure resolves with the reason. */
  function openSocket(onMessage, { port = 0 } = {}) {
    return new Promise((resolve) => {
      let socket;
      try {
        socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      } catch (err) {
        return resolve({ error: err.message });
      }
      socket.on('error', (err) => log.warn?.(`[tv cast] socket: ${err.message}`));
      socket.on('message', onMessage);
      socket.bind(port, () => {
        try {
          const address = localAddress();
          if (address) socket.setMulticastInterface(address);
        } catch {
          // Not every adapter takes this; the multicast then leaves by the default one.
        }
        resolve({ socket });
      });
      socket.once('error', (err) => resolve({ error: err.message }));
    });
  }

  const send = (socket, packet, port, address) =>
    new Promise((resolve) => {
      try {
        socket.send(packet, port, address, () => resolve());
      } catch {
        resolve();
      }
    });

  /** Looks for TVs for a few seconds, both ways at once. Resolves with every TV known, including the ones found before. */
  function scan() {
    if (scanning) return scanning;
    scanning = (async () => {
      const pending = [];
      const records = [];
      const seenLocations = new Set();
      const onSsdp = (msg, rinfo) => {
        const headers = parseSsdpResponse(msg.toString('utf8'));
        if (!headers?.location || seenLocations.has(headers.location)) return;
        seenLocations.add(headers.location);
        pending.push(describe(headers.location, rinfo.address));
      };
      const onMdns = (msg) => {
        records.push(...parseDnsPacket(msg).records);
        for (const device of castDevicesFromRecords(records)) remember(device);
      };
      const ssdp = await openSocket(onSsdp);
      const mdns = await openSocket(onMdns);
      if (ssdp.socket) for (const target of SSDP_TARGETS) await send(ssdp.socket, ssdpSearch(target), SSDP_PORT, SSDP_ADDRESS);
      if (mdns.socket) await send(mdns.socket, buildMdnsQuery(CAST_SERVICE, TYPE.PTR), MDNS_PORT, MDNS_ADDRESS);
      await new Promise((resolve) => setTimer(resolve, scanMs));
      await Promise.allSettled(pending);
      for (const { socket } of [ssdp, mdns]) {
        try {
          socket?.close();
        } catch {
          // Already closed.
        }
      }
      return list();
    })().finally(() => {
      scanning = null;
    });
    return scanning;
  }

  /** Adds one TV by address, for a network that blocks multicast between wireless devices. Resolves `{ ok, device }` or `{ ok: false, error }`. */
  async function addByIp(input) {
    const parsed = parseTvAddress(input);
    if (parsed.error) return { ok: false, error: parsed.error };
    const { ip, port, url } = parsed;
    // A description address was given: read it directly.
    if (url) {
      const device = await describe(url, ip);
      return device ? { ok: true, device } : { ok: false, error: 'That address did not describe a TV that can show a picture.' };
    }
    // A DLNA port was given: try the usual description paths on it.
    if (port && port !== CAST_PORT) {
      for (const path of DESCRIPTION_PATHS) {
        const device = await describe(`http://${ip}:${port}${path}`, ip);
        if (device) return { ok: true, device };
      }
      return { ok: false, error: `No TV answered at ${ip}:${port}.` };
    }
    // A Chromecast listens on 8009. Its name comes from the Cast device's own setup page when it answers.
    if (await probe(ip, CAST_PORT)) {
      let name = `Chromecast (${ip})`;
      let model = '';
      try {
        const info = JSON.parse(await fetchText(`http://${ip}:8008/setup/eureka_info?params=name,device_info`));
        name = info.name || name;
        model = info.model_name || '';
      } catch {
        // The setup page is optional; the TV is still added by its address.
      }
      return { ok: true, device: remember({ protocol: 'chromecast', id: `cast:${ip}`, name, manufacturer: 'Google', model, ip, port: CAST_PORT, manual: true }) };
    }
    // A DLNA renderer: a direct (unicast) search asks it for its description address.
    const found = await new Promise((resolve) => {
      let timer = null;
      let socket = null;
      const finish = (value) => {
        clearTimer(timer);
        try {
          socket?.close();
        } catch {
          // Already closed.
        }
        resolve(value);
      };
      openSocket((msg, rinfo) => {
        const headers = parseSsdpResponse(msg.toString('utf8'));
        if (headers?.location && rinfo.address === ip) finish(headers.location);
      }).then(async (opened) => {
        socket = opened.socket ?? null;
        if (!socket) return finish(null);
        timer = setTimer(() => finish(null), 2500);
        for (const target of SSDP_TARGETS) await send(socket, ssdpSearch(target, { host: `${ip}:${SSDP_PORT}` }), SSDP_PORT, ip);
      });
    });
    if (found) {
      const device = await describe(found, ip);
      if (device) return { ok: true, device: remember({ ...device, manual: true }) };
    }
    return { ok: false, error: `No TV answered at ${ip}. Check the address, and that the TV is on this Wi-Fi.` };
  }

  /** Answers mDNS questions for `apccmma.local` with the laptop's address. A port the system already holds leaves it off, with a note. */
  async function startHostnameResponder() {
    if (responder) return { ok: true };
    const address = localAddress();
    if (!address) {
      responderNote = 'No local network address, so apccmma.local is not available.';
      return { ok: false, error: responderNote };
    }
    const opened = await openSocket(
      (msg, rinfo) => {
        const answer = answerHostnameQuery(msg, localAddress() ?? address);
        if (!answer) return;
        if (answer.unicast) opened.socket.send(answer.packet, rinfo.port, rinfo.address, () => {});
        else opened.socket.send(answer.packet, MDNS_PORT, MDNS_ADDRESS, () => {});
      },
      { port: MDNS_PORT },
    );
    if (!opened.socket) {
      responderNote = `apccmma.local could not start (${opened.error}). Use the TV's numeric address instead.`;
      return { ok: false, error: responderNote };
    }
    try {
      opened.socket.addMembership(MDNS_ADDRESS, address);
    } catch (err) {
      try {
        opened.socket.close();
      } catch {
        // Already closed.
      }
      responderNote = `apccmma.local could not join the network group (${err.message}).`;
      return { ok: false, error: responderNote };
    }
    responder = opened.socket;
    responderNote = null;
    return { ok: true };
  }

  function stopHostnameResponder() {
    try {
      responder?.close();
    } catch {
      // Already closed.
    }
    responder = null;
  }

  return {
    devices: list,
    get: (id) => known.get(id) ?? null,
    scan,
    addByIp,
    startHostnameResponder,
    stopHostnameResponder,
    hostnameStatus: () => ({ running: responder !== null, note: responderNote }),
    isScanning: () => scanning !== null,
    close: stopHostnameResponder,
  };
}
