// The Cloud sync panel's logic, kept apart from React so it can be tested under plain Node: the Recent Sync Activity ring buffer, the
// connection pill, the three channel cards, the two-step unlink, and the Copy Diagnostics text. The main process keeps the activity log;
// the screen only reads it. Nothing here ever holds a token, a password or a setup key.
import { lastSyncedText } from './cloud-device.js';

/** How many sync events the Sync Activity drawer keeps. */
export const ACTIVITY_LIMIT = 10;

/**
 * A ring buffer of sync events, newest first. Each entry is { at, direction: 'push' | 'pull' | 'both', channel: 'plans' | 'songs' | 'theme',
 * status: 'ok' | 'warn' | 'error', summary, trigger }. A summary is counts and a plain reason, never a plan title.
 */
export function createActivityLog({ limit = ACTIVITY_LIMIT, now = () => Date.now() } = {}) {
  let items = [];
  function record(entry) {
    const clean = {
      at: new Date(now()).toISOString(),
      direction: ['push', 'pull', 'both'].includes(entry?.direction) ? entry.direction : 'push',
      channel: ['plans', 'songs', 'theme'].includes(entry?.channel) ? entry.channel : 'plans',
      status: ['ok', 'warn', 'error'].includes(entry?.status) ? entry.status : 'ok',
      summary: redact(String(entry?.summary ?? '')).slice(0, 240),
      trigger: typeof entry?.trigger === 'string' ? entry.trigger.slice(0, 20) : 'auto',
    };
    items = [clean, ...items].slice(0, limit);
    return clean;
  }
  return { record, list: () => items.map((i) => ({ ...i })), clear: () => (items = []) };
}

/**
 * Drops anything that looks like a secret from text that may be copied out: a run of 32+ token characters (device tokens are base64url),
 * a Bearer header, a password= pair and a database URL with its credentials.
 */
export function redact(text) {
  return String(text ?? '')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database address removed]')
    .replace(/bearer\s+[^\s]+/gi, 'Bearer [removed]')
    .replace(/(password|token|secret)\s*[=:]\s*[^\s,;]+/gi, '$1=[removed]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[removed]');
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A plan sync run as an activity entry. `run` is what the plan sync reports after a run: { trigger, status, counts, message }. */
export function planRunEntry(run) {
  const c = run?.counts;
  if (run?.status === 'offline') return { channel: 'plans', direction: 'both', status: 'error', trigger: run.trigger, summary: 'Offline: nothing was sent or received.' };
  if (run?.status !== 'synced' || !c) return { channel: 'plans', direction: 'both', status: 'error', trigger: run?.trigger, summary: run?.message || 'Plans could not be synced.' };
  const parts = [];
  if (c.sent) parts.push(`${plural(c.sent, 'plan')} sent`);
  if (c.received) parts.push(`${plural(c.received, 'plan')} received`);
  if (c.deleted) parts.push(`${plural(c.deleted, 'plan')} removed`);
  if (c.failed) parts.push(`${plural(c.failed, 'plan')} failed${run.message ? `: ${run.message}` : ''}`);
  if (c.held) parts.push(`${plural(c.held, 'plan')} held`);
  const direction = c.sent && !c.received ? 'push' : c.received && !c.sent ? 'pull' : 'both';
  return { channel: 'plans', direction, status: c.failed ? 'warn' : 'ok', trigger: run.trigger, summary: parts.length ? parts.join(' · ') : 'Up to date: nothing to send or receive.' };
}

/** How many songs the website holds after a send: the server counts created, updated and unchanged ones (removed ones are gone). */
export function songTotal(counts) {
  if (!counts || typeof counts !== 'object') return null;
  const parts = ['created', 'updated', 'unchanged'].map((k) => counts[k]).filter((n) => typeof n === 'number');
  return parts.length ? parts.reduce((a, n) => a + n, 0) : null;
}

/** A song list send as an activity entry. `state` is the song sync's status after the run. */
export function songRunEntry(state, trigger = 'auto') {
  if (state?.status === 'synced') {
    const n = songTotal(state.counts);
    const changed = (state.counts?.created ?? 0) + (state.counts?.updated ?? 0) + (state.counts?.removed ?? 0);
    return { channel: 'songs', direction: 'push', status: 'ok', trigger, summary: n === null ? 'Song list sent.' : `${plural(n, 'song title')} in step · ${changed} changed.` };
  }
  if (state?.status === 'offline') return { channel: 'songs', direction: 'push', status: 'error', trigger, summary: 'Offline: the song list will be sent later.' };
  return { channel: 'songs', direction: 'push', status: 'error', trigger, summary: state?.message || 'The song list could not be sent.' };
}

