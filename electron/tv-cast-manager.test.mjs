// Nearby TV Cast: the DLNA and Chromecast clients against fakes, and the session manager casting to several TVs at once on mixed feeds, with the
// debounce, one push in flight per TV, per-TV disconnect, Stop All and the picture server. Generic synthetic names only.
// Run with: node --test electron/tv-cast-manager.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCastClient, createDlnaClient, decodeCastMessages, didlLite, encodeCastMessage, soapEnvelope } from './tv-cast-clients.js';
import { createTvCastManager, DEBOUNCE_MS } from './tv-cast-manager.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await tick();
      }
      now = end;
      await tick();
    },
    now: () => now,
    pending: () => timers.size,
  };
}

// --- DLNA -------------------------------------------------------------------------------------------------------------------------

test('a DLNA TV is sent SetAVTransportURI with JPEG_LRG metadata, then Play', async () => {
  const calls = [];
  const device = { controlUrl: 'http://192.168.1.50:49152/upnp/control/avt', serviceType: 'urn:schemas-upnp-org:service:AVTransport:1' };
  const client = createDlnaClient({ device, request: async (call) => (calls.push(call), { status: 200 }) });
  await client.show('http://192.168.1.10:5000/cast/frame/projector.jpg?v=3&k=abc');
  assert.deepEqual(calls.map((c) => c.action), ['urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI', 'urn:schemas-upnp-org:service:AVTransport:1#Play']);
  assert.equal(calls[0].url, device.controlUrl);
  assert.match(calls[0].body, /<CurrentURI>http:\/\/192\.168\.1\.10:5000\/cast\/frame\/projector\.jpg\?v=3&amp;k=abc<\/CurrentURI>/);
  // The metadata is escaped text inside the SOAP body, so the DIDL-Lite appears with its angle brackets as entities.
  assert.match(calls[0].body, /<CurrentURIMetaData>&lt;DIDL-Lite /);
  assert.match(calls[0].body, /DLNA\.ORG_PN=JPEG_LRG/);
  assert.match(calls[1].body, /<Speed>1<\/Speed>/);
  await client.stop();
  assert.match(calls[2].action, /#Stop$/);
});

test('DIDL-Lite and SOAP escape what goes into them', () => {
  assert.match(didlLite('http://192.168.1.10/a?x=1&y=2', 'A <b> title'), /A &lt;b&gt; title/);
  assert.match(soapEnvelope('urn:x:service:AVTransport:1', 'Play', { InstanceID: 0, Speed: '1<2' }), /<Speed>1&lt;2<\/Speed>/);
});

test('a DLNA TV that refuses an action says so, and Stop on an unreachable TV does not throw', async () => {
  const client = createDlnaClient({ device: { controlUrl: 'http://192.168.1.50/x' }, request: async () => ({ status: 500 }) });
  await assert.rejects(() => client.show('http://192.168.1.10/f.jpg'), /refused SetAVTransportURI \(500\)/);
  const down = createDlnaClient({ device: { controlUrl: 'http://192.168.1.50/x' }, request: async () => { throw new Error('unreachable'); } });
  await assert.doesNotReject(() => down.stop());
});

// --- Chromecast -------------------------------------------------------------------------------------------------------------------

function fakeTls() {
  const sockets = [];
  const factory = () => {
    const socket = new EventEmitter();
    socket.written = [];
    socket.destroyed = false;
    socket.write = (buf) => socket.written.push(buf);
    socket.end = () => {};
    socket.destroy = () => (socket.destroyed = true);
    socket.sent = () => socket.written.flatMap((b) => decodeCastMessages(b).messages);
    socket.receive = (message) => socket.emit('data', encodeCastMessage({ source: 'receiver-0', destination: 'sender-0', ...message }));
    sockets.push(socket);
    return socket;
  };
  return { sockets, factory };
}

const STATUS_WITH_APP = { namespace: 'urn:x-cast:com.google.cast.receiver', payload: { type: 'RECEIVER_STATUS', status: { applications: [{ appId: 'CC1AD845', transportId: 'web-9', sessionId: 'session-9' }] } } };

test('a Chromecast connects, launches the Default Media Receiver, and loads the newest picture', async () => {
  const net = fakeTls();
  const clock = fakeClock();
  const states = [];
  const client = createCastClient({ device: { ip: '192.168.1.77', port: 8009 }, tlsConnect: net.factory, ...clock, onStatus: (s) => states.push(s), log: { warn() {} } });
  await client.show('http://192.168.1.10:5000/cast/frame/projector.jpg?v=1&k=abc');
  const [socket] = net.sockets;
  socket.emit('secureConnect');
  const sent = socket.sent();
  assert.deepEqual(sent.slice(0, 3).map((m) => [m.destination, m.payload.type]), [['receiver-0', 'CONNECT'], ['receiver-0', 'GET_STATUS'], ['receiver-0', 'LAUNCH']]);
  assert.equal(sent[2].payload.appId, 'CC1AD845');
  socket.receive(STATUS_WITH_APP);
  const after = socket.sent().slice(3);
  assert.deepEqual(after.map((m) => [m.destination, m.payload.type]), [['web-9', 'CONNECT'], ['web-9', 'LOAD']]);
  assert.equal(after[1].payload.media.contentId, 'http://192.168.1.10:5000/cast/frame/projector.jpg?v=1&k=abc');
  assert.equal(after[1].payload.media.contentType, 'image/jpeg');
  assert.equal(after[1].payload.sessionId, 'session-9');
  assert.ok(states.includes('casting'));
  // A new frame is a new LOAD on the same session.
  await client.show('http://192.168.1.10:5000/cast/frame/projector.jpg?v=2&k=abc');
  assert.match(socket.sent().at(-1).payload.media.contentId, /v=2/);
  assert.equal(socket.sent().at(-1).payload.type, 'LOAD');
});

test('a Chromecast answers PING with PONG, sends its own heartbeat, and stops with a receiver STOP', async () => {
  const net = fakeTls();
  const clock = fakeClock();
  const client = createCastClient({ device: { ip: '192.168.1.77' }, tlsConnect: net.factory, ...clock, log: { warn() {} } });
  await client.show('http://x/1');
  const [socket] = net.sockets;
  socket.emit('secureConnect');
  socket.receive({ namespace: 'urn:x-cast:com.google.cast.tp.heartbeat', payload: { type: 'PING' } });
  assert.equal(socket.sent().at(-1).payload.type, 'PONG');
  await clock.advance(5000);
  assert.equal(socket.sent().filter((m) => m.payload.type === 'PING').length, 1);
  socket.receive(STATUS_WITH_APP);
  await client.stop();
  const stop = socket.sent().at(-1);
  assert.deepEqual([stop.destination, stop.payload.type, stop.payload.sessionId], ['receiver-0', 'STOP', 'session-9']);
});

test('a Chromecast that drops off Wi-Fi reconnects with a growing wait, and an explicit disconnect ends the retries', async () => {
  const net = fakeTls();
  const clock = fakeClock();
  const states = [];
  const client = createCastClient({ device: { ip: '192.168.1.77' }, tlsConnect: net.factory, ...clock, onStatus: (s, d) => states.push([s, d]), log: { warn() {} } });
  await client.show('http://x/1');
  net.sockets[0].emit('secureConnect');
  net.sockets[0].emit('close');
  assert.equal(states.at(-1)[0], 'reconnecting');
  assert.equal(net.sockets.length, 1);
  await clock.advance(1000);
  assert.equal(net.sockets.length, 2, 'the first retry comes after 1 second');
  net.sockets[1].emit('error', new Error('ECONNRESET'));
  await clock.advance(1999);
  assert.equal(net.sockets.length, 2);
  await clock.advance(1);
  assert.equal(net.sockets.length, 3, 'the second wait is 2 seconds');
  net.sockets[2].emit('secureConnect');
  net.sockets[2].receive(STATUS_WITH_APP);
  assert.equal(net.sockets[2].sent().at(-1).payload.type, 'LOAD', 'the picture is loaded again once the receiver is back');
  client.close();
  net.sockets[2].emit('close');
  await clock.advance(60000);
  assert.equal(net.sockets.length, 3, 'no more attempts after Disconnect');
});

test('a Chromecast that stops answering is dropped after the silence limit', async () => {
  const net = fakeTls();
  const clock = fakeClock();
  const states = [];
  const client = createCastClient({ device: { ip: '192.168.1.77' }, tlsConnect: net.factory, ...clock, onStatus: (s) => states.push(s), log: { warn() {} } });
  await client.show('http://x/1');
  net.sockets[0].emit('secureConnect');
  await clock.advance(15000);
  await clock.advance(5000);
  assert.ok(net.sockets[0].destroyed);
  assert.ok(states.includes('reconnecting'));
});

test('the CastMessage codec round-trips and keeps a partial frame for later', () => {
  const frame = encodeCastMessage({ source: 'sender-0', destination: 'receiver-0', namespace: 'urn:x-cast:com.google.cast.tp.heartbeat', payload: { type: 'PING', note: 'Sample Verse Line' } });
  const half = decodeCastMessages(frame.subarray(0, frame.length - 3));
  assert.equal(half.messages.length, 0);
  const whole = decodeCastMessages(Buffer.concat([half.rest, frame.subarray(frame.length - 3)]));
  assert.equal(whole.messages[0].payload.note, 'Sample Verse Line');
  assert.equal(whole.messages[0].namespace, 'urn:x-cast:com.google.cast.tp.heartbeat');
  assert.equal(decodeCastMessages(Buffer.from([0x7f, 0xff, 0xff, 0xff, 1])).rest.length, 0, 'an absurd length drops the buffer');
});

// --- the manager ------------------------------------------------------------------------------------------------------------------

/** Three TVs (two DLNA, one Chromecast) and a manager whose clients and renderer are fakes. `world.version` is what the screen shows. */
async function makeManager({ expired = false } = {}) {
  const clock = fakeClock();
  const tvs = [
    { id: 'dlna:a', protocol: 'dlna', name: 'Sample TV Name A', ip: '192.168.1.51', controlUrl: 'http://192.168.1.51/c' },
    { id: 'dlna:b', protocol: 'dlna', name: 'Sample TV Name B', ip: '192.168.1.52', controlUrl: 'http://192.168.1.52/c' },
    { id: 'cast:c', protocol: 'chromecast', name: 'Sample TV Name C', ip: '192.168.1.53', port: 8009 },
  ];
  const world = { version: 'Sample Slide Title 1', captures: [], clients: new Map(), expired, blocked: new Set(), changes: 0 };
  const discovery = { devices: () => tvs, get: (id) => tvs.find((t) => t.id === id) ?? null, isScanning: () => false, hostnameStatus: () => ({ running: false, note: null }) };
  const fakeClient = (device, protocol, hooks = {}) => {
    const client = {
      protocol,
      shown: [],
      stopped: 0,
      closed: 0,
      hold: null,
      async show(url) {
        client.shown.push(url);
        if (world.blocked.has(device.id)) await new Promise((resolve) => (client.hold = resolve));
        if (protocol === 'chromecast') hooks.onStatus?.('casting');
      },
      async stop() {
        client.stopped += 1;
        if (world.hangOnStop) await new Promise(() => {});
      },
      close() {
        client.closed += 1;
      },
    };
    world.clients.set(device.id, client);
    return client;
  };
  const manager = createTvCastManager({
    discovery,
    address: () => '127.0.0.1',
    isExpired: () => world.expired,
    captureFrame: async (feed) => {
      world.captures.push(feed);
      return Buffer.from(`${feed}:${world.version}`);
    },
    makeDlna: (device) => fakeClient(device, 'dlna'),
    makeCast: (device, hooks) => fakeClient(device, 'chromecast', hooks),
    onChange: () => (world.changes += 1),
    log: { warn() {} },
    ...clock,
  });
  return { manager, world, clock, tvs };
}

const frameSeq = (url) => Number(new URL(url).searchParams.get('v'));

test('three TVs cast at once: the Projector on two and the Stage Mirror on one, each fed its own frame', async () => {
  const { manager, world } = await makeManager();
  try {
    assert.equal((await manager.castTo('dlna:a', { feed: 'projector' })).ok, true);
    assert.equal((await manager.castTo('dlna:b', { feed: 'projector' })).ok, true);
    assert.equal((await manager.castTo('cast:c', { feed: 'stage' })).ok, true);
    await tick();
    const status = manager.status();
    assert.equal(status.casting, 3);
    assert.deepEqual(status.tvs.map((t) => [t.name, t.feed, t.state]), [
      ['Sample TV Name A', 'projector', 'casting'],
      ['Sample TV Name B', 'projector', 'casting'],
      ['Sample TV Name C', 'stage', 'casting'],
    ]);
    assert.deepEqual(world.captures.sort(), ['projector', 'stage'], 'each feed is rendered once, however many TVs share it');
    const urlOf = (id) => world.clients.get(id).shown.at(-1);
    assert.match(urlOf('dlna:a'), /\/cast\/frame\/projector\.jpg\?v=1&k=/);
    assert.equal(urlOf('dlna:a'), urlOf('dlna:b'), 'two TVs on the Projector share one picture');
    assert.match(urlOf('cast:c'), /\/cast\/frame\/stage\.jpg\?v=1&k=/);

    // The picture server serves each feed with the headers a DLNA TV asks for.
    const projector = await fetch(urlOf('dlna:a'));
    assert.equal(projector.status, 200);
    assert.equal(projector.headers.get('content-type'), 'image/jpeg');
    assert.match(projector.headers.get('contentfeatures.dlna.org'), /DLNA\.ORG_PN=JPEG_LRG/);
    assert.equal(projector.headers.get('transfermode.dlna.org'), 'Interactive');
    assert.equal(await projector.text(), 'projector:Sample Slide Title 1');
    assert.equal(await (await fetch(urlOf('cast:c'))).text(), 'stage:Sample Slide Title 1');
    const head = await fetch(urlOf('dlna:a'), { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), String('projector:Sample Slide Title 1'.length));
  } finally {
    await manager.shutdown();
  }
});

test('the picture server refuses a request without the key, another path, or an expired licence', async () => {
  const { manager, world } = await makeManager();
  try {
    await manager.castTo('dlna:a');
    const good = world.clients.get('dlna:a').shown.at(-1);
    const noKey = good.replace(/&k=.*/, '');
    assert.equal((await fetch(noKey)).status, 404);
    assert.equal((await fetch(good.replace('/frame/projector.jpg', '/frame/other.jpg'))).status, 404);
    assert.equal((await fetch(good, { method: 'POST' })).status, 405);
    world.expired = true;
    const expired = await fetch(good);
    assert.equal(expired.status, 403);
    assert.equal(await expired.text(), 'Church License Expired');
    assert.equal((await manager.castTo('dlna:b')).error, 'Church License Expired');
  } finally {
    await manager.shutdown();
  }
});

test('the MJPEG stream sends the current frame and each new one', async () => {
  const { manager, world, clock } = await makeManager();
  try {
    await manager.castTo('dlna:a');
    const url = world.clients.get('dlna:a').shown.at(-1).replace('/frame/projector.jpg', '/stream/projector.mjpeg').replace(/\?v=\d+&/, '?');
    const res = await fetch(url);
    assert.match(res.headers.get('content-type'), /^multipart\/x-mixed-replace; boundary=/);
    const reader = res.body.getReader();
    const first = Buffer.from((await reader.read()).value).toString();
    assert.match(first, /Content-Type: image\/jpeg/);
    assert.match(first, /projector:Sample Slide Title 1/);
    world.version = 'Sample Slide Title 2';
    manager.frameChanged();
    await clock.advance(DEBOUNCE_MS);
    const second = Buffer.from((await reader.read()).value).toString();
    assert.match(second, /projector:Sample Slide Title 2/);
    await reader.cancel();
  } finally {
    await manager.shutdown();
  }
});

test('rapid slide changes are debounced into one render, and only a changed picture reaches the TVs', async () => {
  const { manager, world, clock } = await makeManager();
  try {
    await manager.castTo('dlna:a', { feed: 'projector' });
    await manager.castTo('cast:c', { feed: 'stage' });
    await tick();
    world.captures.length = 0;
    const shownBefore = world.clients.get('dlna:a').shown.length;
    for (let i = 0; i < 6; i += 1) {
      world.version = `Sample Slide Title ${i + 2}`;
      manager.frameChanged();
      await clock.advance(20);
    }
    assert.equal(world.captures.length, 0, 'nothing renders while the clicks keep coming');
    await clock.advance(DEBOUNCE_MS);
    assert.deepEqual(world.captures.sort(), ['projector', 'stage'], 'one render per feed after the quiet spell');
    assert.equal(world.clients.get('dlna:a').shown.length, shownBefore + 1);
    assert.equal(frameSeq(world.clients.get('dlna:a').shown.at(-1)), 2);
    // The same picture again: rendered, but not sent, and the sequence does not move.
    manager.frameChanged();
    await clock.advance(DEBOUNCE_MS);
    assert.equal(world.clients.get('dlna:a').shown.length, shownBefore + 1);
    assert.equal(manager.frame('projector').seq, 2);
  } finally {
    await manager.shutdown();
  }
});

test('a slow TV gets only its newest frame, and never holds another TV up', async () => {
  const { manager, world, clock } = await makeManager();
  try {
    await manager.castTo('dlna:a');
    await manager.castTo('dlna:b');
    await tick();
    world.blocked.add('dlna:a');
    const slow = world.clients.get('dlna:a');
    const fast = world.clients.get('dlna:b');
    for (const n of [2, 3, 4]) {
      world.version = `Sample Slide Title ${n}`;
      manager.frameChanged();
      await clock.advance(DEBOUNCE_MS);
    }
    assert.equal(slow.shown.length, 2, 'one push is stuck in flight, and the later frames wait behind it');
    assert.equal(fast.shown.length, 4, 'the other TV received every frame');
    world.blocked.delete('dlna:a');
    slow.hold();
    await tick();
    await tick();
    assert.equal(slow.shown.length, 3, 'it then gets one catch-up push');
    assert.equal(frameSeq(slow.shown.at(-1)), 4, 'with the newest frame, not the ones in between');
  } finally {
    await manager.shutdown();
  }
});

test('one TV is disconnected on its own and the others keep casting', async () => {
  const { manager, world } = await makeManager();
  try {
    await manager.castTo('dlna:a');
    await manager.castTo('dlna:b');
    await manager.castTo('cast:c', { feed: 'stage' });
    await manager.disconnect('dlna:b');
    const gone = world.clients.get('dlna:b');
    assert.deepEqual([gone.stopped, gone.closed], [1, 1]);
    assert.equal(manager.status().casting, 2);
    assert.equal(manager.status().tvs.find((t) => t.id === 'dlna:b').state, 'ready');
    assert.equal(world.clients.get('dlna:a').stopped, 0);
    world.version = 'Sample Slide Title 9';
    const before = gone.shown.length;
    await manager.refresh('projector');
    assert.equal(gone.shown.length, before, 'a disconnected TV is sent nothing more');
    assert.ok(world.clients.get('dlna:a').shown.length > 1);
  } finally {
    await manager.shutdown();
  }
});

test('Stop All stops every TV in parallel, and a TV that never answers cannot hold it past the cap', async () => {
  const { manager, world, clock } = await makeManager();
  try {
    await manager.castAll();
    assert.equal(manager.status().casting, 3);
    world.hangOnStop = true;
    const stopping = manager.stopAll({ timeoutMs: 1500 });
    await tick();
    let finished = false;
    void stopping.then(() => (finished = true));
    await clock.advance(1499);
    assert.equal(finished, false);
    await clock.advance(1);
    await stopping;
    assert.equal(finished, true);
    assert.deepEqual([...world.clients.values()].map((c) => [c.stopped, c.closed]), [[1, 1], [1, 1], [1, 1]]);
    assert.equal(manager.status().casting, 0);
    assert.equal(manager.activeCount(), 0);
  } finally {
    await manager.shutdown();
  }
});

test('changing a TV feed while it casts sends it the other feed at once', async () => {
  const { manager, world } = await makeManager();
  try {
    await manager.castTo('dlna:a', { feed: 'projector' });
    assert.match(world.clients.get('dlna:a').shown.at(-1), /projector\.jpg/);
    assert.equal((await manager.setFeed('dlna:a', 'stage')).ok, true);
    await tick();
    assert.match(world.clients.get('dlna:a').shown.at(-1), /stage\.jpg/);
    assert.equal(manager.status().tvs[0].feed, 'stage');
    assert.equal((await manager.setFeed('dlna:a', 'nonsense')).ok, false);
    // A TV that is not casting remembers its feed for the next Cast.
    await manager.setFeed('dlna:b', 'stage');
    await manager.castTo('dlna:b');
    assert.match(world.clients.get('dlna:b').shown.at(-1), /stage\.jpg/);
  } finally {
    await manager.shutdown();
  }
});

test('a TV that fails shows its message and recovers on the next frame; an unknown TV is refused', async () => {
  const { manager, world, clock } = await makeManager();
  try {
    await manager.castTo('dlna:a');
    await tick();
    const client = world.clients.get('dlna:a');
    const original = client.show;
    client.show = async () => {
      throw new Error('The TV refused Play (500).');
    };
    world.version = 'Sample Slide Title 2';
    manager.frameChanged();
    await clock.advance(DEBOUNCE_MS);
    const failing = manager.status().tvs.find((t) => t.id === 'dlna:a');
    assert.deepEqual([failing.state, failing.error], ['error', 'The TV refused Play (500).']);
    client.show = original;
    world.version = 'Sample Slide Title 3';
    manager.frameChanged();
    await clock.advance(DEBOUNCE_MS);
    assert.equal(manager.status().tvs.find((t) => t.id === 'dlna:a').state, 'casting');
    assert.match((await manager.castTo('missing')).error, /not in the list/);
  } finally {
    await manager.shutdown();
  }
});

test('with no network address nothing starts, and the reason is given', async () => {
  const manager = createTvCastManager({
    discovery: { devices: () => [], get: () => ({ id: 'dlna:a', protocol: 'dlna', ip: '192.168.1.51' }), isScanning: () => false },
    address: () => null,
    captureFrame: async () => Buffer.from('x'),
    makeDlna: () => ({ protocol: 'dlna', show: async () => {}, stop: async () => {}, close() {} }),
  });
  const result = await manager.castTo('dlna:a');
  assert.equal(result.ok, false);
  assert.match(result.error, /No WiFi or local network/);
});
