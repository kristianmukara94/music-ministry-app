// Tests for the Cloud sync panel's logic: the activity ring buffer, the status pill, the channel cards, the two-step unlink and the
// diagnostics text. Synthetic names only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_LIMIT, channelCards, connectionPill, createActivityLog, diagnosticsText, failedPlanWhen, planRunEntry, redact, songRunEntry,
  songTotal, themeEntry, unlinkStep,
} from './cloud-sync-panel.js';

const NOW = Date.parse('2026-11-21T09:00:00.000Z');
const FAKE_TOKEN = 'Q2xhdWRlU2FtcGxlVG9rZW5Ob3RSZWFsQXRBbGxfX19fX19fXw';

test('the activity log keeps only the last ten events, newest first', () => {
  let clock = NOW;
  const log = createActivityLog({ now: () => clock });
  for (let i = 0; i < 13; i += 1) {
    clock += 1000;
    log.record({ channel: 'plans', direction: 'push', status: 'ok', summary: `run ${i}` });
  }
  const list = log.list();
  assert.equal(ACTIVITY_LIMIT, 10);
  assert.equal(list.length, 10);
  assert.equal(list[0].summary, 'run 12');
  assert.equal(list[9].summary, 'run 3');
  assert.ok(list[0].at > list[1].at);
  list[0].summary = 'changed outside';
  assert.equal(log.list()[0].summary, 'run 12', 'callers get a copy');
});

test('an activity entry is cleaned: unknown fields fall back, and secrets are removed', () => {
  const log = createActivityLog({ now: () => NOW });
  const e = log.record({ channel: 'weird', direction: 'sideways', status: 'great', summary: `sent with Bearer ${FAKE_TOKEN} and token=${FAKE_TOKEN}` });
  assert.deepEqual([e.channel, e.direction, e.status], ['plans', 'push', 'ok']);
  assert.doesNotMatch(e.summary, new RegExp(FAKE_TOKEN));
});

test('a plan run becomes a summary with counts and the first reason, and no title', () => {
  const ok = planRunEntry({ trigger: 'auto', status: 'synced', counts: { sent: 2, received: 0, deleted: 0, failed: 0, held: 0 } });
  assert.deepEqual([ok.direction, ok.status, ok.summary], ['push', 'ok', '2 plans sent']);
  const mixed = planRunEntry({ trigger: 'retry', status: 'synced', counts: { sent: 1, received: 1, deleted: 0, failed: 3 }, message: 'Sample reason.' });
  assert.equal(mixed.direction, 'both');
  assert.equal(mixed.status, 'warn');
  assert.match(mixed.summary, /3 plans failed: Sample reason\./);
  assert.equal(planRunEntry({ status: 'synced', counts: { sent: 0, received: 0, deleted: 0, failed: 0 } }).summary, 'Up to date: nothing to send or receive.');
  assert.equal(planRunEntry({ status: 'offline' }).status, 'error');
});

test('song and theme entries', () => {
  assert.equal(songTotal({ created: 2, updated: 1, unchanged: 7, removed: 4 }), 10);
  assert.equal(songTotal(null), null);
  assert.match(songRunEntry({ status: 'synced', counts: { created: 1, updated: 0, unchanged: 9, removed: 0 } }).summary, /10 song titles in step · 1 changed/);
  assert.equal(songRunEntry({ status: 'error', message: 'Sample refusal.' }).summary, 'Sample refusal.');
  assert.equal(themeEntry({ ok: true, theme: 'obsidian' }).status, 'ok');
  assert.equal(themeEntry({ ok: false, message: 'The planner cannot store themes yet.' }).status, 'warn');
});

test('the status pill: connected, syncing, attention, offline, not linked', () => {
  const link = { linked: true };
  assert.equal(connectionPill({ link: { linked: false } }).tone, 'unlinked');
  assert.deepEqual(connectionPill({ link, plans: { status: 'synced' }, songs: { status: 'synced' } }), { tone: 'connected', label: 'Connected · Online' });
  assert.equal(connectionPill({ link, plans: { status: 'syncing' } }).label, 'Syncing…');
  assert.equal(connectionPill({ link, plans: { status: 'synced', failures: [{ uuid: 'a' }] } }).label, 'Attention Needed');
  assert.equal(connectionPill({ link, songs: { status: 'error' } }).tone, 'attention');
  assert.equal(connectionPill({ link: { linked: true, offline: true }, plans: { status: 'synced', failures: [{}] } }).label, 'Offline', 'offline wins');
});

