// The wording and the enable rules the Nearby TV Cast settings and the top bar draw, and a check that the settings UI is wired the way the spec says
// (every control carries NO_DRAG, the section sits in Remote view, the top bar shows the badge). The React files cannot be loaded by plain node,
// so their source is read. Run with: node --test shared/tv-cast-view.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FEED_OPTIONS, castButtonLabel, castControls, feedLabel, isCasting, protocolBadge, statePill, topBarCastLabel, tvSubtitle } from './tv-cast-view.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const tv = (over = {}) => ({ id: 'a', name: 'Sample TV Name', manufacturer: 'Sample Maker', model: 'Sample Model', ip: '192.168.1.50', protocol: 'dlna', feed: 'projector', state: 'ready', error: null, ...over });

test('each TV card shows its protocol badge, subtitle, feed choices and a state pill', () => {
  assert.equal(protocolBadge(tv()), 'DLNA / Smart View');
  assert.equal(protocolBadge(tv({ protocol: 'chromecast' })), 'Chromecast / Google TV');
  assert.equal(tvSubtitle(tv()), 'Sample Maker Sample Model · 192.168.1.50');
  assert.equal(tvSubtitle(tv({ manufacturer: '', model: '' })), '192.168.1.50');
  assert.deepEqual(FEED_OPTIONS.map((o) => o.label), ['Projector', 'Stage Mirror']);
  assert.equal(feedLabel('stage'), 'Stage Mirror');
  assert.deepEqual(statePill(tv()), { text: 'Ready', tone: 'idle' });
  assert.deepEqual(statePill(tv({ state: 'connecting' })), { text: 'Connecting…', tone: 'warn' });
  assert.deepEqual(statePill(tv({ state: 'casting' })), { text: 'Casting Live', tone: 'ok' });
  assert.deepEqual(statePill(tv({ state: 'reconnecting' })), { text: 'Reconnecting', tone: 'warn' });
  assert.deepEqual(statePill(tv({ state: 'error', error: 'The TV refused Play (500).' })), { text: 'The TV refused Play (500).', tone: 'danger' });
  assert.equal(statePill(tv({ state: 'error' })).tone, 'danger');
});

test('the button toggles between Cast and Disconnect', () => {
  assert.equal(castButtonLabel(tv()), 'Cast');
  for (const state of ['connecting', 'casting', 'reconnecting', 'error']) {
    assert.equal(isCasting(tv({ state })), true, state);
    assert.equal(castButtonLabel(tv({ state })), 'Disconnect', state);
  }
});

test('the top bar badge counts TVs and says nothing when none are casting', () => {
  assert.equal(topBarCastLabel(0), null);
  assert.equal(topBarCastLabel(undefined), null);
  assert.equal(topBarCastLabel(1), 'Casting · 1 TV');
  assert.equal(topBarCastLabel(2), 'Casting · 2 TVs');
});

test('Scan, Cast to All and Stop All are enabled only when they can do something', () => {
  assert.deepEqual(castControls({ tvs: [] }), { scan: true, castAll: false, stopAll: false });
  assert.deepEqual(castControls({ tvs: [tv()] }), { scan: true, castAll: true, stopAll: false });
  assert.deepEqual(castControls({ tvs: [tv({ state: 'casting' })] }), { scan: true, castAll: false, stopAll: true });
  assert.deepEqual(castControls({ tvs: [tv(), tv({ id: 'b', state: 'casting' })] }), { scan: true, castAll: true, stopAll: true });
  assert.deepEqual(castControls({ tvs: [tv()], scanning: true }), { scan: false, castAll: true, stopAll: false });
  assert.deepEqual(castControls({ tvs: [tv()] }, { busy: true }), { scan: false, castAll: false, stopAll: false });
  assert.deepEqual(castControls(null), { scan: true, castAll: false, stopAll: false });
});

test('the Remote view settings carry the Nearby TV Cast section with its title, subtitle and actions', () => {
  const settings = read('src/settings/TvCastSettings.tsx');
  assert.match(settings, /Nearby TV Cast \(Smart TV & Chromecast\)/);
  assert.match(settings, /Cast live slides to multiple Smart TVs on the same Wi-Fi without opening a TV browser\./);
  for (const label of ['Scan for TVs', 'Add TV by IP', 'Cast to All', 'Stop All', 'Windows Wireless Display \\(Win\\+K\\)']) assert.match(settings, new RegExp(label), label);
  assert.match(settings, /one display at a time/);
  assert.match(settings, /several TVs at once/);
  assert.match(read('src/settings/RemoteViewSettings.tsx'), /<TvCastSettings \/>/);
});

test('every button, input and select in the TV cast UI carries NO_DRAG', () => {
  for (const file of ['src/settings/TvCastSettings.tsx', 'src/operator/TvCastBadge.tsx']) {
    const source = read(file);
    // Each control's props run from its opening tag to the next "<", which no prop in these files contains.
    const controls = [...source.matchAll(/<(?:button|input|select)\s[^<]*/g)].map((m) => m[0]);
    assert.ok(controls.length > 0, file);
    for (const control of controls) assert.match(control, /NO_DRAG|no-drag/, `${file}: ${control.slice(0, 80)}`);
  }
});

test('the top bar shows the cast badge, and it opens Settings, Connections, Remote view', () => {
  assert.match(read('src/operator/TopBar.tsx'), /<TvCastBadge \/>/);
  assert.match(read('src/operator/TvCastBadge.tsx'), /view: 'settings', settingsSection: 'remote'/);
  assert.match(read('src/settings/Settings.tsx'), /\{ key: 'remote', label: 'Remote view' \}/);
});

test('the Windows page is opened by name from a fixed list, never by an address the page sends', () => {
  const main = read('electron/main.js');
  assert.match(main, /WINDOWS_DISPLAY_PAGES = \['ms-settings-connectabledevices:devicediscovery', 'ms-settings:connecteddevices'\]/);
  const handler = main.slice(main.indexOf("ipcMain.handle('tvCast:openWindowsDisplay'"), main.indexOf('let tvCastStopped'));
  assert.doesNotMatch(handler, /_event,\s*\w+/, 'the handler takes no argument from the page');
});
