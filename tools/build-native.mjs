// Builds the display-matrix addon (src/native) and copies it to electron/display-matrix.node, where electron/edid-watchdog.js loads it.
//
//   node tools/build-native.mjs             build, and fail if it cannot be built (release builds)
//   node tools/build-native.mjs --optional  build, but only warn on failure (postinstall: a machine without C++ tools still installs)
//
// The addon uses Node-API, so it is built against this Node and loads in Electron unchanged. Off Windows there is nothing to build: the app
// falls back to Electron's display ids there.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const optional = process.argv.includes('--optional');
const source = path.join(root, 'src', 'native');
const built = path.join(source, 'build', 'Release', 'display_matrix.node');
const target = path.join(root, 'electron', 'display-matrix.node');

function fail(message) {
  if (optional) {
    console.warn(`[display-matrix] ${message}\n[display-matrix] Continuing without it: the EDID lock is unavailable and the app uses Electron display ids.`);
    process.exit(0);
  }
  console.error(`[display-matrix] ${message}`);
  process.exit(1);
}

if (process.platform !== 'win32') {
  console.log('[display-matrix] Not Windows: nothing to build.');
  process.exit(0);
}

// npm's own node-gyp first: the copy electron-builder pulls into node_modules (9.x) imports Python's distutils, gone since Python 3.12.
// Under `npm run`, npm names its copy in npm_config_node_gyp; otherwise it sits next to node.exe.
function findGyp() {
  const candidates = [
    process.env.npm_config_node_gyp,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  try {
    return createRequire(path.join(root, 'package.json')).resolve('node-gyp/bin/node-gyp.js');
  } catch {
    return null;
  }
}
const gyp = findGyp();
if (!gyp) fail('node-gyp was not found.');

const run = spawnSync(process.execPath, [gyp, 'rebuild', '--directory', source], { cwd: root, stdio: 'inherit' });
if (run.status !== 0 || !fs.existsSync(built)) fail(`The build failed (exit ${run.status}). Visual Studio Build Tools with the C++ workload are needed.`);

fs.copyFileSync(built, target);
console.log(`[display-matrix] Built ${path.relative(root, target)}`);
