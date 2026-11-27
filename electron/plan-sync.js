// Keeps the laptop's plans in step with the website, in both directions, on a timer. The operator can pause the timer (Auto-Sync), and
// can always run it by hand (Sync Now, Retry Failed, Force Push Plans).
//
// Each run does three things, in this order:
//   1. Sends deletions. A plan deleted here is deleted on the website (its tombstone is kept until the website confirms).
//   2. Pulls the website's changes after the last cursor. A plan deleted there is removed here, without a tombstone.
//   3. Sends the plans changed here since their last sync. Plans the website already has go in batches; new ones are created one by one.
//
// Which edit is newer is decided on server time. A laptop edit is stamped with the laptop's clock, and the laptop corrects that stamp
// by the offset it measured from the server's own Date header on its last reply. So a laptop whose clock is wrong still judges by
// the server's clock. Delete wins over a pending laptop edit.
//
// A plan the website does not have for this church (the laptop was linked to another church before, or the website's database was
// replaced) is not left failing for ever: it is created again. If its id belongs to another church, it gets a new id here first.
import { MapRefused } from './plan-sync-map.js';

export const PLAN_SYNC_INTERVAL_MS = 60 * 1000;
/** Plans sent in one push request. The server takes up to 50; fewer keeps a slow connection inside the request timeout. */
export const PUSH_BATCH = 25;
const BACKOFF_MS = [30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];
/** What a server from before result codes said for every plan it could not find. Read as `not_on_website`. */
const LEGACY_NOT_SAVED = 'This plan could not be saved. Try again, or ask your admin.';
export const UNEXPECTED_FAILURE = 'Something unexpected stopped this plan on the laptop. It will be tried again on the next sync.';
export const OTHER_CHURCH_FAILURE = "This plan's id belongs to another church's website, and it could not be sent under a new id.";

/** The fields that make two versions of a plan the same. Items are compared in their server order. */
export function sameContent(local, server) {
  const norm = (items) =>
    [...items]
      .sort((a, b) => a.order - b.order)
      .map((i) => [i.key, i.group ?? '', i.order, i.kind, i.songId ?? null, i.text ?? null, i.minutes ?? null, i.note ?? null, i.slot ?? null]);
  return local.name === server.name && local.date === server.date && JSON.stringify(norm(local.items)) === JSON.stringify(norm(server.items));
}

/** The code a server result carries, or the one an older server's wording stands for. */
export const resultCode = (res) => res?.code ?? (res?.message === LEGACY_NOT_SAVED ? 'not_on_website' : null);

