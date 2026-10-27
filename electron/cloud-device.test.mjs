// Tests for the desktop side of cloud sync: how the token is stored, linked, checked and removed. Run with:
//   node --test electron/cloud-device.test.mjs
// Electron is not needed: safeStorage, the file and fetch are replaced by fakes. The fake safeStorage really encrypts (AES-256-GCM),
// so the tests can check that the token never appears in the stored bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloudDevice, MESSAGES } from './cloud-device.js';
import {
  checkChurchSetup,
  checkWebUser,
  cloudViewState,
  formatLinkCode,
  formatSetupKey,
  isCompleteLinkCode,
  lastSyncedText,
  plainErrorText,
} from '../shared/cloud-device.js';

const BASE = 'https://church.example';
const TOKEN = 'device-token-value-that-must-never-leak-0123456789';
const SCREEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'settings', 'CloudSyncSettings.tsx');
const NEW_USER = { username: 'anna', displayName: 'Anna Lee', role: 'planner' };

/** A safeStorage stand-in that encrypts for real, with a key held only in this test. */
function realisticStorage({ available = true } = {}) {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => available,
    encryptString(text) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(bytes) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

/** A file stand-in: one blob in memory. */
function memoryFile() {
  let blob = null;
  return {
    read: () => blob,
    write: (bytes) => {
      blob = Buffer.from(bytes);
    },
    remove: () => {
      blob = null;
    },
    get raw() {
      return blob;
    },
  };
}

/** A fetch stand-in that answers the four cloud functions the way the server does. */
function fakeServer(overrides = {}) {
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    const name = url.split('/').pop();
    calls.push({ name, method: opts.method ?? 'GET', auth: opts.headers?.Authorization ?? null, body: opts.body });
    if (overrides[name]) return overrides[name](opts);
    if (name === 'link-redeem') {
      return respond(201, { token: TOKEN, churchName: 'St Mary', adminName: 'Boss', deviceLabel: 'Operator booth' });
    }
    if (name === 'device-status') {
      return respond(200, { churchName: 'St Mary', adminName: 'Boss', deviceLabel: 'Operator booth', lastSeenAt: '2026-10-27T12:00:00.000Z' });
    }
    if (name === 'device-unlink') return respond(200, { ok: true });
    if (name === 'device-users-create') {
      return respond(201, { user: { username: 'anna', role: 'planner' }, temporaryPassword: 'abcd-efgh-jkmn' });
    }
    if (name === 'setup-church-admin') {
      return respond(201, {
        token: TOKEN,
        churchName: 'St Mary Parish',
        displayCode: 'K7QM-4XD2',
        username: 'parishadmin',
        displayName: 'Parish Admin',
        deviceLabel: 'Office laptop',
        temporaryPassword: 'abcd-efgh-jkmn',
      });
    }
    return respond(404, { error: 'Not found.' });
  };
  return { fetchFn, calls };
}

const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('linking stores the token encrypted, and the stored bytes never contain the token', async () => {
  const storage = realisticStorage();
  const file = memoryFile();
  const server = fakeServer();
  const device = createCloudDevice({ storage, file, fetchFn: server.fetchFn, baseUrl: BASE });
  const result = await device.link('K7QM-4XD2', 'Operator booth');
  assert.equal(result.linked, true);
  assert.equal(result.church, 'St Mary');
  assert.equal(file.raw.toString('latin1').includes(TOKEN), false, 'the token is not in the stored bytes');
  assert.equal(file.raw.toString('utf8').includes(TOKEN), false);
});

