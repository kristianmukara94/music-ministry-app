// The startup profiler: when each step of a launch happened, counted from the moment Windows created the process. Marking is a push into a
// small array, so it is always on. A report is written only when APCCMMA_STARTUP_METRICS is set:
//   1     writes userData/startup-metrics.json once the console is interactive and the background services are up
//   exit  the same, then quits, for scripts/startup-benchmark.mjs
// The report holds step names and times only: no paths, no settings and nothing from the database.
//
// main.js imports this first (it imports nothing of the app's), so main:entry is the first line of app code to run.
import { performance } from 'node:perf_hooks';

export const METRICS_ENV = 'APCCMMA_STARTUP_METRICS';
export const REPORT_FILE = 'startup-metrics.json';

/** Every step of a launch, in the order a healthy one reaches them. */
export const MILESTONES = Object.freeze([
  'main:entry',
  'main:core-requires',
  'app:whenReady',
  'db:open',
  'window:created',
  'window:ready-to-show',
  'renderer:first-paint',
  'renderer:interactive',
  'background:services-ready',
]);

/** The steps the operator page reports. The main process accepts no other name from a page. */
export const RENDERER_MILESTONES = Object.freeze(['renderer:first-paint', 'renderer:interactive']);

/** A report is complete once both of these are in: the operator can work, and everything behind the console is running. */
const REQUIRED = ['renderer:interactive', 'background:services-ready'];

/** Wall-clock milliseconds with sub-millisecond precision, the one clock the main process and a page share. */
export const wallClock = () => performance.timeOrigin + performance.now();

/** When Windows created this process. Electron knows it exactly; plain Node (the tests) counts back from its uptime. */
export function processStart(proc = process, now = wallClock) {
  const created = proc.getCreationTime?.();
  return Number.isFinite(created) ? created : now() - proc.uptime() * 1000;
}

/** 'off', 'report' or 'exit', from the environment. */
export function metricsMode(env = process.env) {
  const value = String(env[METRICS_ENV] ?? '').trim().toLowerCase();
  if (value === 'exit') return 'exit';
  return value === '1' ? 'report' : 'off';
}

const round = (ms) => Math.round(ms * 10) / 10;

/**
 * One launch's timeline. The first mark of a name counts: a window reopened later never rewrites how long the launch took.
 * `onComplete(report)` runs once, when the required steps are all in.
 */
export function createStartupMetrics({ origin = processStart(), now = wallClock, onComplete = null } = {}) {
  const marks = new Map();
  let listener = onComplete;
  let completed = false;

  const report = () => {
    const ordered = [...marks].sort((a, b) => a[1] - b[1]);
    return {
      marks: ordered.map(([name, at], i) => ({
        name,
        ms: round(at - origin),
        delta: round(at - (i ? ordered[i - 1][1] : origin)),
      })),
    };
  };

  const settle = () => {
    if (completed || !listener || !REQUIRED.every((name) => marks.has(name))) return;
    completed = true;
    listener(report());
  };

  return {
    /** Records a known step at `at` (wall-clock ms, now when left out). Returns false for an unknown, repeated or impossible mark. */
    mark(name, at = now()) {
      if (!MILESTONES.includes(name) || marks.has(name) || !Number.isFinite(at) || at < origin || at > now() + 1000) return false;
      marks.set(name, at);
      settle();
      return true;
    },
    has: (name) => marks.has(name),
    report,
    /** Sets what runs when the timeline completes. Runs at once if it already has. */
    whenComplete(callback) {
      listener = callback;
      settle();
    },
  };
}

export const startupMetrics = createStartupMetrics();
startupMetrics.mark('main:entry');
