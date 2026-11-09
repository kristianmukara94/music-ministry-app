// What the main process calls. church-key-generator.mjs is an exact copy of shared/church-key-generator.js, the module the desktop
// app checks keys with, so a key made here passes there. Change the generator in shared/, never in this folder.
import { createHmac } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { generateChurchCode, generateSetupKey, validateChurchCode, validateSetupKey } from './church-key-generator.mjs';

export { validateChurchCode, validateSetupKey };

export const CHECK_FAILED = 'Those keys failed their own check, so they were not shown. Please rebuild this app.';
export const NOT_CONNECTED =
  'This app is not connected to the website database, so no key was made. Close it, set DATABASE_URL and TOKEN_SECRET, then open it again.';
export const NOT_SAVED = 'The key could not be saved to the website database, so it was not shown. Check your internet connection and try again.';

const realKeys = { generateChurchCode, generateSetupKey, validateChurchCode, validateSetupKey };
const MIN_SECRET_LENGTH = 32; // The server refuses anything shorter.

/** The value stored in setup_keys. It must match hashToken in server/lib/auth.js, which this app cannot import once packaged. */
export const hashSetupKey = (key, secret) => createHmac('sha256', secret).update(key).digest('hex');

/**
 * New keys for the Generate button, or { error } with a message for the screen. Only a key already saved in setup_keys is returned,
 * because the server refuses any other. Keys that fail their own check are never returned.
 */
export async function handleGenerate(prefix, { keys = realKeys, env = process.env, connect = neon } = {}) {
  let setupKey;
  let churchCode;
  try {
    setupKey = keys.generateSetupKey();
    churchCode = keys.generateChurchCode(prefix);
    if (!keys.validateSetupKey(setupKey) || !keys.validateChurchCode(churchCode)) {
      console.error('Checksum validation failed locally. Check the HMAC salt configuration.');
      return { error: CHECK_FAILED };
    }
  } catch (error) {
    return { error: error.message };
  }

  const { DATABASE_URL: url, TOKEN_SECRET: secret } = env;
  if (!url || !secret || secret.length < MIN_SECRET_LENGTH) return { error: NOT_CONNECTED };

  try {
    const sql = connect(url);
    await sql`INSERT INTO setup_keys (key_hash, expires_at) VALUES (${hashSetupKey(setupKey, secret)}, now() + interval '7 days')`;
  } catch (error) {
    // The kind of error only: a driver message can quote the connection string.
    console.error(`[key-generator] ${error.name}`);
    return { error: NOT_SAVED };
  }
  return { setupKey, churchCode };
}
