// What a Launchpad shortcut may open, and when the operator is asked first. Run with: node --test electron/launch-target.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLaunchTarget } from './launch-target.js';

const win = (target) => checkLaunchTarget(target, 'win32');

test('a web address opens in the browser', () => {
  assert.deepEqual(win('https://www.cbcponline.net/readings'), { kind: 'url', url: 'https://www.cbcponline.net/readings' });
  assert.deepEqual(win('  HTTP://example.com '), { kind: 'url', url: 'http://example.com/' });
});

test('a document opens with no question asked', () => {
  assert.deepEqual(win('C:\\Songs\\Sunday.pdf'), { kind: 'file', path: 'C:\\Songs\\Sunday.pdf', remote: false, confirm: false });
  assert.equal(win('D:/Decks/Easter.pptx').path, 'D:\\Decks\\Easter.pptx');
  assert.equal(win('D:/Decks/Easter.pptx').confirm, false);
  assert.equal(win('C:\\Songs').confirm, false, 'a folder');
});

test('a program or script needs the operator to agree', () => {
  for (const target of ['C:\\OBS\\obs64.exe', 'C:\\a.BAT', 'C:\\a.cmd', 'C:\\a.ps1', 'C:\\a.vbs', 'C:\\a.js', 'C:\\a.hta', 'C:\\a.lnk', 'C:\\a.url', 'C:\\a.msi', 'C:\\a.scr', 'C:\\a.jar', 'C:\\a.reg', 'C:\\a.chm']) {
    assert.equal(win(target).confirm, true, target);
  }
});

test('Windows ignores dots and spaces at the end of a name, so they do not hide a program', () => {
  assert.equal(win('C:\\run.exe.').confirm, true);
  assert.equal(win('C:\\run.exe. .').confirm, true);
});

test('a file on another computer needs the operator to agree, as opening it sends that computer the sign-in', () => {
  const remote = win('\\\\parish-server\\share\\Sunday.pdf');
  assert.deepEqual([remote.kind, remote.remote, remote.confirm], ['file', true, true]);
  assert.equal(win('//parish-server/share/Sunday.pdf').remote, true);
});

test('other schemes are refused, whatever they point at', () => {
  for (const target of ['file:///C:/Windows/System32/calc.exe', 'ms-msdt:/id PCWDiagnostic', 'search-ms:query=x', 'javascript:alert(1)', 'mailto:a@b.c', 'zoommtg://zoom.us/join', 'vbscript:x']) {
    assert.deepEqual(win(target), { kind: 'refused' }, target);
  }
});

test('anything that is not a full path is refused', () => {
  for (const target of ['notepad.exe', '..\\..\\evil.exe', '\\Windows\\calc.exe', 'C:evil.exe', '', '   ']) {
    assert.deepEqual(win(target), { kind: 'refused' }, JSON.stringify(target));
  }
});

test('device paths, hidden streams and control characters are refused', () => {
  for (const target of ['\\\\?\\C:\\evil.exe', '\\\\.\\PhysicalDrive0', 'C:\\a.txt:evil.exe', 'C:\\a\u0000.pdf', 'C:\\a\n.pdf', `C:\\${'a'.repeat(3000)}.pdf`]) {
    assert.deepEqual(win(target), { kind: 'refused' }, JSON.stringify(target).slice(0, 40));
  }
});

test('what is not text is refused', () => {
  for (const target of [undefined, null, 7, {}, ['C:\\a.pdf']]) assert.deepEqual(win(target), { kind: 'refused' });
});

test('on another system a full path is needed too', () => {
  assert.equal(checkLaunchTarget('/home/me/run.sh', 'linux').confirm, true);
  assert.equal(checkLaunchTarget('/home/me/doc.pdf', 'linux').confirm, false);
  assert.deepEqual(checkLaunchTarget('doc.pdf', 'linux'), { kind: 'refused' });
});
