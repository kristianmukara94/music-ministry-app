// Tests for the cloud address: the default, the overrides, the checks on what the operator types, saving without touching the link, and
// what reaches config.json. Run with: node --test electron/cloud-address.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CLOUD_ADDRESS, checkCloudAddress, resolveCloudAddress, saveCloudAddress } from './cloud-address.js';
import { readConfig, writeConfig } from './config.js';
import { createCloudDevice } from './cloud-device.js';

const TOKEN = 'device-token-value-that-must-never-leak-0123456789';
const OLD = 'https://old.example.test';
const NEW = 'https://new.example.test';

function realisticStorage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, c.update(text, 'utf8'), c.final(), c.getAuthTag()]);
    },
    decryptString(b) {
      const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(b.length - 16));
      return Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString('utf8');
    },
  };
}
const memoryFile = () => {
  let blob = null;
  return { read: () => blob, write: (b) => (blob = Buffer.from(b)), remove: () => (blob = null), get raw() { return blob; } };
};
const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

/** A fake cloud that records which address each call went to, and answers the link and status calls. */
function recordingFetch(calls) {
  return async (url, opts = {}) => {
    calls.push({ url, auth: opts.headers?.Authorization ?? null });
    if (url.endsWith('/link-redeem')) return respond(201, { token: TOKEN, churchName: 'St Mary', adminName: 'Boss', deviceLabel: 'Booth' });
    if (url.endsWith('/device-status')) return respond(200, { churchName: 'St Mary', adminName: 'Boss', deviceLabel: 'Booth', lastSeenAt: '2026-10-27T12:00:00.000Z' });
    return respond(404, { error: 'Not found.' });
  };
}

test('with nothing set, the default is the Vercel address', () => {
  assert.equal(DEFAULT_CLOUD_ADDRESS, 'https://music-ministry-app.vercel.app');
  assert.equal(resolveCloudAddress({ env: undefined, config: '' }), 'https://music-ministry-app.vercel.app');
  assert.equal(resolveCloudAddress({}), 'https://music-ministry-app.vercel.app');
});

test('the environment variable overrides the default, and the saved address', () => {
  assert.equal(resolveCloudAddress({ env: 'https://env.example.test', config: NEW }), 'https://env.example.test');
});

test('the saved address overrides the default when there is no environment variable', () => {
  assert.equal(resolveCloudAddress({ env: '', config: NEW }), NEW);
});

test('an invalid environment variable is ignored, and the saved address is used', () => {
  assert.equal(resolveCloudAddress({ env: 'http://evil.example.test', config: NEW }), NEW);
  assert.equal(resolveCloudAddress({ env: 'ftp://files.example.test', config: '' }), DEFAULT_CLOUD_ADDRESS);
});

test('an https address is accepted, with the trailing slash removed', () => {
  assert.deepEqual(checkCloudAddress('https://music-ministry-app.vercel.app/'), { ok: true, address: 'https://music-ministry-app.vercel.app' });
});

test('http is accepted for localhost only', () => {
  assert.equal(checkCloudAddress('http://localhost:8888').ok, true);
  assert.equal(checkCloudAddress('http://127.0.0.1:8888').ok, true);
  const refused = checkCloudAddress('http://church.example.test');
  assert.equal(refused.ok, false);
  assert.equal(refused.message, 'The cloud address must start with https://. Only localhost may use http://.');
});

test('other schemes, user names, queries, empty and overlong addresses are refused with plain messages', () => {
  for (const bad of ['ftp://files.example.test', 'javascript:alert(1)', 'https://user:pass@church.example.test', `https://church.example.test/?x=${TOKEN}`, 'https://church.example.test/#frag', '', 'https://' + 'a'.repeat(250) + '.example.test']) {
    const result = checkCloudAddress(bad);
    assert.equal(result.ok, false, `${bad.slice(0, 30)} is refused`);
    assert.equal(typeof result.message, 'string');
    assert.equal(result.message.includes(TOKEN), false, 'the refusal does not echo the input');
  }
  assert.equal(checkCloudAddress('not a web address').ok, false);
});