test('the status the screen receives has the display fields only, never the token', async () => {
  const device = createCloudDevice({ storage: realisticStorage(), file: memoryFile(), fetchFn: fakeServer().fetchFn, baseUrl: BASE });
  const result = await device.link('K7QM-4XD2', 'Operator booth');
  assert.equal('token' in result, false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.deepEqual(Object.keys(cloudViewState(result)).sort(), ['churchName', 'adminName', 'deviceLabel', 'lastSynced', 'offline', 'error', 'kind'].sort());
});

test('linking is refused, and nothing is written, when safeStorage is not available', async () => {
  const file = memoryFile();
  const server = fakeServer();
  const device = createCloudDevice({ storage: realisticStorage({ available: false }), file, fetchFn: server.fetchFn, baseUrl: BASE });
  await assert.rejects(device.link('K7QM-4XD2', 'Laptop'), (err) => err.message === MESSAGES.noSafeStorage);
  assert.equal(file.raw, null, 'no plain or other fallback was written');
  assert.equal(server.calls.length, 0, 'the code was not even sent');
});

test('linking refuses when no cloud address is set', async () => {
  const device = createCloudDevice({ storage: realisticStorage(), file: memoryFile(), fetchFn: fakeServer().fetchFn, baseUrl: '' });
  await assert.rejects(device.link('K7QM-4XD2', 'Laptop'), (err) => err.message === MESSAGES.noCloudAddress);
});

test('a refused code gives the server\'s plain message, and stores nothing', async () => {
  const file = memoryFile();
  const server = fakeServer({
    'link-redeem': () => respond(400, { error: 'That code has expired. Ask your admin for a new one.' }),
  });
  const device = createCloudDevice({ storage: realisticStorage(), file, fetchFn: server.fetchFn, baseUrl: BASE });
  await assert.rejects(device.link('K7QM-4XD2', 'Laptop'), (err) => err.message === 'That code has expired. Ask your admin for a new one.');
  assert.equal(file.raw, null);
});

test('an unreachable cloud gives the neutral offline message, with no network detail', async () => {
  const device = createCloudDevice({
    storage: realisticStorage(),
    file: memoryFile(),
    fetchFn: async () => {
      throw new Error('getaddrinfo ENOTFOUND church.example');
    },
    baseUrl: BASE,
  });
  await assert.rejects(device.link('K7QM-4XD2', 'Laptop'), (err) => err.message === MESSAGES.offline);
});

test('status checks with the cloud, and shows the last known link marked offline when the cloud cannot be reached', async () => {
  const storage = realisticStorage();
  const file = memoryFile();
  const device = createCloudDevice({ storage, file, fetchFn: fakeServer().fetchFn, baseUrl: BASE });
  await device.link('K7QM-4XD2', 'Operator booth');
  const offline = createCloudDevice({
    storage,
    file,
    fetchFn: async () => {
      throw new Error('offline');
    },
    baseUrl: BASE,
  });
  const shown = await offline.status();
  assert.equal(shown.linked, true);
  assert.equal(shown.offline, true);
  assert.equal(shown.church, 'St Mary');
  assert.equal(shown.error, MESSAGES.offline);
});

test('a token the website has revoked is refused, and removed from this computer', async () => {
  const storage = realisticStorage();
  const file = memoryFile();
  await createCloudDevice({ storage, file, fetchFn: fakeServer().fetchFn, baseUrl: BASE }).link('K7QM-4XD2', 'Laptop');
  const revoked = createCloudDevice({
    storage,
    file,
    fetchFn: fakeServer({ 'device-status': () => respond(401, { error: 'This laptop is not linked to a church. Link it again.' }) }).fetchFn,
    baseUrl: BASE,
  });
  const shown = await revoked.status();
  assert.equal(shown.linked, false);
  assert.equal(shown.error, MESSAGES.revokedOnWeb);
  assert.equal(file.raw, null, 'the stored token is removed');
});

test('unlinking clears the stored token, tells the cloud, and leaves the laptop unlinked', async () => {
  const storage = realisticStorage();
  const file = memoryFile();
  const server = fakeServer();
  const device = createCloudDevice({ storage, file, fetchFn: server.fetchFn, baseUrl: BASE });
  await device.link('K7QM-4XD2', 'Laptop');
  const result = await device.unlink();
  assert.equal(result.linked, false);
  assert.equal(result.serverConfirmed, true);
  assert.equal(file.raw, null, 'the stored token is gone');
  assert.equal(server.calls.find((c) => c.name === 'device-unlink').auth, `Bearer ${TOKEN}`, 'the cloud was told with the token');
  assert.equal((await device.status()).linked, false);
});

test('unlinking removes the token even when the cloud cannot be reached, and says the website may still list the laptop', async () => {
  const storage = realisticStorage();
  const file = memoryFile();
  await createCloudDevice({ storage, file, fetchFn: fakeServer().fetchFn, baseUrl: BASE }).link('K7QM-4XD2', 'Laptop');
  const device = createCloudDevice({
    storage,
    file,
    fetchFn: async () => {
      throw new Error('offline');
    },
    baseUrl: BASE,
  });
  const result = await device.unlink();
  assert.equal(file.raw, null);
  assert.equal(result.serverConfirmed, false);
  assert.match(result.error, /also unlink it on the website/);
});

test('a status check with nothing stored reports unlinked, with no token and no error', async () => {
  const device = createCloudDevice({ storage: realisticStorage(), file: memoryFile(), fetchFn: fakeServer().fetchFn, baseUrl: BASE });
  assert.deepEqual(await device.status(), { linked: false, error: null });
});

test('a stored blob that cannot be decrypted is removed and reported, not used', async () => {
  const file = memoryFile();
  file.write(Buffer.from('not a real ciphertext at all, just noise'));
  const device = createCloudDevice({ storage: realisticStorage(), file, fetchFn: fakeServer().fetchFn, baseUrl: BASE });
  const result = await device.status();
  assert.equal(result.linked, false);
  assert.equal(result.error, MESSAGES.unreadable);
  assert.equal(file.raw, null);
});

// ---- The screen's states, and the link code as typed ----

test('the Settings screen has the three states: unlinked, linked, and error', () => {
  assert.equal(cloudViewState({ linked: false }).kind, 'unlinked');
  assert.equal(cloudViewState({ linked: false, error: 'Expired.' }).error, 'Expired.');
  const linked = cloudViewState({ linked: true, church: 'St Mary', admin: 'Boss', label: 'Booth', lastSeenAt: null });
  assert.equal(linked.kind, 'linked');
  assert.equal(linked.lastSynced, 'Not yet');
  assert.equal(cloudViewState({ linked: true, church: 'St Mary', offline: true, error: 'Offline.' }).error, 'Offline.');
});

test('a link code is formatted as typed: upper case, with a dash after four characters', () => {
  assert.equal(formatLinkCode('k7qm4xd2'), 'K7QM-4XD2');
  assert.equal(formatLinkCode('k7 qm-4xd2 extra'), 'K7QM-4XD2');
  assert.equal(formatLinkCode('k7q'), 'K7Q');
  assert.equal(isCompleteLinkCode('K7QM-4XD'), false);
  assert.equal(isCompleteLinkCode('K7QM-4XD2'), true);
});

test('the renderer code never reads localStorage or sessionStorage for cloud sync', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const screen = fs.readFileSync(path.join(here, '..', 'src', 'settings', 'CloudSyncSettings.tsx'), 'utf8');
  assert.equal(/localStorage|sessionStorage/.test(screen), false);
  // Comments may mention the token; the code itself must not.
  const code = screen
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
    .join('\n');
  assert.equal(/token/i.test(code), false, 'the screen code has no token field');
});

