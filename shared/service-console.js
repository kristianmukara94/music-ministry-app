// The Service Console dashboard's pure helpers: the LAN address phones open, the readiness of the loaded Holy Mass queue and Praise & Worship
// lineup, the Cloud Sync readiness line, and the plan a scheduled Holy Mass time belongs to. Imports only other pure shared modules, so it runs in
// Electron, the browser and Node alike.
import { lastSyncedText } from './cloud-device.js';
import { sameMassTime } from './mass-schedule.js';

/**
 * The address a phone on the church Wi-Fi opens: "http://192.168.1.20:8787". An IPv6 address is bracketed. Null without an address or a
 * usable port. A full URL (as the remote server reports it) is returned as it is, trailing slash removed.
 */
export function lanUrl(address, port) {
  const host = String(address ?? '').trim();
  if (!host) return null;
  if (/^https?:\/\//i.test(host)) return host.replace(/\/+$/, '');
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return null;
  const bare = host.replace(/^\[|\]$/g, '');
  return `http://${bare.includes(':') ? `[${bare}]` : bare}:${p}`;
}

/**
 * What the loaded service still lacks. `queue` is the Holy Mass queue (a stale row's source was deleted, so its media or text is missing);
 * `pwStatuses` are the loaded Praise & Worship lineup's segment statuses (shared/pw.js segmentStatus).
 */
export function serviceGaps(queue, pwStatuses = []) {
  const rows = Array.isArray(queue) ? queue : [];
  const statuses = Array.isArray(pwStatuses) ? pwStatuses : [];
  const missing = rows.filter((q) => q && q.stale).length + statuses.filter((s) => s === 'missing').length;
  const missingMedia = rows.filter((q) => q && q.stale && q.module === 'media').length;
  const needsPrayer = statuses.filter((s) => s === 'needs_prayer').length;
  const needsSong = statuses.filter((s) => s === 'needs_song').length;
  return { missing, missingMedia, needsPrayer, needsSong, total: missing + needsPrayer + needsSong };
}

/** The gaps as one readiness line: "1 missing media · 2 need a prayer". Empty when nothing is missing. */
export function serviceGapsText(gaps) {
  const parts = [];
  const otherMissing = gaps.missing - gaps.missingMedia;
  if (gaps.missingMedia > 0) parts.push(`${gaps.missingMedia} missing media`);
  if (otherMissing > 0) parts.push(`${otherMissing} missing ${otherMissing === 1 ? 'item' : 'items'}`);
  if (gaps.needsPrayer > 0) parts.push(`${gaps.needsPrayer} ${gaps.needsPrayer === 1 ? 'needs' : 'need'} a prayer`);
  if (gaps.needsSong > 0) parts.push(`${gaps.needsSong} ${gaps.needsSong === 1 ? 'needs' : 'need'} a song`);
  return parts.join(' · ');
}

/**
 * The Cloud Sync readiness line. `link` is the cloud link status, `plans` the plan sync state. `ok` is null while unknown, and also when the
 * laptop is not linked (cloud sync is optional, so it never counts against readiness). `canSync` offers the one-click Sync.
 */
export function cloudSyncReadiness(link, plans, now = Date.now()) {
  if (!link) return { ok: null, linked: false, canSync: false, detail: '' };
  if (!link.linked) return { ok: null, linked: false, canSync: false, detail: 'Not linked to the parish website' };
  const status = plans?.status ?? 'idle';
  const when = lastSyncedText(plans?.lastSyncedAt ?? link.lastSeenAt ?? null, now);
  if (status === 'syncing') return { ok: true, linked: true, canSync: false, detail: 'Syncing…' };
  if (link.offline || status === 'offline') return { ok: false, linked: true, canSync: false, detail: `Offline · last synced ${when.toLowerCase()}` };
  const failed = plans?.counts?.failed ?? 0;
  if (status === 'error' || failed > 0) {
    const why = failed > 0 ? `${failed} ${failed === 1 ? 'plan' : 'plans'} not sent` : plans?.message || 'Sync failed';
    return { ok: false, linked: true, canSync: true, detail: `${why} · last synced ${when.toLowerCase()}` };
  }
  return { ok: true, linked: true, canSync: true, detail: `Last synced ${when.toLowerCase()}` };
}

/** The calendar day ("2026-11-29") an instant falls on in a time zone. */
export function isoDayInZone(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The Holy Mass plan for a scheduled time: the plan on that day at that time, else the day's only plan, else the day's plan with no time
 * set. Times compare as times of day, so "6:00 AM" matches "06:00". Null when the day has none, or several that the time does not tell apart.
 */
export function scheduledPlan(plans, date, time) {
  const day = (Array.isArray(plans) ? plans : []).filter((p) => p && p.liturgicalDate === date);
  if (day.length === 0) return null;
  const exact = day.find((p) => sameMassTime(p.massTime, time));
  if (exact) return exact;
  if (day.length === 1) return day[0];
  const untimed = day.filter((p) => !p.massTime);
  return untimed.length === 1 ? untimed[0] : null;
}
