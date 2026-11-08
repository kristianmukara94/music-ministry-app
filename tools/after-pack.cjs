// Runs after electron-builder has laid out the app and before it is signed. Turns off, in the executable itself, the ways an installed copy
// of Electron can be made to run other code. electron/anti-tamper.js refuses debugging flags too, but by the time it runs, a debugger or a
// NODE_OPTIONS --require has already had its turn. These fuses take those switches away before any of the app is loaded.
const path = require('node:path');
const { flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  const executable = context.packager.getElectronDestinationPath?.(context.appOutDir) ?? `${context.packager.appInfo.productFilename}.exe`;
  const file = path.isAbsolute(executable) ? executable : path.join(context.appOutDir, executable);
  await flipFuses(file, {
    version: FuseVersion.V1,
    // ELECTRON_RUN_AS_NODE=1 would turn the signed executable into a plain Node interpreter.
    [FuseV1Options.RunAsNode]: false,
    // NODE_OPTIONS=--require=... would load any script into the main process.
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    // --inspect and --inspect-brk would attach a debugger before the first line of the app.
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // The app is loaded only from its app.asar, never from a folder placed beside it.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