test('last synced reads plainly', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  assert.equal(lastSyncedText('2026-10-27T11:59:40Z', now), 'Just now');
  assert.equal(lastSyncedText('2026-10-27T11:50:00Z', now), '10 minutes ago');
  assert.equal(lastSyncedText('2026-10-27T10:00:00Z', now), '2 hours ago');
});

// ---- Adding a web user from this laptop ----

/** A laptop linked through the fake server, with its token stored the way the app stores it. */
async function linkedLaptop(overrides = {}) {
  const file = memoryFile();
  const server = fakeServer(overrides);
  const device = createCloudDevice({ storage: realisticStorage(), file, fetchFn: server.fetchFn, baseUrl: BASE });
  await device.link('K7QM-4XD2', 'Operator booth');
  return { device, file, server };
}

test('the Create web user button is written inside the linked branch, so it is hidden when unlinked', () => {
  assert.equal(cloudViewState({ linked: false }).kind, 'unlinked');
  const screen = fs.readFileSync(SCREEN, 'utf8');
  const linkedBranch = screen.indexOf("view.kind === 'linked'");
  assert.ok(linkedBranch > 0 && screen.indexOf('Create web user') > linkedBranch, 'the button only appears for a linked laptop');
});

test('a laptop that is not linked cannot add a web user, and nothing is sent', async () => {
  const server = fakeServer();
  const device = createCloudDevice({ storage: realisticStorage(), file: memoryFile(), fetchFn: server.fetchFn, baseUrl: BASE });
  await assert.rejects(device.createWebUser(NEW_USER), (err) => err.message === MESSAGES.notLinked);
  assert.equal(server.calls.length, 0);
});

