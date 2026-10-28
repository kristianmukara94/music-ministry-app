// The restart after a database import: the lower-third server frees its port before the restart, and the restart keeps the launch arguments in
// development. Also checks that a window that fails to load is logged. Run with: node --test electron/relaunch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLowerThirdServer } from './lower-third-server.js';

const PORT = 39127;
const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-relaunch-'));
const MAIN = fs.readFileSync(path.resolve(import.meta.dirname, 'main.js'), 'utf8');

test('the lower-third server frees its port when stop resolves, so a restarted app can take it', async () => {
  const first = createLowerThirdServer({ distDir, port: PORT, host: '127.0.0.1' });
  await first.start();
  await first.stop();

  const second = createLowerThirdServer({ distDir, port: PORT, host: '127.0.0.1' });
  const started = await Promise.race([second.start(), new Promise((resolve) => setTimeout(() => resolve('timed out'), 3000))]);
  assert.notEqual(started, 'timed out', 'the port is free');
  await second.stop();
});

test('a restart closes what the app holds open first, then keeps the launch arguments in development', () => {
  assert.match(MAIN, /async function relaunchApp\(\) \{\s*await stopRemoteViews\(\);\s*if \(lowerThirdServer\) await lowerThirdServer\.stop\(\);/);
  assert.match(MAIN, /songSync\.stop\(\);\s*planSync\?\.stop\(\);\s*closeDatabaseOnce\(\);/);
  // Packaged: the app relaunches itself. Development: the new process is spawned with its environment set, then this one exits.
  assert.match(MAIN, /if \(app\.isPackaged\) \{\s*app\.relaunch\(\);\s*\} else \{\s*const child = spawn\(process\.execPath, process\.argv\.slice\(1\), \{/);
  assert.match(MAIN, /env: relaunchEnvironment\(\),\s*detached: true,\s*stdio: 'ignore',\s*\}\);\s*child\.unref\(\);\s*\}\s*app\.exit\(0\);/);
  // The one relaunch call in the packaged branch; the import handler goes through relaunchApp.
  assert.equal([...MAIN.matchAll(/app\.relaunch\(/g)].length, 1);
  assert.match(MAIN, /import \{ spawn \} from 'node:child_process';/);
  // A relaunched development app must not start as plain Node: ELECTRON_RUN_AS_NODE is removed, and the dev server address is kept.
  assert.match(MAIN, /delete env\.ELECTRON_RUN_AS_NODE;/);
  assert.match(MAIN, /if \(process\.env\.VITE_DEV_SERVER_URL\) env\.VITE_DEV_SERVER_URL = process\.env\.VITE_DEV_SERVER_URL;/);
  assert.doesNotMatch(MAIN, /app\.relaunch\(\);\s*app\.exit\(0\);\s*return \{ success: true/);
  assert.equal([...MAIN.matchAll(/await relaunchApp\(\);/g)].length, 2);
});

test('the database is closed once, by the import, and never twice', () => {
  assert.match(MAIN, /let databaseClosed = false;/);
  assert.match(MAIN, /if \(databaseClosed \|\| !announcements\) return;/);
  assert.match(MAIN, /closeDatabase: \(\) => closeDatabaseOnce\(\),/);
});

test('a window that fails to load, or whose renderer stops, is logged with its route', () => {
  assert.match(MAIN, /win\.webContents\.on\('did-fail-load', \(_event, code, description, url, isMainFrame\) => \{\s*console\.error\(`\[window \$\{route\}\] failed to load/);
  assert.match(MAIN, /win\.webContents\.on\('render-process-gone'/);
});

test('a dev window whose server is not up yet is tried again, for a limited time; a missing file is not', () => {
  assert.match(MAIN, /const RETRY_ERRORS = new Set\(\[-102, -105, -106, -109\]\);/);
  assert.match(MAIN, /if \(!target \|\| !isMainFrame \|\| !RETRY_ERRORS\.has\(code\) \|\| retries >= RETRY_LIMIT\) return;/);
  assert.match(MAIN, /if \(!win\.isDestroyed\(\)\) win\.loadURL\(target\);/);
});

test('in development the dev URL falls back to Vite\'s port when there is no built copy to load', () => {
  assert.match(MAIN, /process\.env\.VITE_DEV_SERVER_URL \|\|\s*\(!app\.isPackaged && !fs\.existsSync\(path\.join\(__dirname, '\.\.\/dist\/index\.html'\)\) \? 'http:\/\/localhost:5173' : null\)/);
});
