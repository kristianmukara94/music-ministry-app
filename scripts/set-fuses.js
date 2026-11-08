// The Electron fuses of the packaged app: switches inside the executable itself, set before any of the app can run.
//
// tools/after-pack.cjs applies them while electron-builder packages, which is the only moment that reaches the installer: the NSIS setup is
// built from win-unpacked straight after, and a signed executable cannot be changed afterwards.
//
//   node scripts/set-fuses.js [exe]            set the fuses on an unpacked build
//   node scripts/set-fuses.js --verify [exe]   check them, changing nothing (`npm run pack` does this as its postpack step)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronFuses from '@electron/fuses';

const { flipFuses, FuseV1Options, FuseVersion, getCurrentFuseWire } = electronFuses;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const FUSES = {
  // ELECTRON_RUN_AS_NODE=1 would turn the executable into a plain Node interpreter.
  [FuseV1Options.RunAsNode]: false,
  // NODE_OPTIONS=--require=... would load any script into the main process.
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  // --inspect and --inspect-brk would attach a debugger before the first line of the app.
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // app.asar is checked against the hash electron-builder embeds in the executable. A changed asar stops the app from starting.
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  // The app is loaded only from its app.asar, never from a folder placed beside it.
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // The main process reads browser_v8_context_snapshot.bin instead of the snapshot the other processes use. setFuses() provides that file.
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: true,
};

/** Sets the fuses on one executable. With the browser-snapshot fuse on, Electron cannot start unless that file sits beside the executable. */
export async function setFuses(executable) {
  const dir = path.dirname(executable);
  fs.copyFileSync(path.join(dir, 'v8_context_snapshot.bin'), path.join(dir, 'browser_v8_context_snapshot.bin'));
  await flipFuses(executable, { version: FuseVersion.V1, ...FUSES });
}

/** The fuses of one executable that differ from FUSES, by name. Empty means the build is locked as intended. */
export async function wrongFuses(executable) {
  const wire = await getCurrentFuseWire(executable);
  const ENABLE = '1'.charCodeAt(0);
  return Object.entries(FUSES)
    .filter(([index, wanted]) => (wire[Number(index)] === ENABLE) !== wanted)
    .map(([index]) => FuseV1Options[Number(index)]);
}

function defaultExecutable() {
  const { build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return path.join(root, build.directories.output, 'win-unpacked', `${build.productName}.exe`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const verify = args.includes('--verify');
  const executable = args.find((arg) => arg !== '--verify') ?? defaultExecutable();
  if (!fs.existsSync(executable)) {
    console.error(`[fuses] No executable at ${executable}. Build the app first.`);
    process.exit(1);
  }
  if (!verify) await setFuses(executable);
  const wrong = await wrongFuses(executable);
  if (wrong.length) {
    console.error(`[fuses] Not set as required in ${executable}: ${wrong.join(', ')}`);
    process.exit(1);
  }
  console.log(`[fuses] ${path.basename(executable)}: all ${Object.keys(FUSES).length} fuses are set as required.`);
}