test('the token goes to the cloud only, and the result the screen gets has no token', async () => {
  const { device, server } = await linkedLaptop();
  const made = await device.createWebUser(NEW_USER);
  assert.deepEqual(Object.keys(made).sort(), ['temporaryPassword', 'username']);
  assert.equal(JSON.stringify(made).includes(TOKEN), false);
  assert.equal(server.calls.find((c) => c.name === 'device-users-create').auth, `Bearer ${TOKEN}`);
});

test('the temporary password is not written to disk and is not logged', async () => {
  const { device, file } = await linkedLaptop();
  let writes = 0;
  const write = file.write;
  file.write = (bytes) => {
    writes += 1;
    write(bytes);
  };
  const logged = [];
  const saved = ['log', 'info', 'warn', 'error', 'debug'].map((method) => {
    const original = console[method];
    console[method] = (...args) => logged.push(args.join(' '));
    return [method, original];
  });
  let made;
  try {
    made = await device.createWebUser(NEW_USER);
  } finally {
    for (const [method, original] of saved) console[method] = original;
  }
  assert.equal(made.temporaryPassword, 'abcd-efgh-jkmn');
  assert.equal(writes, 0, 'nothing was written to the stored file');
  assert.equal(file.raw.toString('utf8').includes(made.temporaryPassword), false);
  assert.equal(logged.join('\n').includes(made.temporaryPassword), false, 'the password is not in any log line');
});

test('invalid input is refused in the main process, and nothing is sent', async () => {
  const { device, server } = await linkedLaptop();
  const sentBefore = server.calls.length;
  const bad = [
    { ...NEW_USER, username: 'anna lee' },
    { ...NEW_USER, username: '' },
    { ...NEW_USER, username: 'a'.repeat(81) },
    { ...NEW_USER, displayName: '   ' },
    { ...NEW_USER, displayName: 'x'.repeat(121) },
    { ...NEW_USER, role: 'owner' },
    { ...NEW_USER, role: undefined },
  ];
  for (const input of bad) {
    await assert.rejects(device.createWebUser(input), (err) => typeof err.message === 'string' && err.message.length > 0);
  }
  await assert.rejects(device.createWebUser({ ...NEW_USER, role: 'owner' }), (err) => err.message === 'Choose a role: admin, planner or viewer.');
  assert.equal(server.calls.length, sentBefore, 'no request left the laptop');
});