export function createPlanSync({ store, cloud, setTimer = setTimeout, clearTimer = clearTimeout, intervalMs = PLAN_SYNC_INTERVAL_MS, now = () => Date.now(), onRun = () => {}, autoSync = true }) {
  let state = { status: 'idle', lastSyncedAt: null, message: null, counts: null, failures: [] };
  let attempts = 0;
  let timer = null;
  let running = null;
  let keepRunning = false;
  let auto = autoSync !== false;
  let heldRetried = false;
  // The plans that could not be sent on this run, by uuid. Replaced at the end of each run that reached the send step.
  let failures = new Map();

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

  /** The plan's own words for the Failed Plans list, read from this laptop only. Never sent anywhere. */
  const describe = (plan) => {
    const known = store.describe?.(plan.uuid) ?? null;
    return {
      title: known?.title ?? plan.name ?? 'Untitled Plan',
      date: known?.date ?? plan.date ?? null,
      kind: known?.kind ?? plan.kind ?? null,
      massTime: known?.massTime ?? '',
      massLanguage: known?.massLanguage ?? '',
    };
  };

  /** Records a plan that could not be sent, with its exact reason. */
  const failOne = (counts, plan, reason, code = null) => {
    counts.failed += 1;
    failures.set(plan.uuid, { uuid: plan.uuid, ...describe(plan), reason: reason || UNEXPECTED_FAILURE, code, at: new Date(now()).toISOString() });
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
      // The laptop's edit is the newer one. It is kept, and sent against this version. The plan's Content Hub entries still come in.
      store.ingestHub(plan);
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

  /**
   * Reads each held plan from the website once per run of the app. A plan held by an earlier version, for an item this version can place, is already past the
   * pull cursor, so without this it would stay held until someone saved it again on the website. The same goes for a Praise & Worship plan an earlier
   * version pulled without assigning its website prayers.
   */
  async function retryHeld(counts) {
    if (heldRetried) return;
    for (const uuid of new Set([...store.heldPlans(), ...(store.unreadPrayerPlans?.() ?? [])])) {
      try {
        const res = await cloud.getPlan(uuid);
        if (res.status !== 'found') continue;
        store.applyServer(res.plan);
        counts.received += 1;
      } catch (err) {
        if (err?.offline || err?.revoked) throw err;
        console.error(`[plan-sync] step=held name=${err?.name ?? 'Error'}`);
      }
    }
    heldRetried = true;
  }

  /**
   * What to do with one push result. `resend(base)` sends the plan again against another base version, for a conflict the laptop wins.
   * `recreate()` sends it as a new plan, for one the website does not have for this church.
   */
  async function settlePush(plan, stamp, res, counts, { resend, recreate, retried }) {
    if (res.status === 'accepted') {
      store.markSynced(plan.uuid, res.updatedAt, stamp);
      counts.sent += 1;
      return;
    }
    if (res.status === 'conflict') {
      const server = res.serverVersion;
      if (!retried && laptopIsNewer(stamp, server.updatedAt)) {
        // The laptop's edit is the newer one: send it again against the server's version.
        await resend(server.updatedAt);
        return;
      }
      // The website's edit is the newer one: it is applied here, and the laptop's unsent edit is replaced.
      if (server.deleted) store.removeByUuid(plan.uuid);
      else store.applyServer(server);
      counts.received += 1;
      return;
    }
    const code = resultCode(res);
    if (code === 'not_on_website' && recreate && store.forgetServerStamp) {
      // The website has no such plan for this church: the stamp the laptop kept is from somewhere else. It is sent as a new plan.
      store.forgetServerStamp(plan.uuid);
      await recreate();
      return;
    }
    if (code === 'deleted') {
      // Delete wins over a pending laptop edit, as it does on a pull.
      store.removeByUuid(plan.uuid);
      counts.deleted += 1;
      return;
    }
    failOne(counts, plan, res.message, code);
  }

  /** Sends one plan against a base version. A conflict is settled on server time. */
  async function pushOne(plan, payload, stamp, base, counts, retried = false) {
    const res = await cloud.pushPlan({ ...payload, baseUpdatedAt: base });
    await settlePush(plan, stamp, res, counts, {
      retried,
      resend: (next) => pushOne(plan, payload, stamp, next, counts, true),
      recreate: () => createOne(plan, payload, stamp, counts),
    });
  }

  /**
   * The first send of a plan whose id the website already has (its create was refused with 409). The website's version is read
   * first. Nothing is sent over it without the comparison. An id this church cannot see belongs to another church (or to a plan
   * deleted on the website): the plan is given a new id here and created, so it is never stranded.
   */
  async function settleExisting(plan, payload, stamp, counts, rekeyed) {
    const res = await cloud.getPlan(plan.uuid);
    if (res.status === 'missing') {
      if (rekeyed || !store.rekey) {
        if (store.hold) store.hold(plan.uuid, 1);
        console.error('[plan-sync] step=409 name=other-church');
        failOne(counts, plan, OTHER_CHURCH_FAILURE, 'other_church');
        return;
      }
      const fresh = store.rekey(plan.uuid);
      const moved = store.planByUuid(fresh);
      console.error('[plan-sync] step=409 name=rekeyed');
      await createOne(moved, store.payloadFor(moved), moved.updated_at, counts, true);
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

  /** Creates a plan the website does not have yet. */
  async function createOne(plan, payload, stamp, counts, rekeyed = false) {
    const created = await cloud.createPlan(payload);
    if (created.status === 'created') {
      store.markSynced(plan.uuid, created.updatedAt, stamp);
      counts.sent += 1;
    } else if (created.status === 'exists') {
      await settleExisting(plan, payload, stamp, counts, rekeyed);
    } else {
      failOne(counts, plan, created.message, created.code ?? null);
    }
  }

  /** Runs `work` for one plan. Each plan stands alone: one that fails is counted and the rest still go. Only a lost connection or link stops the run. */
  async function guarded(plan, counts, work) {
    try {
      await work();
    } catch (err) {
      if (err?.offline || err?.revoked) throw err;
      if (err instanceof MapRefused) {
        failOne(counts, plan, err.message, 'laptop_refused');
      } else {
        console.error(`[plan-sync] step=send name=${err?.name ?? 'Error'}`);
        failOne(counts, plan, null, 'laptop_error');
      }
    }
  }

  /** Sends the plans the website already has, many per request, then settles each result on its own. */
  async function pushBatched(entries, counts) {
    for (let i = 0; i < entries.length; i += PUSH_BATCH) {
      const chunk = entries.slice(i, i + PUSH_BATCH);
      const results = await cloud.pushPlans(chunk.map((e) => ({ ...e.payload, baseUpdatedAt: e.base })));
      for (let j = 0; j < chunk.length; j += 1) {
        const { plan, payload, stamp } = chunk[j];
        await guarded(plan, counts, () =>
          settlePush(plan, stamp, results[j] ?? { status: 'error' }, counts, {
            retried: false,
            resend: (next) => pushOne(plan, payload, stamp, next, counts, true),
            recreate: () => createOne(plan, payload, stamp, counts),
          }),
        );
      }
    }
  }

  async function sendDirty(counts) {
    const toPush = [];
    for (const plan of store.dirtyPlans()) {
      // A held plan is not sent: a send would drop the items the laptop cannot show.
      if (store.holdOf(plan.uuid)) continue;
      // The laptop's stamp is read before sending, so an edit made during the send is still dirty afterwards.
      const stamp = plan.updated_at;
      await guarded(plan, counts, async () => {
        const payload = store.payloadFor(plan);
        if (plan.server_updated_at === null || plan.server_updated_at === undefined) {
          await createOne(plan, payload, stamp, counts);
        } else if (cloud.pushPlans) {
          toPush.push({ plan, payload, stamp, base: plan.server_updated_at });
        } else {
          await pushOne(plan, payload, stamp, plan.server_updated_at, counts);
        }
      });
    }
    if (toPush.length) await pushBatched(toPush, counts);
  }

  /** One full run. Never throws: the outcome is in `status()`. `trigger` names who asked, for the activity log. */
  function runOnce(trigger = 'auto') {
    if (running) return running;
    running = (async () => {
      const startedAt = now();
      set({ status: 'syncing', message: null });
      const counts = { sent: 0, received: 0, deleted: 0, failed: 0 };
      const previous = failures;
      failures = new Map();
      try {
        await sendDeletions(counts);
        await pullAll(counts);
        await retryHeld(counts);
        await sendDirty(counts);
        attempts = 0;
        counts.held = store.holdCount();
        const list = [...failures.values()];
        set({ status: 'synced', lastSyncedAt: new Date(now()).toISOString(), message: list[0]?.reason ?? null, counts, failures: list });
      } catch (err) {
        // The run stopped part-way, so the plans it did not reach keep the reasons they had.
        failures = new Map([...previous, ...failures]);
        set({ failures: [...failures.values()] });
        if (err?.revoked) {
          set({ status: 'error', message: err.message });
        } else if (err?.offline) {
          attempts += 1;
          set({ status: 'offline', message: err.message });
          clear();
          if (auto) later(BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]);
        } else {
          console.error(`[plan-sync] step=run name=${err?.name ?? 'Error'}`);
          set({ status: 'error', message: 'Plans could not be synced. Try again.' });
        }
      } finally {
        running = null;
        if (keepRunning && auto) later(intervalMs);
        try {
          onRun({ trigger, status: state.status, counts: state.counts && state.status === 'synced' ? state.counts : null, message: state.message, ms: now() - startedAt });
        } catch {
          // The activity log never stops a sync.
        }
      }
      return status();
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

  /** Turns the background timer on or off. A paused sync still runs when the operator asks (Sync Now, Retry Failed, Force Push). */
  function setAutoSync(on) {
    auto = Boolean(on);
    if (!auto) clear();
    else if (keepRunning) later(intervalMs);
    return status();
  }

  /** Sends the failed plans again now. They are still waiting to be sent, so a run picks them up; the reasons are refreshed. */
  const retryFailed = () => runOnce('retry');

  /**
   * Sends every plan on this laptop again, and reads every plan on the website again. For a laptop moved to another church or website:
   * plans the website lacks are created, and plans it has are brought in step. Laptop edits still win only when they are newer.
   */
  function forcePushAll() {
    store.markAllDirty?.();
    store.setCursor(null);
    heldRetried = false;
    return runOnce('force');
  }

  /** Forgets every link to the website's versions, for a laptop just linked (perhaps to another church). The next run starts fresh. */
  function resetForNewLink() {
    store.resetSyncState?.();
    failures = new Map();
    heldRetried = false;
    set({ failures: [], counts: null, message: null });
    return runOnce('link');
  }

  /**
   * What the Cloud sync screen may show: status, the last sync, counts, whether Auto-Sync is on, and the plans that could not be sent with
   * their reasons. The titles come from this laptop's own database and stay on it. Never a token or an address.
   */
  const status = () => ({
    status: state.status,
    lastSyncedAt: state.lastSyncedAt,
    message: state.message,
    counts: state.counts,
    failures: state.failures ?? [],
    autoSync: auto,
  });

  return { runOnce, start, stop, status, setAutoSync, retryFailed, forcePushAll, resetForNewLink };
}
