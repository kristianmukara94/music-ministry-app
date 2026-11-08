// What the main process calls. church-key-generator.mjs is an exact copy of shared/church-key-generator.js, the module the desktop
// app checks keys with, so a key made here passes there. Change the generator in shared/, never in this folder.
import { generateChurchCode, generateSetupKey, validateChurchCode, validateSetupKey } from './church-key-generator.mjs';

export { validateChurchCode, validateSetupKey };

export const CHECK_FAILED = 'Those keys failed their own check, so they were not shown. Please rebuild this app.';

const realKeys = { generateChurchCode, generateSetupKey, validateChurchCode, validateSetupKey };

/** New keys for the Generate button, or { error } with a message for the screen. Keys that fail their own check are never returned. */
export function handleGenerate(prefix, keys = realKeys) {
  try {
    const setupKey = keys.generateSetupKey();
    const churchCode = keys.generateChurchCode(prefix);
    if (!keys.validateSetupKey(setupKey) || !keys.validateChurchCode(churchCode)) {
      console.error('Checksum validation failed locally. Check the HMAC salt configuration.');
      return { error: CHECK_FAILED };
    }
    return { setupKey, churchCode };
  } catch (error) {
    return { error: error.message };
  }
}