test('saving an address changes only cloud_url, and no token can be part of what is saved', () => {
  const saved = saveCloudAddress(NEW);
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.patch, { cloud_url: NEW });
  assert.equal(JSON.stringify(saved).includes(TOKEN), false);
  assert.equal(saveCloudAddress('http://evil.example.test').ok, false);
});

test('config.json keeps a valid saved address, and drops an invalid one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-config-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ cloud_url: NEW }));
  assert.equal(readConfig(dir).cloud_url, NEW);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ cloud_url: 'http://evil.example.test' }));
  assert.equal(readConfig(dir).cloud_url, '');
});

test('the saved address reaches config.json, and the token never does', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-config-'));
  writeConfig(dir, saveCloudAddress(NEW).patch);
  const onDisk = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  assert.equal(JSON.parse(onDisk).cloud_url, NEW);
  assert.equal(onDisk.includes(TOKEN), false);
});

test('saving a new address keeps the link: the token stays, and the laptop is still linked', async () => {
  const storage = realisticStorage();
  const file = memoryFile();
  const calls = [];
  await createCloudDevice({ storage, file, fetchFn: recordingFetch(calls), baseUrl: OLD }).link('K7QM-4XD2', 'Booth');
  const before = JSON.parse(storage.decryptString(file.raw));
  // The operator saves a new address. The link keeps its token and its details: only the address the laptop talks to changes.
  const afterSave = createCloudDevice({ storage, file, fetchFn: recordingFetch(calls), baseUrl: NEW });
  const shown = await afterSave.status();
  assert.equal(shown.linked, true, 'the laptop is still linked');
  const after = JSON.parse(storage.decryptString(file.raw));
  assert.equal(after.token, before.token, 'the token is the same');
  assert.equal(after.linkedAddress, before.linkedAddress, 'the address the link was made against is the same');
  assert.equal(after.church, before.church);
});

test('the link remembers the address it was made against, so a change can be shown', async () => {
  const storage = realisticStorage();
  const file = memoryFile();
  const calls = [];
  await createCloudDevice({ storage, file, fetchFn: recordingFetch(calls), baseUrl: OLD }).link('K7QM-4XD2', 'Booth');
  const shown = await createCloudDevice({ storage, file, fetchFn: recordingFetch(calls), baseUrl: NEW }).status();
  assert.equal(shown.linkedAddress, OLD);
});

test('Check now goes to the saved address', async () => {
  const storage = realisticStorage();
  const file = memoryFile();
  const calls = [];
  await createCloudDevice({ storage, file, fetchFn: recordingFetch(calls), baseUrl: OLD }).link('K7QM-4XD2', 'Booth');
  calls.length = 0;
  await createCloudDevice({ storage, file, fetchFn: recordingFetch(calls), baseUrl: NEW }).status();
  assert.equal(calls[0].url, `${NEW}/.netlify/functions/device-status`);
  assert.equal(calls[0].auth, `Bearer ${TOKEN}`, 'the token goes to the cloud only');
});

test('the Cloud sync screen sends only the typed text and shows the linked-address note', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const screen = fs.readFileSync(path.join(here, '..', 'src', 'settings', 'CloudSyncSettings.tsx'), 'utf8');
  assert.match(screen, /cloud\.saveAddress\(addressText \?\? link\?\.address \?\? ''\)/);
  assert.match(screen, /Save address/);
  assert.ok(screen.includes('This laptop is linked to the address you had before. If you change it, check the link with Check now.'));
});

test('the main process validates the address and writes only cloud_url', () => {
  const main = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.js'), 'utf8');
  const handler = main.slice(main.indexOf("ipcMain.handle('cloud:save-address'"), main.indexOf("ipcMain.handle('cloud:save-address'") + 400);
  assert.match(handler, /saveCloudAddress\(String\(input\?\.address \?\? ''\)\)/);
  assert.match(handler, /writeConfig\(app\.getPath\('userData'\), saved\.patch\)/);
  assert.equal(/token/i.test(handler), false, 'the handler never names the token');
});
