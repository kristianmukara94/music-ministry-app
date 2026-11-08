// Tests the debugger and DevTools lockout: every forbidden flag is found however it is written (prefix, case, value, NODE_OPTIONS, an
// inspector already open), the packaged app exits with code 1 and logs it while an unpackaged run is left alone, the DevTools keys are
// recognised on Windows and Mac and nothing else is, and DevTools opened another way is closed and logged.
// Run with: node --test electron/anti-tamper.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { FORBIDDEN_SWITCHES, SECURE_WEB_PREFERENCES, SECURITY_LOG, auditLaunch, findLaunchFlags, guardWebContents, installDevToolsLockout, isDevToolsShortcut, isTrustedNavigation, setupAntiTamper, switchName, writeSecurityLog } =
  await import('./anti-tamper.js');

const EXE = 'C:\\Program Files\\APCCMMA\\APCCMMA.exe';

/** A packaged (or not) app whose exit and command line are recorded. */
function fakeApp({ isPackaged = true, switches = [] } = {}) {
  const fake = new EventEmitter();
  fake.isPackaged = isPackaged;
  fake.exits = [];
  fake.commandLine = { hasSwitch: (name) => switches.includes(name) };
  return fake;
}
const audit = (electronApp, options = {}) => {
  const logs = [];
  const exits = [];
  const found = auditLaunch({ electronApp, argv: [EXE], execArgv: [], nodeOptions: '', platform: 'win32', inspectorUrl: undefined, exit: (c) => exits.push(c), log: (...a) => logs.push(a), ...options });
  return { found, exits, logs };
};

test('the forbidden list is the six requested flags plus Electron\'s --inspect-brk-node', () => {
  assert.deepEqual([...FORBIDDEN_SWITCHES].sort(), ['enable-logging', 'ignore-certificate-errors', 'inspect', 'inspect-brk', 'inspect-brk-node', 'remote-debugging-pipe', 'remote-debugging-port']);
});

test('each forbidden flag is found, with or without a value', () => {
  for (const name of FORBIDDEN_SWITCHES) {
    assert.deepEqual(findLaunchFlags({ argv: [EXE, `--${name}`], platform: 'win32' }), [name]);
    assert.deepEqual(findLaunchFlags({ argv: [EXE, `--${name}=9222`], platform: 'win32' }), [name]);
  }
  assert.deepEqual(findLaunchFlags({ argv: [EXE, '--inspect=127.0.0.1:9229'], platform: 'linux' }), ['inspect']);
});

test('on Windows, Chromium\'s other spellings count: a single dash, a slash, and any case', () => {
  assert.equal(switchName('/Remote-Debugging-Port=9222', 'win32'), 'remote-debugging-port');
  assert.equal(switchName('-INSPECT', 'win32'), 'inspect');
  assert.deepEqual(findLaunchFlags({ argv: [EXE, '/remote-debugging-port=9222', '-Enable-Logging'], platform: 'win32' }).sort(), ['enable-logging', 'remote-debugging-port']);
  // A slash is not a switch prefix elsewhere, where it starts a file path.
  assert.equal(switchName('/inspect', 'darwin'), null);
});

test('the flag as Chromium parsed it is found even when the arguments do not show it', () => {
  assert.deepEqual(findLaunchFlags({ argv: [EXE], platform: 'win32', hasSwitch: (n) => n === 'remote-debugging-pipe' }), ['remote-debugging-pipe']);
});

test('Node\'s own arguments, NODE_OPTIONS, and an inspector that is already open are all found', () => {
  assert.deepEqual(findLaunchFlags({ argv: [EXE], execArgv: ['--inspect-brk'], platform: 'win32' }), ['inspect-brk']);
  assert.deepEqual(findLaunchFlags({ argv: [EXE], nodeOptions: '--max-old-space-size=4096 --inspect=9229', platform: 'win32' }), ['inspect']);
  // NODE_OPTIONS is Node's: only the inspector flags are read from it.
  assert.deepEqual(findLaunchFlags({ argv: [EXE], nodeOptions: '--enable-logging', platform: 'win32' }), []);
  assert.deepEqual(findLaunchFlags({ argv: [EXE], platform: 'win32', inspectorUrl: 'ws://127.0.0.1:9229/abc' }), ['inspect']);
});

