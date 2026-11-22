// Nearby TV discovery: the SSDP and UPnP parsers, the mDNS packet reader (with name compression), the apccmma.local answer, manual addresses, and
// the scan itself against fake sockets. Only generic synthetic names are used. Run with: node --test electron/tv-cast-discovery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  CAST_SERVICE,
  answerHostnameQuery,
  buildMdnsQuery,
  castDevicesFromRecords,
  createDiscovery,
  parseDeviceDescription,
  parseDnsPacket,
  parseSsdpResponse,
  parseTvAddress,
  ssdpSearch,
} from './tv-cast-discovery.js';
import { hostAllowed } from './lan-guard.js';

const DESCRIPTION = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <URLBase>http://192.168.1.50:49152/</URLBase>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>Sample TV Name &amp; Co</friendlyName>
    <manufacturer>Sample Maker</manufacturer>
    <modelName>Sample Model 1</modelName>
    <UDN>uuid:00000000-0000-0000-0000-000000000001</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
        <controlURL>/render/control</controlURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/upnp/control/avt</controlURL>
      </service>
    </serviceList>
    <deviceList><device><friendlyName>Embedded Thing</friendlyName></device></deviceList>
  </device>
</root>`;

test('an SSDP search names the target, and a response gives its headers', () => {
  const packet = ssdpSearch('urn:schemas-upnp-org:device:MediaRenderer:1').toString('ascii');
  assert.match(packet, /^M-SEARCH \* HTTP\/1\.1\r\n/);
  assert.match(packet, /HOST: 239\.255\.255\.250:1900/);
  assert.match(packet, /MAN: "ssdp:discover"/);
  assert.match(packet, /ST: urn:schemas-upnp-org:device:MediaRenderer:1/);
  const headers = parseSsdpResponse('HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://192.168.1.50:49152/desc.xml\r\nST: urn:x\r\nUSN: uuid:1\r\n\r\n');
  assert.equal(headers.location, 'http://192.168.1.50:49152/desc.xml');
  assert.equal(headers.st, 'urn:x');
  assert.equal(parseSsdpResponse('GET / HTTP/1.1\r\n\r\n'), null);
});

test('a UPnP description gives the TV its real name, maker, model and AVTransport address', () => {
  const info = parseDeviceDescription(DESCRIPTION, 'http://192.168.1.50:49152/desc.xml');
  assert.equal(info.name, 'Sample TV Name & Co');
  assert.equal(info.manufacturer, 'Sample Maker');
  assert.equal(info.model, 'Sample Model 1');
  assert.equal(info.udn, 'uuid:00000000-0000-0000-0000-000000000001');
  assert.equal(info.controlUrl, 'http://192.168.1.50:49152/upnp/control/avt');
  assert.equal(info.serviceType, 'urn:schemas-upnp-org:service:AVTransport:1');
});

test('a relative control address resolves against the description address, and a device with no AVTransport is not a TV for pictures', () => {
  const noBase = DESCRIPTION.replace(/<URLBase>.*<\/URLBase>/, '');
  assert.equal(parseDeviceDescription(noBase, 'http://192.168.1.60:8000/dmr/desc.xml').controlUrl, 'http://192.168.1.60:8000/upnp/control/avt');
  assert.equal(parseDeviceDescription(DESCRIPTION.replace(/AVTransport/g, 'Other'), 'http://192.168.1.50/'), null);
  assert.equal(parseDeviceDescription('not xml', 'http://192.168.1.50/'), null);
});

// --- DNS packets ------------------------------------------------------------------------------------------------------------------

const labels = (name) => Buffer.concat([...name.split('.').map((p) => Buffer.concat([Buffer.from([p.length]), Buffer.from(p)])), Buffer.from([0])]);
const u16 = (n) => Buffer.from([n >> 8, n & 255]);
const u32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const record = (owner, type, rdata) => Buffer.concat([owner, u16(type), u16(0x8001), u32(120), u16(rdata.length), rdata]);
const pointer = (offset) => u16(0xc000 | offset);

/** A Chromecast announcement: PTR, SRV, TXT and A records, with the names compressed the way a real device sends them. */
function castPacket({ fn = 'Sample TV Name', md = 'Sample Cast Model', id = 'abc123', ip = [192, 168, 1, 77], port = 8009 } = {}) {
  const header = Buffer.concat([u16(0), u16(0x8400), u16(0), u16(4), u16(0), u16(0)]);
  const service = labels(CAST_SERVICE);
  const instanceLabel = Buffer.concat([Buffer.from([`Sample-${id}`.length]), Buffer.from(`Sample-${id}`)]);
  // The PTR record owner is at offset 12. Its rdata is the instance label plus a pointer to the service name at 12.
  const ptrRdata = Buffer.concat([instanceLabel, pointer(12)]);
  const ptr = record(service, 12, ptrRdata);
  // The instance name sits inside the PTR record: 12 + service + type/class/ttl/len (10) bytes in.
  const instanceOffset = 12 + service.length + 10;
  const hostName = labels('sample-tv.local');
  const srvRdata = Buffer.concat([u16(0), u16(0), u16(port), pointer(12 + ptr.length + 0)]);
  // The SRV target is its own name. It is written raw below, so the pointer is replaced with the raw name.
  const srv = record(pointer(instanceOffset), 33, Buffer.concat([u16(0), u16(0), u16(port), hostName]));
  void srvRdata;
  const txtEntries = [`id=${id}`, `fn=${fn}`, `md=${md}`].map((e) => Buffer.concat([Buffer.from([e.length]), Buffer.from(e)]));
  const txt = record(pointer(instanceOffset), 16, Buffer.concat(txtEntries));
  const a = record(hostName, 1, Buffer.from(ip));
  return Buffer.concat([header, ptr, srv, txt, a]);
}

test('an mDNS Chromecast announcement gives its name, model, address and port, through compressed names', () => {
  const { records } = parseDnsPacket(castPacket());
  assert.deepEqual(records.map((r) => r.type), [12, 33, 16, 1]);
  assert.equal(records[0].target, `Sample-abc123.${CAST_SERVICE}`);
  assert.equal(records[1].port, 8009);
  assert.equal(records[1].host, 'sample-tv.local');
  assert.equal(records[2].txt.fn, 'Sample TV Name');
  assert.equal(records[3].ip, '192.168.1.77');
  const [device] = castDevicesFromRecords(records);
  assert.deepEqual(device, {
    protocol: 'chromecast',
    id: 'cast:abc123',
    name: 'Sample TV Name',
    manufacturer: 'Google',
    model: 'Sample Cast Model',
    ip: '192.168.1.77',
    port: 8009,
  });
});

test('a Chromecast without its address yet is left out, and a bad or short packet never throws', () => {
  const { records } = parseDnsPacket(castPacket());
  assert.deepEqual(castDevicesFromRecords(records.filter((r) => r.type !== 1)), []);
  assert.deepEqual(parseDnsPacket(Buffer.from([1, 2, 3])).records, []);
  assert.doesNotThrow(() => parseDnsPacket(castPacket().subarray(0, 60)));
  // A pointer that loops on itself is refused instead of running forever.
  const loop = Buffer.concat([u16(0), u16(0), u16(1), u16(0), u16(0), u16(0), pointer(12), u16(1), u16(1)]);
  assert.doesNotThrow(() => parseDnsPacket(loop));
});

test('the _googlecast._tcp query asks for the service by name', () => {
  const { questions } = parseDnsPacket(buildMdnsQuery(CAST_SERVICE, 12));
  assert.deepEqual(questions, [{ name: CAST_SERVICE, type: 12, unicast: true }]);
});

test('apccmma.local is answered with the laptop address, and no other name is', () => {
  const answer = answerHostnameQuery(buildMdnsQuery('apccmma.local', 1), '192.168.1.10');
  const { records } = parseDnsPacket(answer.packet);
  assert.equal(records[0].name, 'apccmma.local');
  assert.equal(records[0].ip, '192.168.1.10');
  assert.equal(answer.unicast, true);
  assert.equal(answerHostnameQuery(buildMdnsQuery('APCCMMA.local', 1, { unicast: false }), '192.168.1.10').unicast, false);
  assert.equal(answerHostnameQuery(buildMdnsQuery('other.local', 1), '192.168.1.10'), null);
  assert.equal(answerHostnameQuery(buildMdnsQuery('apccmma.local', 12), '192.168.1.10'), null);
  assert.equal(answerHostnameQuery(buildMdnsQuery('apccmma.local', 1), 'not-an-ip'), null);
});

test('a TV page request that names apccmma.local is allowed, and a look-alike name is not', () => {
  assert.equal(hostAllowed('apccmma.local:8788', { hostname: 'BOOTH' }), true);
  assert.equal(hostAllowed('apccmma.local.evil.example', { hostname: 'BOOTH' }), false);
  assert.equal(hostAllowed('xapccmma.local', { hostname: 'BOOTH' }), false);
});

test('a typed TV address is checked: an address, an address and port, or a description address; never a public one', () => {
  assert.deepEqual(parseTvAddress('192.168.1.20'), { ip: '192.168.1.20', port: null, url: null });
  assert.deepEqual(parseTvAddress(' 192.168.1.20:8009 '), { ip: '192.168.1.20', port: 8009, url: null });
  assert.equal(parseTvAddress('http://192.168.1.20:49152/desc.xml').port, 49152);
  assert.match(parseTvAddress('8.8.8.8').error, /local network/);
  assert.match(parseTvAddress('http://8.8.8.8/x.xml').error, /local network/);
  assert.match(parseTvAddress('https://192.168.1.20/x.xml').error, /http/);
  assert.ok(parseTvAddress('tv.example').error);
  assert.ok(parseTvAddress('999.1.1.1').error);
  assert.ok(parseTvAddress('192.168.1.20:99999').error);
  assert.ok(parseTvAddress('').error);
});

// --- the scan ---------------------------------------------------------------------------------------------------------------------

/** A fake `dgram`. `onSend(socket, packet, port, address)` can answer by calling `socket.reply(buffer, address)`. */
function fakeDgram(onSend = () => {}) {
  const sockets = [];
  return {
    sockets,
    createSocket() {
      const socket = new EventEmitter();
      socket.sent = [];
      socket.closed = false;
      socket.bind = (port, cb) => {
        socket.port = port;
        setImmediate(cb);
      };
      socket.setMulticastInterface = (address) => (socket.interface = address);
      socket.addMembership = () => {};
      socket.send = (packet, port, address, cb) => {
        socket.sent.push({ packet, port, address });
        setImmediate(() => {
          onSend(socket, packet, port, address);
          cb?.();
        });
      };
      socket.reply = (buffer, from) => socket.emit('message', buffer, { address: from, port: 1900 });
      socket.close = () => (socket.closed = true);
      sockets.push(socket);
      return socket;
    },
  };
}

test('a scan finds a DLNA TV and a Chromecast together, sending out of the Wi-Fi adapter', async () => {
  const fetched = [];
  const dgram = fakeDgram((socket, packet, port) => {
    if (port === 1900 && /MediaRenderer/.test(packet.toString())) {
      socket.reply(Buffer.from('HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.50:49152/desc.xml\r\nST: x\r\n\r\n'), '192.168.1.50');
    }
    if (port === 5353) socket.reply(castPacket(), '192.168.1.77');
  });
  const changes = [];
  const discovery = createDiscovery({
    dgram,
    localAddress: () => '192.168.1.10',
    fetchText: async (url) => {
      fetched.push(url);
      return DESCRIPTION;
    },
    scanMs: 30,
    onChange: (list) => changes.push(list.length),
    log: { warn() {} },
  });
  const list = await discovery.scan();
  assert.deepEqual(list.map((d) => [d.protocol, d.name, d.ip]).sort(), [
    ['chromecast', 'Sample TV Name', '192.168.1.77'],
    ['dlna', 'Sample TV Name & Co', '192.168.1.50'],
  ]);
  assert.deepEqual(fetched, ['http://192.168.1.50:49152/desc.xml'], 'the description is fetched once, even when both targets answer');
  assert.ok(dgram.sockets.every((s) => s.interface === '192.168.1.10' && s.closed), 'multicast leaves by the Wi-Fi adapter and the sockets are closed');
  assert.ok(changes.length >= 2);
  assert.equal(discovery.get('dlna:uuid:00000000-0000-0000-0000-000000000001').controlUrl, 'http://192.168.1.50:49152/upnp/control/avt');
});

test('a TV answering with a description address on another machine is ignored', async () => {
  const dgram = fakeDgram((socket, packet, port) => {
    if (port === 1900) socket.reply(Buffer.from('HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.99:80/desc.xml\r\n\r\n'), '192.168.1.50');
  });
  const discovery = createDiscovery({ dgram, localAddress: () => '192.168.1.10', fetchText: async () => DESCRIPTION, scanMs: 20, log: { warn() {} } });
  assert.deepEqual(await discovery.scan(), []);
});

test('a socket that cannot be opened leaves the scan with no TVs instead of throwing', async () => {
  const dgram = { createSocket: () => { throw new Error('no network'); } };
  const discovery = createDiscovery({ dgram, localAddress: () => null, scanMs: 5, log: { warn() {} } });
  assert.deepEqual(await discovery.scan(), []);
});

test('Add TV by IP: a Chromecast is found on port 8009 and named from its setup page', async () => {
  const discovery = createDiscovery({
    dgram: fakeDgram(),
    localAddress: () => '192.168.1.10',
    probe: async (ip, port) => ip === '192.168.1.80' && port === 8009,
    fetchText: async (url) => {
      assert.equal(url, 'http://192.168.1.80:8008/setup/eureka_info?params=name,device_info');
      return JSON.stringify({ name: 'Sample Cast Room', model_name: 'Sample Dongle' });
    },
    log: { warn() {} },
  });
  const result = await discovery.addByIp('192.168.1.80');
  assert.equal(result.ok, true);
  assert.deepEqual([result.device.name, result.device.model, result.device.protocol, result.device.port], ['Sample Cast Room', 'Sample Dongle', 'chromecast', 8009]);
  assert.equal(discovery.devices().length, 1);
});

test('Add TV by IP: a DLNA description address, or an address and port, is read directly', async () => {
  const asked = [];
  const discovery = createDiscovery({
    dgram: fakeDgram(),
    localAddress: () => '192.168.1.10',
    fetchText: async (url) => {
      asked.push(url);
      if (url.endsWith('/dmr')) return DESCRIPTION;
      throw new Error('404');
    },
    log: { warn() {} },
  });
  const byUrl = await discovery.addByIp('http://192.168.1.50:49152/dmr');
  assert.equal(byUrl.ok, true);
  const byPort = await createDiscovery({ dgram: fakeDgram(), localAddress: () => null, fetchText: async (u) => { if (u.endsWith('/dmr')) return DESCRIPTION; throw new Error('404'); }, log: { warn() {} } }).addByIp('192.168.1.50:49152');
  assert.equal(byPort.ok, true);
  assert.equal(byPort.device.port, 49152);
});

test('Add TV by IP: a plain address with no Chromecast gets a direct SSDP search, and a silent address is reported', async () => {
  const dgram = fakeDgram((socket, packet, port, address) => {
    if (address === '192.168.1.50' && port === 1900) socket.reply(Buffer.from('HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.50:49152/desc.xml\r\n\r\n'), '192.168.1.50');
  });
  const found = await createDiscovery({ dgram, localAddress: () => '192.168.1.10', probe: async () => false, fetchText: async () => DESCRIPTION, log: { warn() {} } }).addByIp('192.168.1.50');
  assert.equal(found.ok, true);
  assert.equal(found.device.manual, true);
  const silent = await createDiscovery({ dgram: fakeDgram(), localAddress: () => '192.168.1.10', probe: async () => false, setTimer: (fn) => setTimeout(fn, 10), log: { warn() {} } }).addByIp('192.168.1.51');
  assert.equal(silent.ok, false);
  assert.match(silent.error, /No TV answered at 192\.168\.1\.51/);
  const publicIp = await createDiscovery({ dgram: fakeDgram(), localAddress: () => null }).addByIp('1.1.1.1');
  assert.equal(publicIp.ok, false);
});

test('the apccmma.local responder answers a multicast question and reports a port it cannot take', async () => {
  const dgram = fakeDgram();
  const discovery = createDiscovery({ dgram, localAddress: () => '192.168.1.10', log: { warn() {} } });
  assert.deepEqual(await discovery.startHostnameResponder(), { ok: true });
  const [socket] = dgram.sockets;
  assert.equal(socket.port, 5353);
  socket.emit('message', buildMdnsQuery('apccmma.local', 1, { unicast: false }), { address: '192.168.1.60', port: 5353 });
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0].address, '224.0.0.251', 'a multicast question gets a multicast answer');
  socket.emit('message', buildMdnsQuery('apccmma.local', 1), { address: '192.168.1.60', port: 40000 });
  assert.equal(socket.sent[1].address, '192.168.1.60', 'a unicast question gets a direct answer');
  socket.emit('message', buildMdnsQuery('other.local', 1), { address: '192.168.1.60', port: 5353 });
  assert.equal(socket.sent.length, 2);
  discovery.stopHostnameResponder();
  assert.equal(socket.closed, true);
  assert.equal(discovery.hostnameStatus().running, false);

  const taken = { createSocket() { const s = fakeDgram().createSocket(); s.bind = () => setImmediate(() => s.emit('error', new Error('EADDRINUSE'))); return s; } };
  const blocked = createDiscovery({ dgram: taken, localAddress: () => '192.168.1.10', log: { warn() {} } });
  const result = await blocked.startHostnameResponder();
  assert.equal(result.ok, false);
  assert.match(blocked.hostnameStatus().note, /apccmma\.local could not start/);
});
