// Keeps the laptop's plans in step with the website, in both directions, on a timer. No button: it runs in the background.
//
// Each run does three things, in this order:
//   1. Sends deletions. A plan deleted here is deleted on the website (its tombstone is kept until the website confirms).
//   2. Pulls the website's changes after the last cursor. A plan deleted there is removed here, without a tombstone.
//   3. Sends the plans changed here since their last sync.
//
// Which edit is newer is decided on server time. A laptop edit is stamped with the laptop's clock, and the laptop corrects that stamp
// by the offset it measured from the server's own Date header on its last reply. So a laptop whose clock is wrong still judges by
// the server's clock. Delete wins over a pending laptop edit.
import { MapRefused } from './plan-sync-map.js';

export const PLAN_SYNC_INTERVAL_MS = 60 * 1000;
const BACKOFF_MS = [30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];

/** The fields that make two versions of a plan the same. Items are compared in their server order. */
export function sameContent(local, server) {
  const norm = (items) =>
    [...items]
      .sort((a, b) => a.order - b.order)
      .map((i) => [i.key, i.group ?? '', i.order, i.kind, i.songId ?? null, i.text ?? null, i.minutes ?? null, i.note ?? null]);
  return local.name === server.name && local.date === server.date && JSON.stringify(norm(local.items)) === JSON.stringify(norm(server.items));
}