/** A theme push as an activity entry. */
export function themeEntry({ ok, theme, message }, trigger = 'manual') {
  return ok
    ? { channel: 'theme', direction: 'push', status: 'ok', trigger, summary: `Website theme set to ${theme ?? 'this laptop’s theme'}.` }
    : { channel: 'theme', direction: 'push', status: 'warn', trigger, summary: message || 'The theme will be sent when the website can take it.' };
}

/**
 * The status pill at the top of the panel: 'connected' | 'syncing' | 'attention' | 'offline' | 'unlinked', with its words.
 * Attention wins over Connected whenever a channel has failed plans, an error, or a revoked link.
 */
export function connectionPill({ link, plans, songs, theme } = {}) {
  if (!link?.linked) return { tone: 'unlinked', label: 'Not linked' };
  if (link.offline || plans?.status === 'offline' || songs?.status === 'offline') return { tone: 'offline', label: 'Offline' };
  if (plans?.status === 'syncing' || songs?.status === 'syncing' || theme?.status === 'syncing') return { tone: 'syncing', label: 'Syncing…' };
  const failed = (plans?.failures?.length ?? 0) > 0 || (plans?.counts?.failed ?? 0) > 0;
  if (failed || plans?.status === 'error' || songs?.status === 'error' || link.error) return { tone: 'attention', label: 'Attention Needed' };
  return { tone: 'connected', label: 'Connected · Online' };
}

/** The newest of several ISO times, or null. */
export const latest = (...times) => times.filter(Boolean).sort().pop() ?? null;

/**
 * The three channel cards (Plans, Songs, Website Theme): a badge tone and label, a count line and the last sync time. `now` is for tests.
 */
export function channelCards({ plans, songs, theme } = {}, now = Date.now()) {
  const when = (iso) => (iso ? lastSyncedText(iso, now) : 'Not yet');
  const planFailed = plans?.failures?.length ?? plans?.counts?.failed ?? 0;
  const planBadge =
    plans?.status === 'syncing' ? ['syncing', 'Syncing'] :
    plans?.status === 'offline' ? ['offline', 'Offline'] :
    plans?.status === 'error' ? ['attention', 'Error'] :
    planFailed ? ['attention', `${planFailed} failed`] :
    plans?.lastSyncedAt ? ['connected', 'In step'] : ['idle', 'Waiting'];
  const c = plans?.counts;
  const planCount = c ? `${c.sent ?? 0} sent · ${c.received ?? 0} received${c.held ? ` · ${c.held} held` : ''}` : 'No run yet';

  const songBadge =
    songs?.status === 'syncing' ? ['syncing', 'Syncing'] :
    songs?.status === 'offline' ? ['offline', 'Offline'] :
    songs?.status === 'error' ? ['attention', 'Error'] :
    songs?.unsent ? ['idle', 'Waiting to send'] :
    songs?.lastSyncedAt ? ['connected', 'In step'] : ['idle', 'Waiting'];
  const total = songTotal(songs?.counts);
  const songCount = total === null ? (songs?.lastSyncedAt ? 'Song list sent' : 'No run yet') : `${plural(total, 'song title')}${songs?.skipped ? ` · ${songs.skipped} skipped` : ''}`;

  const themeBadge = !theme?.theme ? ['idle', 'Not sent'] : theme.themeDirty ? (theme.status === 'syncing' ? ['syncing', 'Sending'] : ['attention', 'Waiting']) : ['connected', 'On website'];
  return [
    { id: 'plans', title: 'Plans', tone: planBadge[0], badge: planBadge[1], count: planCount, last: when(plans?.lastSyncedAt), detail: plans?.status === 'error' ? plans.message ?? null : null },
    { id: 'songs', title: 'Songs', tone: songBadge[0], badge: songBadge[1], count: songCount, last: when(songs?.lastSyncedAt), detail: songs?.status === 'error' ? songs.message ?? null : null },
    { id: 'theme', title: 'Website Theme', tone: themeBadge[0], badge: themeBadge[1], count: theme?.theme ?? 'No theme sent', last: when(theme?.themeUpdatedAt), detail: theme?.themeDirty && theme?.message ? theme.message : null },
  ];
}