test('the three channel cards show badge, count and last sync', () => {
  const cards = channelCards({
    plans: { status: 'synced', lastSyncedAt: '2026-11-21T08:55:00.000Z', counts: { sent: 3, received: 1, deleted: 0, failed: 2, held: 1 }, failures: [{}, {}] },
    songs: { status: 'synced', lastSyncedAt: '2026-11-21T08:59:50.000Z', counts: { created: 0, updated: 0, unchanged: 12, removed: 0 } },
    theme: { theme: 'obsidian', themeUpdatedAt: '2026-11-21T08:00:00.000Z', themeDirty: true, status: 'offline', message: 'The planner cannot store themes yet.' },
  }, NOW);
  assert.deepEqual(cards.map((c) => c.id), ['plans', 'songs', 'theme']);
  assert.deepEqual([cards[0].tone, cards[0].badge, cards[0].count, cards[0].last], ['attention', '2 failed', '3 sent · 1 received · 1 held', '5 minutes ago']);
  assert.deepEqual([cards[1].tone, cards[1].count, cards[1].last], ['connected', '12 song titles', 'Just now']);
  assert.deepEqual([cards[2].tone, cards[2].badge, cards[2].detail], ['attention', 'Waiting', 'The planner cannot store themes yet.']);
  const empty = channelCards({}, NOW);
  assert.deepEqual(empty.map((c) => c.badge), ['Waiting', 'Waiting', 'Not sent']);
});

test('a failed plan says its date and schedule; a Praise & Worship plan says so', () => {
  assert.match(failedPlanWhen({ date: '2026-12-06', kind: 'mass', massTime: '6:00 AM', massLanguage: 'Cebuano' }), /2026.*· 6:00 AM · Cebuano$/);
  assert.match(failedPlanWhen({ date: '2026-12-06', kind: 'pw' }), /· Praise & Worship$/);
  assert.equal(failedPlanWhen({}), 'No date');
});

test('unlink takes two steps, and cancel or a stray action never unlinks', () => {
  assert.equal(unlinkStep('idle', 'confirm'), 'idle', 'no unlink without the first step');
  assert.equal(unlinkStep('idle', 'request'), 'confirming');
  assert.equal(unlinkStep('confirming', 'cancel'), 'idle');
  assert.equal(unlinkStep('confirming', 'request'), 'confirming');
  assert.equal(unlinkStep('confirming', 'confirm'), 'unlinking');
  assert.equal(unlinkStep('unlinking', 'cancel'), 'unlinking', 'cannot cancel once sent');
  assert.equal(unlinkStep('unlinking', 'done'), 'idle');
});

test('diagnostics hold connection, schema and channel health, never a token, password or plan title', () => {
  const text = diagnosticsText({
    appVersion: '1.0.85',
    platform: 'win32 x64',
    link: { linked: true, address: 'https://cloud.example.test', offline: false, error: null, token: FAKE_TOKEN },
    license: { statusText: 'Licensed until 1 Jan 2027' },
    plans: {
      status: 'synced', autoSync: false, lastSyncedAt: '2026-11-21T08:55:00.000Z', counts: { sent: 0, received: 0, deleted: 0, failed: 1 },
      failures: [{ uuid: 'u', title: 'Sample Plan Title', date: '2026-12-06', kind: 'mass', massTime: '6:00 AM', code: 'db_schema', reason: 'The website\'s database is missing "synced_at". Ask your admin to run the latest database migration.' }],
    },
    songs: { status: 'synced', lastSyncedAt: '2026-11-21T08:59:00.000Z' },
    theme: { theme: 'obsidian', themeDirty: true, message: `The planner cannot store themes yet. password=Sample-Password-1 postgres://user:pw@host/db` },
    activity: [{ at: '2026-11-21T08:55:00.000Z', direction: 'push', channel: 'plans', status: 'warn', summary: '1 plan failed' }],
    now: NOW,
  });
  assert.match(text, /App version: 1\.0\.85/);
  assert.match(text, /Cloud address: https:\/\/cloud\.example\.test/);
  assert.match(text, /Auto-Sync: paused/);
  assert.match(text, /\[db_schema\]/);
  assert.match(text, /Needs attention: .*migration/);
  assert.match(text, /↑ Push plans warn: 1 plan failed/);
  assert.doesNotMatch(text, new RegExp(FAKE_TOKEN));
  assert.doesNotMatch(text, /Sample Plan Title/);
  assert.doesNotMatch(text, /Sample-Password-1/);
  assert.doesNotMatch(text, /user:pw@host/);
});

test('redact leaves plain sentences alone', () => {
  assert.equal(redact('Plans synced 5 minutes ago.'), 'Plans synced 5 minutes ago.');
});
