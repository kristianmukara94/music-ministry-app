// The off-plan song history: the table, what a record holds, and how the IPC channels are wired. Run with: node --test electron/spontaneous-log.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { SPONTANEOUS_LOG_MIGRATIONS, createSpontaneousLog, serviceDateOf } = await import('./spontaneous-log.js');

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

function open(now) {
  const db = new DatabaseSync(':memory:');
  for (const sql of SPONTANEOUS_LOG_MIGRATIONS) db.exec(sql);
  return { db, log: createSpontaneousLog(db, now ? { now } : undefined) };
}

test('a logged song is saved with its id as text, its title, a timestamp and the local service day', () => {
  const { log } = open(() => new Date(2026, 10, 1, 19, 30));
  const id = log.log({ songId: 42, title: '  Amazing Grace ' });
  assert.equal(id, 1);
  const [row] = log.forDate('2026-11-01');
  assert.equal(row.songId, '42');
  assert.equal(row.title, 'Amazing Grace');
  assert.equal(row.serviceDate, '2026-11-01');
  assert.match(row.timestamp, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});

test('the same song may be logged twice, and each service day lists only its own songs, oldest first', () => {
  let day = new Date(2026, 10, 1, 9, 0);
  const { log } = open(() => day);
  log.log({ songId: 1, title: 'A' });
  log.log({ songId: 1, title: 'A' });
  log.log({ songId: 2, title: 'B' });
  day = new Date(2026, 10, 8, 9, 0);
  log.log({ songId: 3, title: 'C' });
  assert.deepEqual(log.forDate('2026-11-01').map((r) => r.title), ['A', 'A', 'B']);
  assert.deepEqual(log.forDate('2026-11-08').map((r) => r.title), ['C']);
});

test('a record with no song id or no title is refused, and nothing is saved', () => {
  const { log } = open();
  for (const bad of [null, {}, { songId: '', title: 'x' }, { songId: 1, title: '   ' }, { title: 'x' }]) {
    assert.throws(() => log.log(bad), /song id and a title/);
  }
  assert.equal(log.forDate(serviceDateOf(new Date())).length, 0);
});

test('a long title is cut, and the service day uses the local date with two digits', () => {
  const { log } = open(() => new Date(2026, 0, 5));
  log.log({ songId: 'a', title: 'x'.repeat(500) });
  assert.equal(log.forDate('2026-01-05')[0].title.length, 300);
  assert.equal(serviceDateOf(new Date(2026, 8, 3)), '2026-09-03');
});

test('the migration is last in the list, and the channels reach the renderer through the preload', () => {
  const migrations = read('./announcements.js');
  assert.ok(migrations.indexOf('...WHITEBOARD_LAYER_MIGRATIONS,') < migrations.indexOf('...SPONTANEOUS_LOG_MIGRATIONS,'), 'appended at the end');
  const main = read('./main.js');
  assert.match(main, /setupSpontaneousLog\(announcements\.db, \{ isProjectorOpen: \(\) => Boolean\(windows\.projector && !windows\.projector\.isDestroyed\(\)\) \}\)/);
  const preload = read('./preload.cjs');
  assert.match(preload, /invoke\('check-projector-window'\)/);
  assert.match(preload, /invoke\('log-spontaneous-song', input\)/);
  const service = read('./spontaneous-log.js');
  assert.match(service, /ipcMain\.handle\('check-projector-window'/);
  assert.match(service, /ipcMain\.handle\('log-spontaneous-song'/);
});
