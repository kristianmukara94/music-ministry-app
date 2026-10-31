// Creates the first admin for a church. Not run automatically: run it yourself, in a terminal, when a church is set up.
//
//   DATABASE_URL must be set in this terminal session (see README). It is never written to a file.
//   node server/scripts/create-admin.mjs
//
// The password is typed at a hidden prompt. It is never a command-line argument or a file, so it stays out of the shell
// history. The new account must change its password the first time it signs in.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../lib/auth.js';
import { checkNewPassword } from '../lib/rules.js';

const DISPLAY_CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** Reads a line without echoing it. Only works in a real terminal. */
function readHidden(question) {
  if (!stdin.isTTY) throw new Error('Run this script in a terminal, so the password can be typed without showing.');
  return new Promise((resolve, reject) => {
    stdout.write(question);
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          return reject(new Error('Cancelled.'));
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set in this terminal. Set it for this session only, then run the script again.');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const code = (await rl.question('Church display code (for example K7QM-4XD2): ')).trim().toUpperCase();
    if (!DISPLAY_CODE.test(code)) throw new Error('That is not a display code. It looks like XXXX-XXXX.');
    const username = (await rl.question('Username for the admin: ')).trim();
    const displayName = (await rl.question('Full name shown in the planner: ')).trim();
    if (!username || username.length > 80) throw new Error('Enter a username of up to 80 characters.');
    if (!displayName || displayName.length > 120) throw new Error('Enter a name of up to 120 characters.');
    rl.close();

    const password = await readHidden('Password (at least 10 characters): ');
    const again = await readHidden('Type it again: ');
    if (password !== again) throw new Error('The two passwords do not match. Nothing was created.');
    const problem = checkNewPassword(password);
    if (problem) throw new Error(problem);

    const sql = neon(url);
    const church = (await sql`SELECT id, name FROM churches WHERE display_code = ${code}`)[0];
    if (!church) throw new Error('No church has that display code. Nothing was created.');
    const existing = await sql`SELECT 1 FROM users WHERE church_id = ${church.id} AND lower(username) = lower(${username})`;
    if (existing.length) throw new Error('That username already exists in this church. Nothing was created.');

    const hash = await hashPassword(password);
    await sql`
      INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
      VALUES (gen_random_uuid(), ${church.id}, ${username}, ${displayName}, 'admin', ${hash}, true)`;
    console.log(`Created the admin "${username}" for ${church.name}. They must change the password at first sign-in.`);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