test('ordinary arguments, look-alikes, the executable path and anything after a bare -- are not flags', () => {
  const argv = [EXE, '--updated', '--inspector-theme', '--enable-logging-later', 'C:\\Parish\\inspect.db', '--allow-file-access-from-files', '--', '--inspect'];
  assert.deepEqual(findLaunchFlags({ argv, platform: 'win32' }), []);
  // The executable itself is never read as a switch, whatever its name.
  assert.deepEqual(findLaunchFlags({ argv: ['--inspect'], platform: 'win32' }), []);
});

test('the packaged app logs and exits with code 1 when started with a debugging flag', () => {
  const { found, exits, logs } = audit(fakeApp(), { argv: [EXE, '--remote-debugging-port=9222', '--inspect'] });
  assert.deepEqual(found.sort(), ['inspect', 'remote-debugging-port']);
  assert.deepEqual(exits, [1]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], 'debug-flags-refused');
  assert.deepEqual(logs[0][1].flags.sort(), ['inspect', 'remote-debugging-port']);
});

test('the packaged app starts normally without one, and an unpackaged run is never stopped', () => {
  assert.deepEqual(audit(fakeApp()).exits, []);
  const dev = audit(fakeApp({ isPackaged: false }), { argv: [EXE, '--inspect', '--remote-debugging-port=9222'] });
  assert.deepEqual(dev.exits, []);
  assert.deepEqual(dev.logs, []);
});

test('the check is quick: one audit of a long command line takes well under a millisecond on average', () => {
  const argv = [EXE, ...Array.from({ length: 50 }, (_, i) => `--flag-${i}=value`), '--inspect'];
  const start = process.hrtime.bigint();
  for (let i = 0; i < 1000; i += 1) audit(fakeApp(), { argv });
  const perAuditMs = Number(process.hrtime.bigint() - start) / 1e6 / 1000;
  assert.ok(perAuditMs < 1, `${perAuditMs.toFixed(4)} ms per audit`);
});

test('the DevTools keys are recognised on Windows and on a Mac', () => {
  const key = (code, mods = {}) => ({ type: 'keyDown', code, key: code.replace('Key', '').toLowerCase(), ...mods });
  assert.ok(isDevToolsShortcut({ type: 'keyDown', key: 'F12', code: 'F12' }, 'win32'));
  assert.ok(isDevToolsShortcut(key('KeyI', { control: true, shift: true }), 'win32'));
  assert.ok(isDevToolsShortcut(key('KeyJ', { control: true, shift: true }), 'win32'));
  assert.ok(isDevToolsShortcut({ ...key('KeyI', { control: true, shift: true }), isAutoRepeat: true }, 'win32'));
  // Option changes the character on a Mac (Cmd+Option+I types ˆ): the physical key is what counts.
  assert.ok(isDevToolsShortcut({ type: 'keyDown', code: 'KeyI', key: 'ˆ', meta: true, alt: true }, 'darwin'));
  assert.ok(isDevToolsShortcut({ type: 'keyDown', code: 'KeyJ', key: '∆', meta: true, alt: true }, 'darwin'));
});

