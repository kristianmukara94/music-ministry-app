// The Service Console dashboard: the Pre-Service Readiness widget, Start Mass / Stage Next on the Holy Mass Queue card, the System Health
// panel in place of the Launchpad, and the booth lighting presets. Run with:
// node --test shared/service-console.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the dashboard shows the readiness widget, the queue card and the health panel in place of the Launchpad', () => {
  const dash = read('src/operator/Dashboard.tsx');
  assert.match(dash, /<ConsoleHeader \/>\s*<PreServiceWidget \/>/, 'readiness sits under the header, before the status cards');
  assert.match(dash, /<QueueCard \/>/);
  assert.match(dash, /<SystemHealthPanel \/>/);
  assert.doesNotMatch(dash, /<Launchpad \/>/, 'the Launchpad panel is replaced');
});

test('readiness checks the four sub-systems and polls the main process', () => {
  const widget = read('src/operator/PreServiceWidget.tsx');
  for (const key of ['ready.projector', 'ready.lowerThird', 'ready.remote', 'ready.queue']) assert.ok(widget.includes(`'${key}'`), key);
  assert.match(widget, /bridge\.displays\.list\(\)/);
  assert.match(widget, /bridge\.remoteView\.get\(\)/);
  assert.match(widget, /bridge\.lowerThird\s*\.info\(\)/);
  assert.match(widget, /\{ready\}\/\{checks\.length\} \{t\('ready\.ready'\)\}/, 'all ready reads n/4 Ready');
  assert.match(widget, /nextMassStart\(now, times, region\.timeZone\)/, 'the countdown uses the Region zone');
  const main = read('electron/main.js');
  assert.match(main, /running: lowerThirdServerUp,/, 'lowerThird:info reports whether the browser source started');
});

test('Start Mass goes live like the Go Live console; Stage Next stages without taking', () => {
  const q = read('src/operator/dashboardQueue.ts');
  assert.match(q, /await goLiveMassAt\(first, planName\)/);
  assert.match(q, /openQueueItem\(state\.queue\[index\], index, \{ inPlace: true \}\)/);
  // The cursor arrives before the staged slide: Take Staged must key on the new slide, not the one it replaced.
  assert.match(q, /whenLive\(\(s\) => s\.queueCursor === index && frameKey\(s\.projector\.staged\) !== before\)/);
  assert.doesNotMatch(q.slice(q.indexOf('export async function stageNext'), q.indexOf('export async function takeStaged')), /projector\/take/, 'Stage Next never takes');
  const dash = read('src/operator/Dashboard.tsx');
  assert.match(dash, /t\('queue\.startMass'\)/);
  assert.match(dash, /t\('queue\.stageNext'\)/);
  assert.match(dash, /window\.confirm\(t\('queue\.confirmRestart'\)\)/, 'restarting a Mass on screen asks first');
});

test('booth presets are saved with the operator preferences and tint the operator window only', () => {
  const ui = read('src/state/ui.ts');
  const persisted = ui.match(/partialize: \(\{([^}]*)\}\)/)?.[1] ?? '';
  assert.match(persisted, /\bboothPreset\b/);
  assert.match(persisted, /\bmassTimes\b/);
  assert.match(ui, /BOOTH_PRESETS\.includes\(saved\.boothPreset/, 'a damaged saved preset falls back to Standard');
  const layer = read('src/operator/BoothLighting.tsx');
  assert.match(layer, /pointer-events-none fixed inset-0/);
  assert.match(read('src/operator/OperatorApp.tsx'), /<BoothLighting \/>/);
  for (const out of ['src/output/ProjectorView.tsx']) assert.doesNotMatch(read(out), /BoothLighting/, `${out} is never tinted`);
});
