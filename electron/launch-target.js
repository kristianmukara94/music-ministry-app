// What a Launchpad shortcut may open. A shortcut can come from a settings file someone else made, so the main process checks it here rather
// than handing it to the system as it is: only a web address or the full path of a file. Programs and scripts stay allowed, because pinning
// an app is what the Launchpad is for, but the operator is asked first. Pure, so it can be tested under plain Node.
import path from 'node:path';

const MAX_TARGET = 2048;

export const LAUNCH_REFUSED_DETAIL = 'A shortcut can be a web address starting with http:// or https://, or the full path of a file or program, such as C:\\Songs\\Sunday.pdf.';

/** File types Windows runs rather than opens, including the ones that only point at something else (.lnk, .url). */
const RUNS_CODE = new Set([
  '.exe', '.com', '.scr', '.pif', '.cpl', '.msi', '.msp', '.mst', '.msc', '.msix', '.msixbundle', '.appx', '.appxbundle', '.application', '.appref-ms',
  '.bat', '.cmd', '.ps1', '.psm1', '.psd1', '.ps2', '.vb', '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf', '.wsh', '.wsc', '.hta', '.htc', '.sct', '.shb', '.shs',
  '.jar', '.jnlp', '.py', '.pyw', '.pl', '.rb', '.reg', '.inf', '.lnk', '.url', '.scf', '.settingcontent-ms', '.library-ms', '.search-ms', '.searchconnector-ms',
  '.chm', '.hlp', '.diagcab', '.gadget', '.xll', '.xbap', '.wsb', '.sh', '.command', '.app', '.desktop',
]);

const refused = { kind: 'refused' };

/**
 * What to do with a shortcut's target: `{ kind: 'url', url }`, `{ kind: 'file', path, confirm, remote }`, or `{ kind: 'refused' }`. `confirm` says
 * the operator must agree first: the file runs code, or it is on another computer (opening a \\server path sends that computer the Windows sign-in).
 */
export function checkLaunchTarget(target, platform = process.platform) {
  const text = typeof target === 'string' ? target.trim() : '';
  // eslint-disable-next-line no-control-regex
  if (!text || text.length > MAX_TARGET || /[\u0000-\u001f]/.test(text)) return refused;

  if (/^https?:/i.test(text)) {
    try {
      const url = new URL(text);
      return url.hostname ? { kind: 'url', url: url.href } : refused;
    } catch {
      return refused;
    }
  }
  // Any other scheme (file:, ms-msdt:, search-ms: ...) can start a program with arguments the operator never sees. A drive letter is one character, so it is not a scheme.
  if (/^[a-z][a-z0-9+.-]+:/i.test(text)) return refused;

  return platform === 'win32' ? checkWindowsPath(text) : checkPosixPath(text);
}

/** The extension Windows acts on: it ignores dots and spaces at the end of a name, so `run.exe.` still runs. */
function extensionOf(file, api) {
  return api.extname(file.replace(/[. ]+$/, '')).toLowerCase();
}

function checkWindowsPath(text) {
  const normal = text.replace(/\//g, '\\');
  // \\?\ and \\.\ reach devices and skip the system's checks on a path.
  if (/^\\\\[?.]\\/.test(normal)) return refused;
  const remote = /^\\\\[^\\]+\\[^\\]+/.test(normal);
  if (!remote && !/^[a-z]:\\/i.test(normal)) return refused;
  // A colon past the drive letter names a hidden stream inside a file.
  if (normal.slice(2).includes(':')) return refused;
  return { kind: 'file', path: normal, remote, confirm: remote || RUNS_CODE.has(extensionOf(normal, path.win32)) };
}

function checkPosixPath(text) {
  if (!text.startsWith('/')) return refused;
  return { kind: 'file', path: text, remote: false, confirm: RUNS_CODE.has(extensionOf(text, path.posix)) };
}
