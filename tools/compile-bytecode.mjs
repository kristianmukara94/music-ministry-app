// Builds dist-electron, the main-process code the packaged app runs. The source in electron/ and shared/ is ES modules and stays as it is for
// `npm run dev` and the tests. bytenode can only load CommonJS, so every module is converted first, then each becomes V8 bytecode and its .js
// file is replaced by a loader, leaving no readable main-process code in the app.asar.
//
// Bytecode only runs on the exact Electron build that compiled it, so it is produced with the project's own Electron, in a main process (what
// the app loads it in). The fuses do not get in the way: they are set on the packaged copy, never on node_modules.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-electron');
const require = createRequire(path.join(root, 'package.json'));

/**
 * Every main-process module. preload.cjs is left out by its extension: it runs in the sandboxed renderer, which has no bytenode to load it with.
 * No main-process code may depend on a function's own source text (fn.toString(), a function passed to executeJavaScript): bytecode has none.
 */
const filesToCompile = () =>
  [out, path.join(out, 'shared')].flatMap((dir) =>
    fs.readdirSync(dir).filter((name) => name.endsWith('.js')).map((name) => path.join(dir, name)));

const META_URL = '__APCCMMA_IMPORT_META_URL__';

const sources = (dir) =>
  fs.readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith('.js') && !name.includes('.test.'))
    .map((name) => path.join(root, dir, name));

/** Converts one folder of ES modules to CommonJS. esbuild keeps import order, so anti-tamper.js still runs before the rest of the app. */
async function convert(dir, outdir) {
  await build({
    entryPoints: sources(dir),
    outdir,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    bundle: false,
    logLevel: 'error',
    // CommonJS has no import.meta. The placeholder is swapped for an expression below, since esbuild's `define` accepts only names and JSON.
    define: { 'import.meta.url': META_URL },
  });
}

/** Rewrites what differs once the files sit in dist-electron: import.meta.url, and shared/ now being a folder inside it rather than beside it. */
function fixOutput(file) {
  const code = fs.readFileSync(file, 'utf8');
  const fixed = code
    .replaceAll(META_URL, 'require("node:url").pathToFileURL(__filename).href')
    .replaceAll('require("../shared/', 'require("./shared/');
  if (fixed !== code) fs.writeFileSync(file, fixed);
}

/** Every relative require in the output must resolve, or the packaged app would fail at launch rather than here. */
function assertRequiresResolve(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const code = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const [, target] of code.matchAll(/require\("(\.[^"]+)"\)/g)) {
      if (!fs.existsSync(path.join(dir, target))) throw new Error(`${name} requires ${target}, which is not in dist-electron.`);
    }
  }
}

/** The Electron executable. CI installs with --ignore-scripts, which skips the download this step needs. */
function electronExecutable() {
  const pkg = path.join(root, 'node_modules', 'electron');
  if (!fs.existsSync(path.join(pkg, 'path.txt'))) {
    const result = spawnSync(process.execPath, [path.join(pkg, 'install.js')], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Could not download Electron, which the bytecode must be compiled with.');
  }
  return require('electron');
}

async function compileBytecode(electronPath) {
  const bytenode = require('bytenode');
  const files = filesToCompile();
  for (const filename of files) {
    const compiled = filename.replace(/\.js$/, '.jsc');
    await bytenode.compileFile({ filename, output: compiled, electronMain: true, electronPath });
    if (fs.statSync(compiled).size === 0) throw new Error(`${path.relative(out, filename)} compiled to an empty file.`);
    fs.writeFileSync(filename, `require('bytenode');\nmodule.exports = require('./${path.basename(compiled)}');\n`);
  }
  return files.length;
}

fs.rmSync(out, { recursive: true, force: true });
await convert('electron', out);
await convert('shared', path.join(out, 'shared'));
for (const dir of [out, path.join(out, 'shared')]) {
  for (const name of fs.readdirSync(dir)) if (name.endsWith('.js')) fixOutput(path.join(dir, name));
}
assertRequiresResolve(out);

// The root package.json says "type": "module". This one makes the .js files here CommonJS.
fs.writeFileSync(path.join(out, 'package.json'), `${JSON.stringify({ type: 'commonjs' })}\n`);
fs.copyFileSync(path.join(root, 'electron', 'preload.cjs'), path.join(out, 'preload.cjs'));
// The addon is optional on machines without C++ tools. A release build has already failed in build-native.mjs if it could not be built.
const addon = path.join(root, 'electron', 'display-matrix.node');
if (fs.existsSync(addon)) fs.copyFileSync(addon, path.join(out, 'display-matrix.node'));

const count = await compileBytecode(electronExecutable());
console.log(`[bytecode] ${count} modules compiled into ${path.relative(root, out)}.`);
