// Runs after electron-builder has laid out the app and before it is signed and put in the installer, so the fuses reach the installed copy.
// electron/anti-tamper.js refuses debugging flags too, but by the time it runs, a debugger or a NODE_OPTIONS --require has already had its
// turn. The fuses (scripts/set-fuses.js) take those switches away before any of the app is loaded.
const path = require('node:path');

exports.default = async function afterPack(context) {
  const { setFuses } = await import('../scripts/set-fuses.js');
  const executable = context.packager.getElectronDestinationPath?.(context.appOutDir) ?? `${context.packager.appInfo.productFilename}.exe`;
  await setFuses(path.isAbsolute(executable) ? executable : path.join(context.appOutDir, executable));
};
