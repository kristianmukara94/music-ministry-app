// The Secondary stream sends the screen at once: a new connection gets the current screen, and turning Remote live on sends the projector's
// frame to every open stream. A change that leaves the TV's screen the same sends nothing. The server runs for real, and the state changes
// go through the live reducer, as the main process applies them. Run with: node --test electron/remote-view-broadcaster.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRemoteViewServer } from './remote-view-server.js';
import { initialLiveState, liveReducer } from '../shared/live.js';
import { secondaryViewSnapshot } from '../shared/remote-view.js';

const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-broadcast-dist-'));
const TEXT = { kind: 'text', title: 'Notice', text: 'Welcome', bg: null };
const run = (state, ...actions) => actions.reduce((s, a) => liveReducer(s, a), state);

/** The projector is on and shows a frame; the secondary display is still off. Dual mode, so the secondary mirrors the projector. */
const withProjectorFrame = () => run(initialLiveState(), { type: 'output/toggle', output: 'projector' }, { type: 'projector/show', frame: TEXT, source: 'DIRECT_DECK' });

/**
 * Opens the Secondary stream and collects each `data:` event as it arrives. `next(ms)` gives the next event, or 'quiet' when none
 * arrives in time. A timed-out wait removes itself, so it cannot take a later event.
 */
function openStream(base) {
  const events = [];
  const waiting = [];
  const req = http.get(`${base}/api/remote/stream`, (res) => {
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const line = block.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const data = JSON.parse(line.slice('data: '.length));
        if (waiting.length) waiting.shift()(data);
        else events.push(data);
      }
    });
  });
  return {
    req,
    next(ms = 2000) {
      if (events.length) return Promise.resolve(events.shift());
      return new Promise((resolve) => {
        const waiter = (data) => {
          clearTimeout(timer);
          resolve(data);
        };
        const timer = setTimeout(() => {
          const at = waiting.indexOf(waiter);
          if (at >= 0) waiting.splice(at, 1);
          resolve('quiet');
        }, ms);
        waiting.push(waiter);
      });
    },
  };
}

async function startSecondary() {
  const server = createRemoteViewServer({ distDir: DIST, role: 'secondary' });
  const result = await server.start({ host: '127.0.0.1', port: 0, pin: null });
  assert.equal(result.ok, true);
  return { server, base: `http://127.0.0.1:${result.port}` };
}

test('opening the stream receives the current screen at once, before any change', async () => {
  const { server, base } = await startSecondary();
  server.push(secondaryViewSnapshot(withProjectorFrame()));
  const stream = openStream(base);
  try {
    const first = await stream.next();
    assert.notEqual(first, 'quiet', 'the first event arrives without waiting for a change');
    assert.equal(first.live, false);
    assert.equal(first.frame.kind, 'off', 'the secondary is off until Remote live is turned on');
  } finally {
    stream.req.destroy();
    await server.stop();
  }
});

test('turning Remote live on sends the projector frame to the open stream at once', async () => {
  const { server, base } = await startSecondary();
  let state = withProjectorFrame();
  server.push(secondaryViewSnapshot(state));
  const stream = openStream(base);
  try {
    assert.equal((await stream.next()).live, false);

    state = run(state, { type: 'display/live', value: true });
    server.push(secondaryViewSnapshot(state));
    const live = await stream.next();
    assert.notEqual(live, 'quiet', 'the change is written to the open stream');
    assert.equal(live.live, true);
    assert.equal(live.frame.kind, 'slide');
    assert.deepEqual(live.frame.lines, ['Welcome'], 'the TV shows the projector frame in dual mode');
  } finally {
    stream.req.destroy();
    await server.stop();
  }
});

test('a change that leaves the TV screen the same sends nothing', async () => {
  const { server, base } = await startSecondary();
  let state = run(withProjectorFrame(), { type: 'display/live', value: true });
  server.push(secondaryViewSnapshot(state));
  const stream = openStream(base);
  try {
    assert.equal((await stream.next()).live, true);

    // The same screen again, a later time: only the timestamp differs, so nothing is written.
    server.push({ ...secondaryViewSnapshot(state), updatedAt: Date.now() + 1000 });
    assert.equal(await stream.next(300), 'quiet', 'an unchanged screen is not sent again');

    // A change to the screen does reach the TV, so the de-duplication is not blocking real changes.
    state = run(state, { type: 'projector/clear' });
    server.push(secondaryViewSnapshot(state));
    assert.notEqual(await stream.next(), 'quiet', 'a changed screen is sent');
  } finally {
    stream.req.destroy();
    await server.stop();
  }
});
