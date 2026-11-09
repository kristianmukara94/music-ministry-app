// Tests for the Users page's rules and wiring: the search, the role filter, the team counts, who "you" is, the copied credentials, and that
// the page keeps to the site's security rules. Run with: node --test server/test/web-users-page.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES, STATUS, credentialsText, filterUsers, isPending, isSelf, teamSummary } from '../../web/js/user-list.js';
import { ROLES as SERVER_ROLES } from '../lib/rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.resolve(here, '..', '..', 'web', file), 'utf8');
const html = read('users.html');
const script = read('js/users.js');
const css = read('css/planner.css');

const SIGNED_IN = '2026-10-01T08:00:00.000Z';
const USERS = [
  { id: '1', username: 'boss', displayName: 'Maria Santos', role: 'admin', status: 'active', lastSignInAt: SIGNED_IN },
  { id: '2', username: 'jdelacruz', displayName: 'Juan Dela Cruz', role: 'planner', status: 'active', lastSignInAt: null },
  { id: '3', username: 'ana', displayName: 'Ana Reyes', role: 'planner', status: 'locked', lastSignInAt: null },
  { id: '4', username: 'gone', displayName: 'Old Viewer', role: 'viewer', status: 'disabled', lastSignInAt: null },
];
const ids = (users) => users.map((u) => u.id);

test('the page offers the server\'s roles, and knows every status the server sends', () => {
  assert.deepEqual([...ROLES].sort(), [...SERVER_ROLES].sort());
  assert.deepEqual(Object.keys(STATUS).sort(), ['active', 'disabled', 'locked']);
});

test('the summary counts the whole team by role', () => {
  assert.deepEqual(teamSummary(USERS), { total: 4, admins: 1, planners: 2, viewers: 1, pending: 2 });
  assert.deepEqual(teamSummary([]), { total: 0, admins: 0, planners: 0, viewers: 0, pending: 0 });
});

test('pending means nobody has signed in yet, and a disabled account is not waiting', () => {
  assert.equal(isPending(USERS[0]), false);
  assert.equal(isPending(USERS[1]), true);
  assert.equal(isPending(USERS[2]), true);
  assert.equal(isPending(USERS[3]), false);
});

test('the search finds a username or a display name, in any case, and ignores outside spaces', () => {
  assert.deepEqual(ids(filterUsers(USERS, { q: 'JDELA' })), ['2']);
  assert.deepEqual(ids(filterUsers(USERS, { q: '  santos ' })), ['1']);
  assert.deepEqual(ids(filterUsers(USERS, { q: 'nobody here' })), []);
  assert.deepEqual(ids(filterUsers(USERS, { q: '   ' })), ['1', '2', '3', '4']);
});

test('the role filter works alone and together with the search', () => {
  assert.deepEqual(ids(filterUsers(USERS, { role: 'All' })), ['1', '2', '3', '4']);
  assert.deepEqual(ids(filterUsers(USERS, { role: 'planner' })), ['2', '3']);
  assert.deepEqual(ids(filterUsers(USERS, { role: 'planner', q: 'ana' })), ['3']);
  assert.deepEqual(ids(filterUsers(USERS, { role: 'viewer', q: 'ana' })), []);
});

test('"you" is matched on the username, whatever its case, and nobody matches a missing session', () => {
  assert.equal(isSelf(USERS[0], { username: 'BOSS' }), true);
  assert.equal(isSelf(USERS[1], { username: 'boss' }), false);
  assert.equal(isSelf(USERS[0], null), false);
  assert.equal(isSelf(USERS[0], {}), false);
});

test('Copy carries the username and the password', () => {
  assert.equal(credentialsText('ana', 'Xy7-secret'), 'Username: ana\nTemporary password: Xy7-secret');
});

test('the page has the summary, the search, the role filter and the credentials modal', () => {
  for (const id of ['stat-total', 'stat-admins', 'stat-planners', 'stat-viewers', 'stat-pending', 'user-search-input', 'user-role-filter', 'credentials-modal', 'credentials-username', 'credentials-password', 'credentials-copy', 'credentials-close']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} is on the page`);
  }
  assert.doesNotMatch(html, /temp-dialog/);
  for (const label of ['All Roles', 'Admin', 'Planner', 'Viewer']) assert.match(html, new RegExp(`>${label}</option>`));
});

test('every id the script looks up is on the page', () => {
  const looked = [...script.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]);
  assert.ok(looked.length > 10);
  for (const id of looked) assert.match(html, new RegExp(`id="${id}"`), `${id} is on the page`);
});

test('the signed-in admin cannot disable or demote themselves from their own card', () => {
  assert.match(script, /disabled: self \|\| busy,\s*extra:/, 'the Disable button');
  assert.match(script, /'aria-describedby': describedBy, disabled: self \|\| busy/, 'the role select');
  assert.match(script, /class: 'badge-pill badge-you' }, 'You'/);
});

test('a reset of one\'s own password keeps the credentials on screen and stops using the ended session', () => {
  assert.match(script, /sessionEnded = self;/);
  assert.match(script, /async function refresh\(\) \{\s*if \(sessionEnded\) return;/);
  assert.match(script, /if \(sessionEnded\) location\.replace\('login\.html'\);/);
});

test('the credentials are emptied however the modal closes, and Copy uses the clipboard', () => {
  assert.match(script, /addEventListener\('close', \(\) => \{\s*\$\('credentials-username'\)\.textContent = '';\s*\$\('credentials-password'\)\.textContent = '';/);
  assert.match(script, /navigator\.clipboard\.writeText\(/);
});

test('the page keeps to the Content Security Policy and adds no outside scripts', () => {
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
  assert.doesNotMatch(script, /\balert\(/);
  const sources = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(sources, ['js/users.js']);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/, 'no inline script');
  assert.doesNotMatch(html, /\son\w+="/, 'no inline event handler');
});

test('the status colours are the design\'s', () => {
  assert.match(css, /--status-active-text: #34d399;/);
  assert.match(css, /--status-active-bg: rgba\(52, 211, 153, 0\.12\);/);
  assert.match(css, /--status-disabled-text: #f87171;/);
  assert.match(css, /--status-disabled-bg: rgba\(239, 68, 68, 0\.12\);/);
});
