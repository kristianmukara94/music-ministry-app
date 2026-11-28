// Times the app's launch. Starts it several times with APCCMMA_STARTUP_METRICS=exit, reads the timeline each launch writes
// (electron/startup-metrics.js) and prints the median of every step, in milliseconds from process creation.
//
//   node scripts/startup-benchmark.mjs --exe <APCCMMA.exe> [--exe2 <other build>] [--runs 10] [--profile <dir>]
//
// Without --exe it runs the project itself (`electron .`), which loads dist/, so run `npx vite build` first. With --exe2 the two builds are
// launched alternately, so a slow moment on the machine falls on both. Each build gets its own throwaway profile under --profile (a temp
// folder by default) and one unmeasured first launch, which creates the database. The installed app's own data is never touched.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { METRICS_ENV, MILESTONES, REPORT_FILE } from '../electron/startup-metrics.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCH_LIMIT_MS = 120_000;

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const runs = Number(option('runs', 10));
const profiles = path.resolve(option('profile', fs.mkdtempSync(path.join(os.tmpdir(), 'apcc-startup-'))));

const builds = [option('exe'), option('exe2')].filter(Boolean).map((exe) => ({ name: exe, command: path.resolve(exe), extra: [] }));
if (!builds.length) {
  builds.push({ name: 'electron . (unpackaged)', command: createRequire(path.join(root, 'package.json'))('electron'), extra: [root] });
}

function launch(build, userData) {
  const report = path.join(userData, REPORT_FILE);
  fs.rmSync(report, { force: true });
  // Set by VS Code's terminal, and it would start Electron as plain Node.
  const env = { ...process.env, [METRICS_ENV]: 'exit' };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(build.command, [...build.extra, `--user-data-dir=${userData}`], { env, stdio: 'ignore' });
    const limit = setTimeout(() => {
      child.kill();
      reject(new Error(`${build.name} did not finish starting within ${LAUNCH_LIMIT_MS / 1000}s.`));
    }, LAUNCH_LIMIT_MS);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(limit);
      if (!fs.existsSync(report)) return reject(new Error(`${build.name} exited (${code}) without writing its timeline.`));
      resolve(JSON.parse(fs.readFileSync(report, 'utf8')));
    });
  });
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const samples = builds.map(() => []);
const firstLaunch = [];
for (const [i, build] of builds.entries()) {
  build.userData = path.join(profiles, `profile-${i + 1}`);
  fs.mkdirSync(build.userData, { recursive: true });
  firstLaunch.push(await launch(build, build.userData));
}
for (let run = 0; run < runs; run += 1) {
  // The order swaps every round, so neither build always goes second.
  const order = [...builds.entries()];
  if (run % 2) order.reverse();
  for (const [i, build] of order) samples[i].push(await launch(build, build.userData));
}

const results = builds.map((build, i) => ({
  build: build.name,
  runs,
  samples: samples[i].map((s) => Object.fromEntries(s.marks.map((m) => [m.name, m.ms]))),
  firstLaunch: Object.fromEntries(firstLaunch[i].marks.map((m) => [m.name, m.ms])),
  steps: Object.fromEntries(
    MILESTONES.map((name) => {
      const values = samples[i].map((s) => s.marks.find((m) => m.name === name)?.ms).filter(Number.isFinite);
      return [name, values.length ? { median: Math.round(median(values)), min: Math.round(Math.min(...values)), max: Math.round(Math.max(...values)), n: values.length } : null];
    }),
  ),
}));

for (const result of results) {
  console.log(`\n${result.build} — ${runs} launches after one first launch`);
  console.log('step                          median     min     max   first launch');
  for (const name of MILESTONES) {
    const s = result.steps[name];
    const cells = s ? [s.median, s.min, s.max].map((v) => String(v).padStart(7)).join(' ') : '      -       -       -';
    console.log(`${name.padEnd(28)} ${cells}   ${String(result.firstLaunch[name] ?? '-').padStart(10)}`);
  }
}
const out = option('json');
if (out) fs.writeFileSync(path.resolve(out), `${JSON.stringify(results, null, 2)}\n`);