test('the checks the screen runs match the server rules: valid input passes, and the rules are not looser', () => {
  assert.equal(checkWebUser(NEW_USER), null);
  assert.equal(checkWebUser({ ...NEW_USER, username: 'anna lee' }), 'Enter a username of up to 80 characters, with no spaces.');
  assert.equal(checkWebUser({ ...NEW_USER, displayName: '' }), 'Enter a name of up to 120 characters.');
  assert.equal(checkWebUser({ ...NEW_USER, role: 'owner' }), 'Choose a role: admin, planner or viewer.');
  assert.equal(checkWebUser({ ...NEW_USER, role: 'admin' }), null);
  assert.equal(checkWebUser({ ...NEW_USER, role: 'viewer' }), null);
});

test('the name and username are trimmed before they are sent', async () => {
  const { device, server } = await linkedLaptop();
  await device.createWebUser({ username: '  anna ', displayName: ' Anna Lee ', role: 'viewer' });
  const body = JSON.parse(server.calls.find((c) => c.name === 'device-users-create').body);
  assert.deepEqual(body, { username: 'anna', displayName: 'Anna Lee', role: 'viewer' });
});

test('a token the website has revoked is refused, and removed, when adding a user', async () => {
  const { device, file } = await linkedLaptop({ 'device-users-create': () => respond(401, { error: 'This laptop is not linked to a church.' }) });
  await assert.rejects(device.createWebUser(NEW_USER), (err) => err.message === MESSAGES.revokedOnWeb);
  assert.equal(file.raw, null);
});

test('a refusal from the server shows its plain message', async () => {
  const message = 'Only an active admin can add web users from this laptop.';
  const { device } = await linkedLaptop({ 'device-users-create': () => respond(403, { error: message }) });
  await assert.rejects(device.createWebUser(NEW_USER), (err) => err.message === message);
});