test('other keys are left alone: the app\'s own hotkeys, plain typing, key releases and near misses', () => {
  const key = (code, mods = {}) => ({ type: 'keyDown', code, key: code.replace('Key', '').toLowerCase(), ...mods });
  assert.equal(isDevToolsShortcut(key('KeyA', { control: true, shift: true }), 'win32'), false, 'Sanctuary Alert');
  assert.equal(isDevToolsShortcut(key('KeyB', { control: true, shift: true }), 'win32'), false, 'Force Failover');
  assert.equal(isDevToolsShortcut(key('KeyI', { control: true }), 'win32'), false, 'Ctrl+I (italic)');
  assert.equal(isDevToolsShortcut(key('KeyI', { shift: true }), 'win32'), false, 'typing a capital I');
  assert.equal(isDevToolsShortcut(key('KeyI', { control: true, shift: true, alt: true }), 'win32'), false, 'AltGr layouts');
  assert.equal(isDevToolsShortcut(key('KeyC', { control: true, shift: true }), 'win32'), false);
  assert.equal(isDevToolsShortcut({ type: 'keyUp', key: 'F12', code: 'F12' }, 'win32'), false);
  assert.equal(isDevToolsShortcut(key('KeyI', { control: true, shift: true }), 'darwin'), false);
  assert.equal(isDevToolsShortcut(null, 'win32'), false);
});

/** A page with the events and calls the guard uses. */
function fakeContents(url = 'app://apccmma/index.html') {
  const contents = new EventEmitter();
  contents.closed = 0;
  contents.getURL = () => url;
  contents.closeDevTools = () => {
    contents.closed += 1;
  };
  return contents;
}

test('a guarded page never receives the DevTools keys, and still receives everything else', () => {
  const contents = fakeContents();
  guardWebContents(contents, { platform: 'win32', log: () => {} });
  const press = (input) => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    contents.emit('before-input-event', event, input);
    return event.prevented;
  };
  assert.equal(press({ type: 'keyDown', key: 'F12', code: 'F12' }), true);
  assert.equal(press({ type: 'keyDown', key: 'I', code: 'KeyI', control: true, shift: true }), true);
  assert.equal(press({ type: 'keyDown', key: 'a', code: 'KeyA', control: true, shift: true }), false);
  assert.equal(press({ type: 'keyDown', key: 'F11', code: 'F11' }), false);
});

test('DevTools opened by any other means is closed at once and logged with the page', () => {
  const contents = fakeContents('app://apccmma/projector.html');
  const logs = [];
  guardWebContents(contents, { platform: 'win32', log: (...a) => logs.push(a) });
  contents.emit('devtools-opened');
  assert.equal(contents.closed, 1);
  assert.deepEqual(logs, [['devtools-closed', { url: 'app://apccmma/projector.html' }]]);
});

test('the lockout guards every page the packaged app creates, and nothing in an unpackaged run', () => {
  const packaged = fakeApp();
  assert.equal(installDevToolsLockout({ electronApp: packaged, platform: 'win32', log: () => {} }), true);
  const contents = fakeContents();
  packaged.emit('web-contents-created', {}, contents);
  contents.emit('devtools-opened');
  assert.equal(contents.closed, 1);

  const dev = fakeApp({ isPackaged: false });
  assert.equal(installDevToolsLockout({ electronApp: dev }), false);
  assert.equal(dev.listenerCount('web-contents-created'), 0);
});