export function createPlanSync({ store, cloud, setTimer = setTimeout, clearTimer = clearTimeout, intervalMs = PLAN_SYNC_INTERVAL_MS }) {
  let state = { status: 'idle', lastSyncedAt: null, message: null, counts: null };
  let attempts = 0;
  let timer = null;
  let running = null;
  let keepRunning = false;

  const set = (next) => {
    state = { ...state, ...next };
  };
  const clear = () => {
    if (timer) clearTimer(timer);
    timer = null;
  };
  const later = (delayMs) => {
    if (timer) return;
    timer = setTimer(() => {
      timer = null;
      void runOnce();
    }, delayMs);
  };

  /** True when the laptop's edit is the newer one, on server time: the laptop stamp is corrected by the server offset. */
  const laptopIsNewer = (stamp, serverUpdatedAt) => Date.parse(stamp) + cloud.serverOffset() > Date.parse(serverUpdatedAt);

  /** Sends each deletion. A tombstone is cleared only once the website has confirmed the delete. Counted, never named. */
  async function sendDeletions(counts) {
    for (const t of store.tombstones()) {
      try {
        await cloud.deletePlan(t.uuid);
        store.clearTombstone(t.uuid);
        counts.deleted += 1;
      } catch (err) {
        if (err?.offline || err?.revoked) throw err;
        counts.failed += 1;
      }
    }
  }

  function applyPulled(plan, counts) {
    // Deleted here, and the delete is on its way to the website: the website's copy is not brought back.
    if (store.hasTombstone(plan.id)) return;
    const local = store.planByUuid(plan.id);
    if (plan.deleted) {
      if (local) {
        store.removeByUuid(plan.id);
        counts.deleted += 1;
      }
      return;
    }
    if (!local) {
      store.applyServer(plan);
      counts.received += 1;
      return;
    }
    // Already in step with this version of the website's plan.
    if (local.server_updated_at === plan.updatedAt) return;
    const dirty = local.synced_updated_at !== local.updated_at;
    if (dirty && laptopIsNewer(local.updated_at, plan.updatedAt)) {
      // The laptop's edit is the newer one. It is kept, and sent against this version.
      store.setServerStamp(plan.id, plan.updatedAt);
      return;
    }
    store.applyServer(plan);
    counts.received += 1;
  }

  async function pullAll(counts) {
    let at = store.cursor();
    for (;;) {
      const page = await cloud.pullPlans(at);
      for (const plan of page.plans) applyPulled(plan, counts);
      at = page.cursor ?? at;
      if (at) store.setCursor(at);
      if (!page.more) break;
    }
  }

  /** Sends one plan against a base version. A conflict is settled on server time. */
  async function pushOne(plan, payload, stamp, base, counts, retried = false) {
    const res = await cloud.pushPlan({ ...payload, baseUpdatedAt: base });
    if (res.status === 'accepted') {
      store.markSynced(plan.uuid, res.updatedAt, stamp);
      counts.sent += 1;
      return;
    }
    if (res.status === 'conflict') {
      const server = res.serverVersion;
      if (!retried && laptopIsNewer(stamp, server.updatedAt)) {
        // The laptop's edit is the newer one: send it again against the server's version.
        return pushOne(plan, payload, stamp, server.updatedAt, counts, true);
      }
      // The website's edit is the newer one: it is applied here, and the laptop's unsent edit is replaced.
      if (server.deleted) store.removeByUuid(plan.uuid);
      else store.applyServer(server);
      counts.received += 1;
      return;
    }
    counts.failed += 1;
  }

  /**
   * The first send of a plan whose id the website already has (its create was refused with 409). The website's version is read
   * first. Nothing is sent over it without the comparison. A plan of another church is refused, and held, and logged.
   */
  async function settleExisting(plan, payload, stamp, counts) {
    const res = await cloud.getPlan(plan.uuid);
    if (res.status === 'missing') {
      // The website has this id, but this laptop's church cannot see it. It belongs to another church.
      store.hold(plan.uuid, 1);
      console.error('[plan-sync] step=409 name=other-church');
      counts.failed += 1;
      return;
    }
    const server = res.plan;
    if (sameContent(payload, server)) {
      store.markSynced(plan.uuid, server.updatedAt, stamp);
      return;
    }
    if (laptopIsNewer(stamp, server.updatedAt)) {
      await pushOne(plan, payload, stamp, server.updatedAt, counts);
      return;
    }
    store.applyServer(server);
    counts.received += 1;
  }

  async function sendDirty(counts) {
    for (const plan of store.dirtyPlans()) {
      // A held plan is not sent: a send would drop the items the laptop cannot show.
      if (store.holdOf(plan.uuid)) continue;
      let payload;
      try {
        payload = store.payloadFor(plan);
      } catch (err) {
        if (err instanceof MapRefused) {
          counts.failed += 1;
          continue;
        }
        throw err;
      }
      // The laptop's stamp is read before sending, so an edit made during the send is still dirty afterwards.
      const stamp = plan.updated_at;
      if (plan.server_updated_at !== null) {
        await pushOne(plan, payload, stamp, plan.server_updated_at, counts);
        continue;
      }
      const created = await cloud.createPlan(payload);
      if (created.status === 'created') {
        store.markSynced(plan.uuid, created.updatedAt, stamp);
        counts.sent += 1;
      } else if (created.status === 'exists') {
        await settleExisting(plan, payload, stamp, counts);
      } else {
        counts.failed += 1;
      }
    }
  }

  /** One full run. Never throws: the outcome is in `status()`. */
  function runOnce() {
    if (running) return running;
    running = (async () => {
      set({ status: 'syncing', message: null });
      const counts = { sent: 0, received: 0, deleted: 0, failed: 0 };
      try {
        await sendDeletions(counts);
        await pullAll(counts);
        await sendDirty(counts);
        attempts = 0;
        counts.held = store.holdCount();
        set({ status: 'synced', lastSyncedAt: new Date().toISOString(), message: null, counts });
      } catch (err) {
        if (err?.revoked) {
          set({ status: 'error', message: err.message });
        } else if (err?.offline) {
          attempts += 1;
          set({ status: 'offline', message: err.message });
          clear();
          later(BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]);
        } else {
          console.error(`[plan-sync] step=run name=${err?.name ?? 'Error'}`);
          set({ status: 'error', message: 'Plans could not be synced. Try again.' });
        }
      } finally {
        running = null;
        if (keepRunning) later(intervalMs);
      }
      return state;
    })();
    return running;
  }

  function start() {
    clear();
    keepRunning = true;
    void runOnce();
  }

  function stop() {
    keepRunning = false;
    clear();
  }

  /** What the Cloud sync screen may show: status, the last sync and counts. Never a token, a plan title or an address. */
  const status = () => ({ status: state.status, lastSyncedAt: state.lastSyncedAt, message: state.message, counts: state.counts });

  return { runOnce, start, stop, status };
}
