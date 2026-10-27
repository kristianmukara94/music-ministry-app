// Linking this laptop to a church's cloud. The device token is kept only in an encrypted file, made with Electron's
// safeStorage. It is never written in plain text, never put in localStorage, never stored in the database, and never sent to
// the screen. The app talks to Netlify functions only; it has no database address.
//
// The dependencies are passed in (safeStorage, the file, fetch) so the logic can be tested without Electron.
import { checkChurchSetup, checkWebUser } from '../shared/cloud-device.js';

export const MESSAGES = {
  notLinked: 'This laptop is not linked to a church yet. Link it first.',
  alreadyLinked: 'This laptop is already linked to a church. Unlink it first to set up a new church.',
  noSafeStorage: 'This computer cannot protect the link key, so this laptop cannot be linked. Check that Windows is signed in to a user account, then try again.',
  noCloudAddress: 'The cloud address is not set on this computer. Ask your technical helper to set it.',
  // Used when the cloud cannot be reached, and when it answers with something that is not JSON. The address is shown on the screen.
  offline: 'The cloud address did not respond as expected. Check the address shown above.',
  notFound: 'This cloud address does not have the sync service. Check the address shown above.',
  unreadable: 'The saved link on this computer could not be read. Link this laptop again.',
  revokedOnWeb: 'This laptop was unlinked from the website. Link it again.',
};

/** The message the server sent, when it sent a plain one. Otherwise a neutral line that names no cause. */
// The server's own plain message when it sent one. Otherwise a refusal (4xx) names its status, so a page that is not from the
// planner (a site password page, for example) is not hidden behind the generic line. Server errors and anything else stay generic.
const serverMessage = (res) => {
  if (res.status === 404) return MESSAGES.notFound;
  // A reply that is not JSON (a web page, a password page, a wrong address) is never shown: only the address line helps here.
  if (res.notJson) return MESSAGES.offline;
  if (typeof res.body?.error === 'string' && res.body.error.length <= 200) return res.body.error;
  if (res.status >= 400 && res.status < 500) {
    return `The cloud refused this request (error ${res.status}). Check the cloud address, or ask your technical helper.`;
  }
  return 'Something went wrong. Try again.';
};