test('the security log is one JSON line per event, and starts again instead of growing without end', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-security-'));
  try {
    const original = console.error;
    console.error = () => {};
    try {
      writeSecurityLog('debug-flags-refused', { flags: ['inspect'] }, { userData: dir, now: new Date('2026-11-08T01:00:00Z') });
      writeSecurityLog('devtools-closed', { url: 'app://x' }, { userData: dir, now: new Date('2026-11-08T01:00:01Z') });
      const lines = fs.readFileSync(path.join(dir, SECURITY_LOG), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.deepEqual(lines, [
        { at: '2026-11-08T01:00:00.000Z', event: 'debug-flags-refused', flags: ['inspect'] },
        { at: '2026-11-08T01:00:01.000Z', event: 'devtools-closed', url: 'app://x' },
      ]);
      fs.writeFileSync(path.join(dir, SECURITY_LOG), 'x'.repeat(256 * 1024));
      writeSecurityLog('devtools-closed', {}, { userData: dir });
      assert.ok(fs.statSync(path.join(dir, SECURITY_LOG)).size < 200);
      // A folder that cannot be written does not throw.
      assert.doesNotThrow(() => writeSecurityLog('x', {}, { userData: path.join(dir, SECURITY_LOG, 'not-a-dir') }));
    } finally {
      console.error = original;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main.js imports the lockout before any other module of the app', () => {
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const firstLocal = main.match(/^import [^\n]*'\.\/[^']+'/m)?.[0];
  assert.match(firstLocal, /from '\.\/anti-tamper\.js'$/);
});

test('every window setting that could weaken the renderer is pinned, and the shared preferences use them', () => {
  assert.deepEqual({ ...SECURE_WEB_PREFERENCES }, { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, experimentalFeatures: false });
  assert.ok(Object.isFrozen(SECURE_WEB_PREFERENCES));
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /const webPreferences = \{\s+\.\.\.SECURE_WEB_PREFERENCES,/);
  assert.match(main, /setupAntiTamper\(win, !app\.isPackaged\);\s+windows\.operator = win;/);
});

test('only the app\'s files and localhost count as trusted addresses', () => {
  assert.ok(isTrustedNavigation('file:///C:/app/dist/index.html#/operator'));
  assert.ok(isTrustedNavigation('http://localhost:5173/#/operator'));
  assert.equal(isTrustedNavigation('https://example.com/'), false);
  assert.equal(isTrustedNavigation('https://localhost.example.com/'), false);
  assert.equal(isTrustedNavigation('javascript:alert(1)'), false);
  assert.equal(isTrustedNavigation('not a url'), false);
});

/** A window whose page records navigation and pop-up handling. */
function fakeWindow() {
  const contents = fakeContents();
  contents.setWindowOpenHandler = (handler) => {
    contents.windowOpen = handler;
  };
  return { webContents: contents };
}

test('setupAntiTamper blocks outside navigation and pop-ups in production, and logs both', () => {
  const win = fakeWindow();
  const logs = [];
  assert.equal(setupAntiTamper(win, false, { platform: 'win32', log: (...a) => logs.push(a) }), true);
  const navigate = (url) => {
    const event = { url, prevented: false, preventDefault() { this.prevented = true; } };
    win.webContents.emit('will-navigate', event, url);
    return event.prevented;
  };
  assert.equal(navigate('https://example.com/'), true);
  assert.equal(navigate('file:///C:/app/dist/index.html'), false);
  assert.deepEqual(win.webContents.windowOpen({ url: 'https://example.com/' }), { action: 'deny' });
  assert.deepEqual(logs.map(([event]) => event), ['navigation-blocked', 'window-open-denied']);
});

test('setupAntiTamper leaves a development run alone', () => {
  const win = fakeWindow();
  assert.equal(setupAntiTamper(win, true, { platform: 'win32', log: () => {} }), false);
  assert.equal(win.webContents.listenerCount('devtools-opened'), 0);
  assert.equal(win.webContents.windowOpen, undefined);
});

test('a page reached by both the app-wide lockout and setupAntiTamper closes DevTools and logs only once', () => {
  const win = fakeWindow();
  const logs = [];
  const options = { platform: 'win32', log: (...a) => logs.push(a) };
  guardWebContents(win.webContents, options);
  setupAntiTamper(win, false, options);
  win.webContents.emit('devtools-opened');
  assert.equal(win.webContents.closed, 1);
  assert.equal(logs.length, 1);
});

test('the packaged build runs the compiled entry, and the fuses are applied while packaging', () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.build.extraMetadata.main, 'dist-electron/main.js');
  assert.ok(pkg.build.files.includes('dist-electron/**/*'));
  assert.ok(pkg.dependencies.bytenode, 'the bytecode loader runs in the installed app, so it must be a runtime dependency');
  for (const script of ['build', 'release', 'pack', 'dist']) assert.match(pkg.scripts[script], /npm run build:electron && electron-builder/);
  assert.equal(pkg.build.afterPack, 'tools/after-pack.cjs');
  assert.match(fs.readFileSync(new URL('tools/after-pack.cjs', root), 'utf8'), /setFuses/);
});
