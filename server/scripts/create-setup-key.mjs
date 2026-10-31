// Makes one setup key, for creating a church and its first admin from a laptop. Run it yourself, in a terminal, when a new church
// is ready to be set up. The key works once and expires after 7 days.
//
//   DATABASE_URL and TOKEN_SECRET must be set in this terminal session. They are never written to a file.
//   node server/scripts/create-setup-key.mjs
//
// The key is printed here, once. Only its keyed hash is stored, so the key cannot be recovered from the database. It is not
// logged or written to a file.
import { neon } from '@neondatabase/serverless';
import { hashToken, setupKey } from '../lib/auth.js';

async function main() {
  const url = process.env.DATABASE_URL;
  const secret = process.env.TOKEN_SECRET;
  if (!url) throw new Error('DATABASE_URL is not set in this terminal. Set it for this session only, then run the script again.');
  if (!secret) throw new Error('TOKEN_SECRET is not set in this terminal. Set it for this session only, then run the script again.');

  const key = setupKey();
  const sql = neon(url);
  await sql`INSERT INTO setup_keys (key_hash) VALUES (${hashToken(key, secret)})`;
  console.log('Setup key (shown once; works once; valid for 7 days):');
  console.log(key);
}

main().catch((err) => {
  // The message names what is wrong, never a key or a password.
  console.error(err.message);
  process.exit(1);
});