export function createCloudDevice({ storage, file, fetchFn, baseUrl, now = () => Date.now() }) {
  const url = (name) => `${baseUrl.replace(/\/+$/, '')}/.netlify/functions/${name}`;
  // How far the server's clock is ahead of this laptop's, from the Date header of the last reply. Edit times are compared on server
  // time by correcting the laptop's stamps with this. It is zero until the first reply.
  let serverOffsetMs = 0;
  const observeServerDate = (res) => {
    const date = res.headers?.get?.('date');
    const parsed = date ? Date.parse(date) : NaN;
    if (!Number.isNaN(parsed)) serverOffsetMs = parsed - now();
  };

  /** Calls a Netlify function. Returns { ok, status, body } or throws the neutral network message. */
  async function call(name, { method = 'GET', body, token } = {}) {
    let res;
    try {
      res = await fetchFn(url(name), {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new Error(MESSAGES.offline);
    }
    observeServerDate(res);
    // The reply is read as text first, so a page that is not JSON is recognised, and its contents are never kept or shown.
    const text = await res.text().catch(() => '');
    let data = {};
    let notJson = false;
    try {
      data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) notJson = true;
    } catch {
      notJson = true;
    }
    // The device token is never shown: an error text that carries it is dropped, so the neutral line is used instead.
    // A device token is 32 random bytes in base64url, so a long run of those characters is treated as one and dropped.
    if (typeof data.error === 'string' && (/[A-Za-z0-9_-]{40,}/.test(data.error) || (token && data.error.includes(token)))) data = { ...data, error: undefined };
    // A reply that is not JSON is never a success, whatever its status.
    return { ok: res.ok && !notJson, status: res.status, body: notJson ? {} : data, notJson };
  }

  const readRecord = () => {
    const raw = file.read();
    if (!raw) return null;
    try {
      return JSON.parse(storage.decryptString(raw));
    } catch {
      file.remove();
      return 'unreadable';
    }
  };

  const writeRecord = (record) => file.write(storage.encryptString(JSON.stringify(record)));

  /** The state the screen shows. Only display fields: never the token. */
  const view = (record, extra = {}) => ({
    linked: true,
    church: record.church,
    admin: record.admin,
    label: record.label,
    lastSeenAt: record.lastSeenAt,
    linkedAddress: record.linkedAddress ?? null,
    offline: false,
    error: null,
    ...extra,
  });

  /** Links this laptop with a one-time code. Refuses, and writes nothing, when the token cannot be protected. */
  async function link(code, label) {
    if (!baseUrl) throw new Error(MESSAGES.noCloudAddress);
    if (!storage.isEncryptionAvailable()) throw new Error(MESSAGES.noSafeStorage);
    const res = await call('link-redeem', { method: 'POST', body: { code, deviceLabel: label } });
    if (!res.ok) throw new Error(serverMessage(res));
    const record = {
      token: res.body.token,
      church: res.body.churchName,
      admin: res.body.adminName,
      label: res.body.deviceLabel,
      lastSeenAt: null,
      linkedAddress: baseUrl.replace(/\/+$/, ''),
    };
    writeRecord(record);
    return status();
  }

  /** The current link. Checks with the cloud when it can; otherwise shows what was last known, marked offline. */
  async function status() {
    const record = readRecord();
    if (record === null) return { linked: false, error: null };
    if (record === 'unreadable') return { linked: false, error: MESSAGES.unreadable };
    if (!baseUrl) return view(record, { offline: true, error: MESSAGES.noCloudAddress });
    try {
      const res = await call('device-status', { token: record.token });
      if (res.status === 401) {
        file.remove();
        return { linked: false, error: MESSAGES.revokedOnWeb };
      }
      if (!res.ok) return view(record, { offline: true, error: serverMessage(res) });
      const updated = {
        ...record,
        church: res.body.churchName,
        admin: res.body.adminName,
        label: res.body.deviceLabel,
        lastSeenAt: res.body.lastSeenAt,
      };
      writeRecord(updated);
      return view(updated);
    } catch (err) {
      return view(record, { offline: true, error: err.message });
    }
  }

  /**
   * Unlinks this laptop. The local token is removed whether or not the cloud could be reached. If it could not be reached,
   * the result says the website may still list this laptop.
   */
  async function unlink() {
    const record = readRecord();
    if (!record || record === 'unreadable') {
      file.remove();
      return { linked: false, error: null, serverConfirmed: true };
    }
    let serverConfirmed = false;
    if (baseUrl) {
      try {
        serverConfirmed = (await call('device-unlink', { method: 'POST', token: record.token })).ok;
      } catch {
        serverConfirmed = false;
      }
    }
    file.remove();
    return {
      linked: false,
      error: serverConfirmed || !baseUrl ? null : 'This computer is unlinked. The cloud could not be reached, so also unlink it on the website.',
      serverConfirmed,
    };
  }

  /**
   * Adds a web user through this laptop's link. The input is checked here, in the main process, before anything is sent. The
   * cloud makes the temporary password and returns it once. It is handed back to the screen and is not written to disk, not
   * logged, and not kept here.
   */
  async function createWebUser(input) {
    const clean = {
      username: String(input?.username ?? '').trim(),
      displayName: String(input?.displayName ?? '').trim(),
      role: String(input?.role ?? ''),
    };
    const problem = checkWebUser(clean);
    if (problem) throw new Error(problem);
    if (!baseUrl) throw new Error(MESSAGES.noCloudAddress);
    const record = readRecord();
    if (record === null) throw new Error(MESSAGES.notLinked);
    if (record === 'unreadable') throw new Error(MESSAGES.unreadable);
    const res = await call('device-users-create', { method: 'POST', body: clean, token: record.token });
    if (res.status === 401) {
      file.remove();
      throw new Error(MESSAGES.revokedOnWeb);
    }
    if (!res.ok) throw new Error(serverMessage(res));
    return { username: res.body.user.username, temporaryPassword: res.body.temporaryPassword };
  }

  /**
   * Creates a new church and its first admin, using a setup key the developer gave out, and links this laptop to it in the same
   * step. The key is sent once and never kept. The token is stored, encrypted, the same way as a code link. The password comes
   * back once, for the screen to show.
   */
  async function createChurchAdmin(input) {
    const clean = {
      setupKey: String(input?.setupKey ?? ''),
      churchName: String(input?.churchName ?? '').trim(),
      username: String(input?.username ?? '').trim(),
      displayName: String(input?.displayName ?? '').trim(),
      deviceLabel: String(input?.deviceLabel ?? '').trim(),
    };
    const problem = checkChurchSetup(clean);
    if (problem) throw new Error(problem);
    if (!baseUrl) throw new Error(MESSAGES.noCloudAddress);
    // A damaged link file is removed by readRecord, so it no longer counts as a link.
    const existing = readRecord();
    if (existing !== null && existing !== 'unreadable') throw new Error(MESSAGES.alreadyLinked);
    if (!storage.isEncryptionAvailable()) throw new Error(MESSAGES.noSafeStorage);
    const res = await call('setup-church-admin', { method: 'POST', body: clean });
    if (!res.ok) throw new Error(serverMessage(res));
    writeRecord({
      token: res.body.token,
      church: res.body.churchName,
      admin: res.body.displayName,
      label: res.body.deviceLabel,
      lastSeenAt: null,
      linkedAddress: baseUrl.replace(/\/+$/, ''),
    });
    return {
      username: res.body.username,
      temporaryPassword: res.body.temporaryPassword,
      churchCode: res.body.displayCode,
      link: await status(),
    };
  }

  /**
   * Sends the church's song list (metadata only) through this laptop's link. The list is the full list, and the server returns the
   * counts. Rejects with an Error that is marked `offline` when the cloud cannot be reached, and `revoked` when the laptop was unlinked
   * on the website. The token is never in the message.
   */
  async function pushSongs(songs) {
    const record = readRecord();
    if (record === null) throw Object.assign(new Error(MESSAGES.notLinked), { revoked: true });
    if (record === 'unreadable') throw Object.assign(new Error(MESSAGES.unreadable), { revoked: true });
    let res;
    try {
      res = await call('songs-sync-push', { method: 'POST', body: { songs }, token: record.token });
    } catch {
      throw Object.assign(new Error(MESSAGES.offline), { offline: true });
    }
    if (res.status === 401) {
      file.remove();
      throw Object.assign(new Error(MESSAGES.revokedOnWeb), { revoked: true });
    }
    if (!res.ok) throw new Error(serverMessage(res));
    return { created: res.body.created, updated: res.body.updated, unchanged: res.body.unchanged, removed: res.body.removed };
  }

  /**
   * Calls a plan function with this laptop's token. Rejects with `offline` when the cloud cannot be reached, and with `revoked` when
   * the laptop was unlinked on the website. Other refusals come back in the result, for the sync to count.
   */
  async function planCall(name, { method = 'GET', body } = {}) {
    const record = readRecord();
    if (record === null) throw Object.assign(new Error(MESSAGES.notLinked), { revoked: true });
    if (record === 'unreadable') throw Object.assign(new Error(MESSAGES.unreadable), { revoked: true });
    let res;
    try {
      res = await call(name, { method, body, token: record.token });
    } catch {
      throw Object.assign(new Error(MESSAGES.offline), { offline: true });
    }
    if (res.status === 401) {
      file.remove();
      throw Object.assign(new Error(MESSAGES.revokedOnWeb), { revoked: true });
    }
    return res;
  }

  /** The changes since a cursor: the plans, the cursor to continue from, and whether more are waiting. */
  async function pullPlans(cursor) {
    const res = await planCall(cursor ? `plan-sync-pull?cursor=${encodeURIComponent(cursor)}` : 'plan-sync-pull');
    if (!res.ok) throw new Error(serverMessage(res));
    return { plans: res.body.plans ?? [], cursor: res.body.cursor ?? null, more: Boolean(res.body.more) };
  }

  /** Creates a plan the website does not have. A 409 means the id is already there, which the sync settles as a conflict. */
  async function createPlan(plan) {
    const res = await planCall('plan-create', { method: 'POST', body: plan });
    if (res.status === 201) return { status: 'created', updatedAt: res.body.plan.updatedAt };
    if (res.status === 409) return { status: 'exists' };
    return { status: 'error', message: serverMessage(res) };
  }

  /** Sends one plan against its base version. Returns accepted, conflict (with the website's version) or error. */
  async function pushPlan(plan) {
    const res = await planCall('plan-sync-push', { method: 'POST', body: { plans: [plan] } });
    if (!res.ok) return { status: 'error', message: serverMessage(res) };
    const [result] = res.body.results ?? [];
    if (result?.status === 'accepted') return { status: 'accepted', updatedAt: result.updatedAt };
    if (result?.status === 'conflict') return { status: 'conflict', serverVersion: result.serverVersion };
    return { status: 'error', message: typeof result?.message === 'string' ? result.message : 'Something went wrong. Try again.' };
  }

  /** Deletes a plan on the website. A plan already gone there counts as deleted, so a retry is safe. */
  async function deletePlan(id) {
    const res = await planCall('plan-delete', { method: 'POST', body: { id } });
    if (res.status === 404) return { gone: true };
    if (!res.ok) throw new Error(serverMessage(res));
    return { deleted: true };
  }

  /** One plan from the website, for this laptop's church only. `missing` means the website does not show it to this church. */
  async function getPlan(id) {
    const res = await planCall(`plan-sync-get?id=${encodeURIComponent(id)}`);
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok) throw new Error(serverMessage(res));
    return { status: 'found', plan: res.body.plan };
  }

  return {
    link, status, unlink, createWebUser, createChurchAdmin, pushSongs,
    pullPlans, createPlan, pushPlan, deletePlan, getPlan,
    serverOffset: () => serverOffsetMs,
  };
}
