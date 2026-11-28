// The Service Console dashboard: the LAN address phones open, the readiness of the loaded service's content, the Cloud Sync line, the plan a
// scheduled Holy Mass time belongs to, and the unified Operator Preview wording. Synthetic data only.
// Run with: node --test shared/service-console.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cloudSyncReadiness, isoDayInZone, lanUrl, scheduledPlan, serviceGaps, serviceGapsText } from './service-console.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
/** The English value of one string key in src/i18n/strings.ts (the first, English, table). */
const en = (key) => {
  const src = read('src/i18n/strings.ts');
  const table = src.slice(src.indexOf('const en = {'), src.indexOf('export type StringKey'));
  const m = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*(['"])(.*?)\\1,`).exec(table);
  return m ? m[2] : undefined;
};

// ── LAN URL ───────────────────────────────────────────────────────────────

test('lanUrl builds the address a phone opens', () => {
  assert.equal(lanUrl('192.168.1.20', 8787), 'http://192.168.1.20:8787');
  assert.equal(lanUrl(' 10.0.0.5 ', '9000'), 'http://10.0.0.5:9000');
});

test('lanUrl brackets an IPv6 address and keeps a reported URL as it is', () => {
  assert.equal(lanUrl('fe80::1', 8787), 'http://[fe80::1]:8787');
  assert.equal(lanUrl('[fe80::1]', 8787), 'http://[fe80::1]:8787');
  assert.equal(lanUrl('http://192.168.1.20:8787/', null), 'http://192.168.1.20:8787');
});

test('lanUrl is null without an address or a usable port', () => {
  assert.equal(lanUrl(null, 8787), null);
  assert.equal(lanUrl('', 8787), null);
  assert.equal(lanUrl('192.168.1.20', 0), null);
  assert.equal(lanUrl('192.168.1.20', 70000), null);
  assert.equal(lanUrl('192.168.1.20', 'abc'), null);
});

// ── Service content ───────────────────────────────────────────────────────

const row = (label, extra = {}) => ({ id: label, label, module: 'custom', sourceId: label, ...extra });

test('serviceGaps counts missing queue content and unfilled Praise & Worship segments', () => {
  const queue = [row('Sample Mass Item'), row('Sample Media', { module: 'media', stale: true }), row('Sample Song Title', { module: 'lyrics', stale: true })];
  const gaps = serviceGaps(queue, ['ready', 'needs_prayer', 'needs_prayer', 'needs_song', 'auto', 'missing']);
  assert.deepEqual(gaps, { missing: 3, missingMedia: 1, needsPrayer: 2, needsSong: 1, total: 6 });
  assert.equal(serviceGapsText(gaps), '1 missing media · 2 missing items · 2 need a prayer · 1 needs a song');
});

test('a complete service has no gaps and no warning text', () => {
  const gaps = serviceGaps([row('Sample Mass Item')], ['ready', 'auto']);
  assert.equal(gaps.total, 0);
  assert.equal(serviceGapsText(gaps), '');
  assert.equal(serviceGaps(null, null).total, 0);
});

test('one unfilled prayer reads in the singular', () => {
  assert.equal(serviceGapsText(serviceGaps([], ['needs_prayer'])), '1 needs a prayer');
});

// ── Cloud Sync ────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-11-28T10:00:00Z');
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();

test('a linked laptop that synced recently is ready, with Sync offered', () => {
  const r = cloudSyncReadiness({ linked: true }, { status: 'synced', lastSyncedAt: minutesAgo(5) }, NOW);
  assert.deepEqual(r, { ok: true, linked: true, canSync: true, detail: 'Last synced 5 minutes ago' });
});

test('an offline link warns and offers no Sync', () => {
  const r = cloudSyncReadiness({ linked: true, offline: true }, { status: 'idle', lastSyncedAt: minutesAgo(120) }, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.canSync, false);
  assert.match(r.detail, /^Offline · last synced 2 hours ago$/);
});

test('plans that were not sent warn, and Sync can retry', () => {
  const r = cloudSyncReadiness({ linked: true }, { status: 'synced', lastSyncedAt: minutesAgo(1), counts: { sent: 0, received: 0, deleted: 0, failed: 2 } }, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.canSync, true);
  assert.match(r.detail, /^2 plans not sent/);
});

test('an unlinked laptop is neutral: cloud sync is optional', () => {
  assert.deepEqual(cloudSyncReadiness({ linked: false }, null, NOW), { ok: null, linked: false, canSync: false, detail: 'Not linked to the parish website' });
  assert.equal(cloudSyncReadiness(null, null, NOW).ok, null);
});

test('a sync in progress offers no second Sync', () => {
  const r = cloudSyncReadiness({ linked: true }, { status: 'syncing' }, NOW);
  assert.equal(r.canSync, false);
  assert.equal(r.ok, true);
});

// ── Next Holy Mass ────────────────────────────────────────────────────────

test('isoDayInZone reads the calendar day in the parish zone', () => {
  // 23:30 UTC on 28 November is already 29 November in Manila (UTC+8).
  const at = Date.parse('2026-11-28T23:30:00Z');
  assert.equal(isoDayInZone(at, 'Asia/Manila'), '2026-11-29');
  assert.equal(isoDayInZone(at, 'UTC'), '2026-11-28');
});

test('scheduledPlan picks the plan at the scheduled time, else the day\'s only plan', () => {
  const plans = [
    { id: 1, name: 'Sample Plan A', liturgicalDate: '2026-11-29', massTime: '6:00 AM' },
    { id: 2, name: 'Sample Plan B', liturgicalDate: '2026-11-29', massTime: '9:30 AM' },
    { id: 3, name: 'Sample Plan C', liturgicalDate: '2026-12-06' },
  ];
  assert.equal(scheduledPlan(plans, '2026-11-29', '09:30')?.id, 2);
  assert.equal(scheduledPlan(plans, '2026-11-29', '06:00')?.id, 1);
  assert.equal(scheduledPlan(plans, '2026-12-06', '08:00')?.id, 3);
  // Two plans, neither at the time: no guess.
  assert.equal(scheduledPlan(plans, '2026-11-29', '17:00'), null);
  assert.equal(scheduledPlan(plans, '2026-12-13', '08:00'), null);
  assert.equal(scheduledPlan(null, '2026-11-29', '08:00'), null);
});

// ── Unified Operator Preview wording and de-duplicated projector buttons ──

test('the third status card reads Operator Preview, with an Open Preview button', () => {
  assert.equal(en('card.mirror'), 'Operator Preview');
  assert.equal(en('card.preview'), 'Operator Preview');
  assert.equal(en('card.action.mirrorOpen'), 'Open Preview');
  assert.equal(en('card.action.mirrorClose'), 'Close Preview');
  assert.equal(en('top.preview'), 'Preview');
  const dash = read('src/operator/Dashboard.tsx');
  assert.match(dash, /eyebrow=\{t\('card\.mirror'\)\}/);
  assert.match(dash, /detail=\{t\('card\.preview'\)\}/);
  // No status card or action still says Mirror in English.
  for (const key of ['card.mirror', 'card.preview', 'card.action.mirrorOpen', 'card.action.mirrorClose']) assert.doesNotMatch(en(key), /Mirror/);
});

test('Turn On Projector stays on the Congregation Output card; the readiness row is a status with Identify Screen', () => {
  assert.equal(en('card.action.projectorOn'), 'Turn On Projector');
  assert.match(read('src/operator/Dashboard.tsx'), /t\('card\.action\.projectorOn'\)/);
  const widget = read('src/operator/PreServiceWidget.tsx');
  assert.doesNotMatch(widget, /ready\.fixProjector/);
  assert.match(widget, /bridge\.displays\.identify\(\)/);
  assert.equal(en('ready.identify'), 'Identify Screen');
});

test('the readiness card offers Copy and QR for the remote, Cloud Sync, the content check and the countdown links', () => {
  const widget = read('src/operator/PreServiceWidget.tsx');
  for (const key of ['ready.copy', 'ready.copied', 'ready.qr', 'ready.cloud', 'ready.cloudSync', 'ready.content', 'count.openPlan', 'count.readings']) {
    assert.ok(en(key), `${key} has English text`);
    assert.ok(widget.includes(`'${key}'`), `${key} is used by the readiness card`);
  }
  assert.equal(en('ready.copied'), 'Copied');
  assert.match(widget, /qrDataUrl\(/);
});

test('System Health copies the network address and reads its secondary figures at body contrast', () => {
  const panel = read('src/operator/SystemHealthPanel.tsx');
  assert.match(panel, /copy\(h\.address/);
  assert.equal(en('health.copied'), 'Copied');
  const sub = /\{sub && <div className="([^"]+)"/.exec(panel);
  assert.ok(sub, 'Metric renders its secondary line');
  assert.doesNotMatch(sub[1], /text-faint/);
  assert.match(sub[1], /text-fg\/(7\d|8\d|9\d)|text-fg\b/);
});