/** "Sat 6 Dec 2026 · 6:00 AM · Cebuano" for a failed plan; P&W plans have no schedule. */
export function failedPlanWhen(f) {
  const parts = [];
  if (f?.date) {
    const d = new Date(`${f.date}T00:00:00`);
    parts.push(Number.isNaN(d.getTime()) ? f.date : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
  }
  if (f?.kind === 'pw') parts.push('Praise & Worship');
  else {
    if (f?.massTime) parts.push(f.massTime);
    if (f?.massLanguage) parts.push(f.massLanguage);
  }
  return parts.join(' · ') || 'No date';
}

/**
 * The two-step unlink: 'idle' → (request) → 'confirming' → (confirm) → 'unlinking' → (done) → 'idle'; cancel goes back to idle from
 * confirming. Any other action leaves the step as it is, so a stray click can never unlink.
 */
export function unlinkStep(step, action) {
  if (action === 'request' && step === 'idle') return 'confirming';
  if (action === 'cancel' && step === 'confirming') return 'idle';
  if (action === 'confirm' && step === 'confirming') return 'unlinking';
  if (action === 'done' && step === 'unlinking') return 'idle';
  return step;
}

/**
 * The text Copy Diagnostics puts on the clipboard: connection, license, schema and channel health and the recent activity. Plan failures
 * are listed by code and reason, with dates but no titles. Never a token, password or setup key: the inputs hold none, and the result is
 * run through `redact` as well.
 */
export function diagnosticsText({ appVersion, platform, link, license, plans, songs, theme, activity = [], now = Date.now() } = {}) {
  const lines = [];
  const at = new Date(now).toISOString();
  lines.push('APCCMMA Cloud sync diagnostics', `Generated: ${at}`, `App version: ${appVersion ?? 'unknown'} (${platform ?? 'unknown'})`, '');
  lines.push('[Connection]');
  lines.push(`Cloud address: ${link?.address || 'not set'}`);
  if (link?.linkedAddress && link.linkedAddress !== link.address) lines.push(`Linked against: ${link.linkedAddress}`);
  lines.push(`Linked: ${link?.linked ? 'yes' : 'no'}${link?.offline ? ' (offline: last known)' : ''}`);
  if (link?.error) lines.push(`Link message: ${link.error}`);
  lines.push(`License: ${license?.statusText ?? license?.state ?? 'unknown'}`);
  lines.push(`Pill: ${connectionPill({ link, plans, songs, theme }).label}`, '');
  lines.push('[Plans]');
  lines.push(`Status: ${plans?.status ?? 'unknown'} · Auto-Sync: ${plans?.autoSync === false ? 'paused' : 'on'} · Last: ${plans?.lastSyncedAt ?? 'never'}`);
  if (plans?.counts) lines.push(`Last run: ${JSON.stringify(plans.counts)}`);
  for (const f of plans?.failures ?? []) lines.push(`Failed: ${f.date ?? '-'} ${f.kind ?? '-'} ${f.massTime ?? ''} [${f.code ?? 'no code'}] ${f.reason}`);
  lines.push('', '[Songs]');
  lines.push(`Status: ${songs?.status ?? 'unknown'} · Last: ${songs?.lastSyncedAt ?? 'never'} · Unsent: ${songs?.unsent ? 'yes' : 'no'}${songs?.message ? ` · ${songs.message}` : ''}`);
  lines.push('', '[Website theme]');
  lines.push(`Theme: ${theme?.theme ?? 'none'} · Waiting to send: ${theme?.themeDirty ? 'yes' : 'no'}${theme?.message ? ` · ${theme.message}` : ''}`);
  const schemaHints = [plans?.message, songs?.message, theme?.message, ...(plans?.failures ?? []).map((f) => f.reason)]
    .filter((m) => typeof m === 'string' && /migration|cannot store themes|missing/i.test(m));
  lines.push('', '[Website database]');
  lines.push(schemaHints.length ? `Needs attention: ${[...new Set(schemaHints)].join(' | ')}` : 'No missing migration reported.');
  lines.push('', '[Recent activity]');
  if (!activity.length) lines.push('None yet.');
  for (const a of activity) lines.push(`${a.at} ${a.direction === 'pull' ? '↓ Pull' : a.direction === 'both' ? '↕ Sync' : '↑ Push'} ${a.channel} ${a.status}: ${a.summary}`);
  return redact(lines.join('\n'));
}