test('the form and the password are cleared when the result closes and when the screen goes away', () => {
  const screen = fs.readFileSync(SCREEN, 'utf8');
  assert.match(screen, /const closeCreated = \(\) => \{\s*setCreated\(null\);/, 'closing the result clears the password');
  assert.match(screen, /useEffect\(\s*\(\) => \(\) => \{\s*setCreated\(null\);/, 'leaving the screen clears the password');
  assert.match(screen, /setNewUser\(emptyUser\);\s*setAddingUser\(false\);/, 'a successful create clears the form');
  assert.ok(screen.includes("Give this to the new user. It won't be shown again."), 'the one-time note is on the result panel');
});

// ---- Creating a church and its first admin from this laptop ----

const SETUP = { setupKey: 'ABCD-EFGH-JKLM', churchName: 'St Mary Parish', username: 'parishadmin', displayName: 'Parish Admin', deviceLabel: 'Office laptop' };
const SETUP_KEY_PLAIN = 'ABCDEFGHJKLM';
const PASSWORD = 'abcd-efgh-jkmn';

test('the Create church admin form is written inside the unlinked branch, so it is hidden when the laptop is linked', () => {
  const screen = fs.readFileSync(SCREEN, 'utf8');
  const unlinked = screen.indexOf("view.kind === 'unlinked'");
  const form = screen.indexOf('Create church admin for website');
  const linked = screen.indexOf("view.kind === 'linked'");
  assert.ok(unlinked > 0 && form > unlinked && form < linked, 'the form only appears for an unlinked laptop');
});

test('a laptop that is already linked cannot create a church, and nothing is sent', async () => {
  const { device, server } = await linkedLaptop();
  const sentBefore = server.calls.length;
  await assert.rejects(device.createChurchAdmin(SETUP), (err) => err.message === 'This laptop is already linked to a church. Unlink it first to set up a new church.');
  assert.equal(server.calls.length, sentBefore);
});

test('a laptop with no safe storage refuses before it sends the setup key', async () => {
  const server = fakeServer();
  const device = createCloudDevice({ storage: realisticStorage({ available: false }), file: memoryFile(), fetchFn: server.fetchFn, baseUrl: BASE });
  await assert.rejects(device.createChurchAdmin(SETUP), (err) => err.message === MESSAGES.noSafeStorage);
  assert.equal(server.calls.length, 0, 'the setup key was not sent');
});

test('creating a church stores the token encrypted, links the laptop, and returns the password once', async () => {
  const file = memoryFile();
  const server = fakeServer();
  const device = createCloudDevice({ storage: realisticStorage(), file, fetchFn: server.fetchFn, baseUrl: BASE });
  const made = await device.createChurchAdmin(SETUP);
  assert.equal(made.username, 'parishadmin');
  assert.equal(made.temporaryPassword, PASSWORD);
  assert.equal(made.churchCode, 'K7QM-4XD2');
  assert.equal(made.link.linked, true);
  assert.equal(made.link.church, 'St Mary', 'the church name comes back from the cloud status');
  assert.equal(file.raw.toString('utf8').includes(TOKEN), false, 'the token is stored encrypted');
});

test('the setup key and the password never reach localStorage or the disk', async () => {
  const file = memoryFile();
  let writes = 0;
  const write = file.write;
  file.write = (bytes) => {
    writes += 1;
    write(bytes);
  };
  const device = createCloudDevice({ storage: realisticStorage(), file, fetchFn: fakeServer().fetchFn, baseUrl: BASE });
  const made = await device.createChurchAdmin(SETUP);
  assert.ok(writes >= 1, 'the link was written');
  assert.equal(file.raw.toString('utf8').includes(made.temporaryPassword), false);
  for (const secret of [SETUP.setupKey, SETUP_KEY_PLAIN, made.temporaryPassword]) {
    assert.equal(file.raw.toString('utf8').includes(secret), false, 'not in the stored bytes');
    assert.equal(file.raw.toString('latin1').includes(secret), false, 'not in the stored bytes, in any encoding');
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, 'cloud-device.js'), 'utf8');
  // Comments may name localStorage to say it is not used; the code itself must not use it.
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
    .join('\n');
  assert.equal(/localStorage|sessionStorage/.test(code), false, 'the desktop code never uses browser storage');
});

test('the token never reaches the screen: the result has no token, and the link the screen gets has no token', async () => {
  const device = createCloudDevice({ storage: realisticStorage(), file: memoryFile(), fetchFn: fakeServer().fetchFn, baseUrl: BASE });
  const made = await device.createChurchAdmin(SETUP);
  assert.deepEqual(Object.keys(made).sort(), ['churchCode', 'link', 'temporaryPassword', 'username']);
  assert.equal(JSON.stringify(made).includes(TOKEN), false);
});

test('the password and the key are not written to any log while creating', async () => {
  const device = createCloudDevice({ storage: realisticStorage(), file: memoryFile(), fetchFn: fakeServer().fetchFn, baseUrl: BASE });
  const logged = [];
  const saved = ['log', 'info', 'warn', 'error', 'debug'].map((method) => {
    const original = console[method];
    console[method] = (...args) => logged.push(args.join(' '));
    return [method, original];
  });
  let made;
  try {
    made = await device.createChurchAdmin(SETUP);
  } finally {
    for (const [method, original] of saved) console[method] = original;
  }
  assert.equal(logged.join('\n').includes(made.temporaryPassword), false);
  assert.equal(logged.join('\n').includes(SETUP.setupKey), false);
});

test('invalid input is refused in the main process, and nothing is sent', async () => {
  const server = fakeServer();
  const device = createCloudDevice({ storage: realisticStorage(), file: memoryFile(), fetchFn: server.fetchFn, baseUrl: BASE });
  const bad = [
    { ...SETUP, setupKey: 'ABCD' },
    { ...SETUP, setupKey: '' },
    { ...SETUP, churchName: '' },
    { ...SETUP, churchName: 'x'.repeat(121) },
    { ...SETUP, username: 'has space' },
    { ...SETUP, displayName: '   ' },
    { ...SETUP, deviceLabel: 'x'.repeat(81) },
  ];
  for (const input of bad) {
    await assert.rejects(device.createChurchAdmin(input), (err) => typeof err.message === 'string' && err.message.length > 0);
  }
  assert.equal(server.calls.length, 0, 'no request left the laptop');
});

test('a key the server does not accept gives its plain message, and stores nothing', async () => {
  const file = memoryFile();
  const device = createCloudDevice({
    storage: realisticStorage(),
    file,
    fetchFn: fakeServer({ 'setup-church-admin': () => respond(400, { error: 'That setup key is not valid or has already been used.' }) }).fetchFn,
    baseUrl: BASE,
  });
  await assert.rejects(device.createChurchAdmin(SETUP), (err) => err.message === 'That setup key is not valid or has already been used.');
  assert.equal(file.raw, null);
});

test('the form, the key and the password are cleared when the result closes and when the screen goes away', () => {
  const screen = fs.readFileSync(SCREEN, 'utf8');
  assert.match(screen, /const closeChurchResult = \(\) => \{\s*setCreatedChurch\(null\);/, 'closing the result clears the password');
  assert.match(screen, /setCreatedChurch\(null\);\s*setSetup\(emptySetup\);/, 'leaving the screen clears the password and the key');
  assert.match(screen, /finally \{\s*\/\/ The setup key is cleared whatever the outcome\.[\s\S]*?setSetup\(emptySetup\);/, 'the key is cleared after every attempt');
  assert.ok(screen.includes("Give this to the admin. It won't be shown again."), 'the one-time note is on the result panel');
});

// ---- Messages from the cloud, including replies that are not from the planner ----

/** A reply whose body is not JSON, the way a site password page answers. */
const htmlReply = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    throw new SyntaxError('Unexpected token <');
  },
});

const setupWith = (reply) =>
  createCloudDevice({ storage: realisticStorage(), file: memoryFile(), fetchFn: async () => reply, baseUrl: BASE }).createChurchAdmin(SETUP);

test('a 401 page that is not from the planner names its status, and is not hidden behind the generic line', async () => {
  await assert.rejects(setupWith(htmlReply(401)), (err) => /error 401/.test(err.message) && !/Something went wrong/.test(err.message));
});

test('a 403 page that is not from the planner names its status, on the link screen too', async () => {
  const device = createCloudDevice({ storage: realisticStorage(), file: memoryFile(), fetchFn: async () => htmlReply(403), baseUrl: BASE });
  await assert.rejects(device.link('K7QM-4XD2', 'Laptop'), (err) => /error 403/.test(err.message));
});

test('a server error with no plain message stays the generic line', async () => {
  await assert.rejects(setupWith(htmlReply(500)), (err) => err.message === 'Something went wrong. Try again.');
  await assert.rejects(setupWith(respond(500, {})), (err) => err.message === 'Something went wrong. Try again.');
});

test('a plain message from the server is shown as it is, whatever the status', async () => {
  await assert.rejects(setupWith(respond(400, { error: 'That setup key is not valid or has already been used.' })), (err) => err.message === 'That setup key is not valid or has already been used.');
});

test("Electron's wrapper text is removed, so only the plain message reaches the screen", () => {
  assert.equal(
    plainErrorText("Error invoking remote method 'cloud:create-church-admin': Error: That setup key is not valid or has already been used."),
    'That setup key is not valid or has already been used.',
  );
  assert.equal(plainErrorText('Enter a church name of up to 120 characters.'), 'Enter a church name of up to 120 characters.');
});

test('the setup key is checked on the screen the same way the main process checks it', () => {
  assert.equal(checkChurchSetup(SETUP), null);
  assert.equal(checkChurchSetup({ ...SETUP, setupKey: 'ABCD-EF' }), 'Type the whole setup key, in the form ABCD-EFGH-JKLM.');
  assert.equal(formatSetupKey('abcdefghjklm'), 'ABCD-EFGH-JKLM');
  assert.equal(formatSetupKey('abcde'), 'ABCD-E');
});
