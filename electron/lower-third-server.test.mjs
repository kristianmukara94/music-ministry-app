// The browser source server: the local network only, reached by this laptop's own address or name, with no file outside the build and a cap on
// live connections. Also the checks it shares with Remote view (lan-guard.js). Run with: node --test electron/lower-third-server.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createLowerThirdServer } from './lower-third-server.js';
import { hostAllowed, isPrivateAddress } from './lan-guard.js';

test('the local network is recognised, and the internet is not', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.137.20', '172.16.0.1', '172.31.255.255', '169.254.10.1', '::1', 'fd12::1', 'fe80::1', '::ffff:192.168.1.9']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '100.64.0.1', '2001:4860:4860::8888', '::ffff:8.8.8.8', '', undefined, 'not-an-ip']) {
    assert.equal(isPrivateAddress(ip), false, String(ip));
  }
});

test('a request must name this laptop', () => {
  const host = (value) => hostAllowed(value, { hostname: 'BOOTH-LAPTOP' });
  for (const value of ['192.168.1.5:8787', '127.0.0.1', '[::1]:3002', 'localhost:3002', 'LOCALHOST', 'booth-laptop:8787', 'booth-laptop.local', undefined, '']) {
    assert.equal(host(value), true, String(value));
  }
  for (const value of ['evil.example', 'evil.example:8787', '192.168.1.5.evil.example', 'booth-laptop.evil.example', 'localhost.evil.example']) {
    assert.equal(host(value), false, value);
  }
});

function makeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lower-third-test-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>page');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'void 0;');
  fs.writeFileSync(path.join(path.dirname(dir), 'lower-third-outside.txt'), 'outside the build');
  return dir;
}

let nextPort = 39000 + Math.floor(Math.random() * 2000);

async function withServer(work) {
  const port = (nextPort += 1);
  const server = createLowerThirdServer({ distDir: makeDist(), port, host: '127.0.0.1' });
  assert.equal(await server.start(), true);
  try {
    await work(port, server);
  } finally {
    await server.stop();
  }
}

function get(port, target, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('an expired license refuses the stream but leaves the page blank rather than broken', async () => {
  const port = (nextPort += 1);
  let expired = true;
  const server = createLowerThirdServer({ distDir: makeDist(), port, host: '127.0.0.1', isExpired: () => expired });
  assert.equal(await server.start(), true);
  try {
    const refused = await get(port, '/api/lower-third/stream');
    assert.equal(refused.status, 403);
    assert.equal(refused.text, 'Church License Expired');
    assert.equal((await get(port, '/lower-third')).status, 200, 'no error text can reach a live broadcast');
    expired = false;
    const open = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/lower-third/stream' }, (res) => {
        resolve(res.statusCode);
        req.destroy();
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(open, 200, 'a renewal opens it again');
  } finally {
    await server.stop();
  }
});

test('the page and its files are served, by address', async () => {
  await withServer(async (port) => {
    assert.match((await get(port, '/lower-third')).text, /page/);
    assert.equal((await get(port, '/lower-third/assets/app.js')).status, 200);
  });
});

test('a page reached through someone else\'s domain gets nothing', async () => {
  await withServer(async (port) => {
    assert.equal((await get(port, '/lower-third', { Host: 'evil.example' })).status, 403);
    assert.equal((await get(port, '/api/lower-third/stream', { Host: 'evil.example' })).status, 403);
  });
});

test('nothing outside the build folder can be read', async () => {
  await withServer(async (port) => {
    assert.equal((await get(port, '/../lower-third-outside.txt')).status, 404);
    assert.equal((await get(port, '/%2e%2e/lower-third-outside.txt')).status, 404);
    assert.equal((await get(port, '/..%5clower-third-outside.txt')).status, 404);
    assert.equal((await get(port, '/C:%5CWindows%5Cwin.ini')).status, 404);
  });
});

test('only reading is allowed', async () => {
  await withServer(async (port) => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/lower-third' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 405);
  });
});

test('live connections are capped, so a flood cannot use up the laptop', async () => {
  await withServer(async (port) => {
    const open = [];
    const connect = () =>
      new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/api/lower-third/stream', agent: false }, (res) => {
          open.push(req);
          res.on('error', () => {});
          res.resume();
          resolve(res.statusCode);
        });
        req.on('error', reject);
      });
    try {
      for (let i = 0; i < 32; i += 1) assert.equal(await connect(), 200, `connection ${i + 1}`);
      assert.equal(await connect(), 503);
    } finally {
      for (const req of open) {
        req.on('error', () => {});
        req.destroy();
      }
    }
  });
});

test('the parish logo is served when there is one, and a 404 lets the page fall back to the emblem', async () => {
  const port = (nextPort += 1);
  let logo = null;
  const logoFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lower-third-logo-')), 'church-logo.png');
  fs.writeFileSync(logoFile, 'png bytes');
  const server = createLowerThirdServer({ distDir: makeDist(), port, host: '127.0.0.1', churchLogoFile: () => logo });
  assert.equal(await server.start(), true);
  try {
    assert.equal((await get(port, '/api/church-logo?v=1')).status, 404);
    logo = logoFile;
    const served = await get(port, '/api/church-logo?v=2');
    assert.equal(served.status, 200);
    assert.equal(served.text, 'png bytes');
    assert.equal((await get(port, '/api/church-logo', { Host: 'evil.example' })).status, 403, 'the same host check applies');
  } finally {
    await server.stop();
  }
});
