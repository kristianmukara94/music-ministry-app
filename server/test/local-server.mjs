// A local stand-in for Vercel, for testing the planner pages in a browser without Vercel or Neon.
// It serves web/ and runs the same handler code the functions run, against a PGlite database seeded with test accounts.
// Test accounts only: the passwords printed below are for this local database and nothing else.
//
//   node server/test/local-server.mjs            (serves http://localhost:8888)
import http from 'node:http';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createApi } from '../lib/handlers.js';
import { createAdminApi } from '../lib/admin.js';
import { tagFromQuery } from '../lib/db.js';
import { createLinkingApi } from '../lib/linking.js';
import { createDeviceUsersApi } from '../lib/device-users.js';
import { createChurchSetupApi } from '../lib/church-setup.js';
import { createPlanEditingApi } from '../lib/plan-editing.js';
import { createSongsSyncApi } from '../lib/songs-sync.js';
import { createPlanSyncApi } from '../lib/plan-sync.js';
import { hashPassword, hashToken, setupKey } from '../lib/auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '..', '..', 'web');
const SCHEMA = fs.readFileSync(path.resolve(here, '..', 'db', 'schema.sql'), 'utf8');
const PORT = Number(process.env.PORT ?? 8888);
// A fresh secret each time the local server starts. Test use only.
const LOCAL_SECRET = randomBytes(32).toString('hex');
// The test password, generated when the server starts. Printed below so a local browser run can use it.
const PASSWORD = `Test-${randomBytes(16).toString('base64url')}`;
const CHURCH = '00000000-0000-4000-8000-00000000000a';

const db = new PGlite();
await db.exec(SCHEMA);
await db.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'K7QM-4XD2', 'St Mary')`, [CHURCH]);
const hash = await hashPassword(PASSWORD);
for (const [username, role, mustChange] of [['planner', 'planner', false], ['viewer', 'viewer', false], ['fresh', 'planner', true], ['boss', 'admin', false]]) {
  await db.query(
    `INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password)
     VALUES (gen_random_uuid(), $1, $2, $2, $3, $4, $5)`,
    [CHURCH, username, role, hash, mustChange],
  );
}
// Two plans with fixed ids, and a few songs, so the web plan editor can be opened. The songs are test data only.
// A song the church has removed, and a Mass plan that still uses it. The editor shows it as removed; the plan still saves.
const RETIRED_SONG = '20000000-0000-4000-8000-0000000000ee';
await db.query(`INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at, removed_at) VALUES ($1, $2, 'Retired hymn', 'Responsorial Psalm', 'English', 'C', now(), now())`, [RETIRED_SONG, CHURCH]);
// A church with no plans or songs, for the empty state.
const EMPTY_CHURCH = '00000000-0000-4000-8000-00000000000e';
await db.query(`INSERT INTO churches (id, display_code, name) VALUES ($1, 'B8NW-3PL5', 'New Parish')`, [EMPTY_CHURCH]);
await db.query(`INSERT INTO users (id, church_id, username, display_name, role, password_hash, must_change_password) VALUES (gen_random_uuid(), $1, 'emptyplanner', 'Empty Planner', 'planner', $2, false)`, [EMPTY_CHURCH, hash]);

export const MASS_PLAN_ID = '10000000-0000-4000-8000-000000000001';
export const PRAISE_PLAN_ID = '10000000-0000-4000-8000-000000000002';
await db.query(
  `INSERT INTO plans (id, church_id, name, liturgical_date, body, updated_at) VALUES
     ($1, $3, 'All Saints, Sunday Mass', '2026-11-01', '{"kind":"mass","items":[{"key":"8","group":"word","order":1,"kind":"song","songId":"${RETIRED_SONG}"}]}', now()),
     ($2, $3, 'Charismatic Prayer Night', '2026-11-06', '{"kind":"pw","items":[]}', now())`,
  [MASS_PLAN_ID, PRAISE_PLAN_ID, CHURCH],
);
await db.query(
  `INSERT INTO songs (id, church_id, title, category, language, musical_key, updated_at) VALUES
     (gen_random_uuid(), $1, 'Praise to the Lord, the Almighty', 'Entrance Procession', 'English', 'D', now()),
     (gen_random_uuid(), $1, 'Be Thou My Vision', 'Entrance Procession', 'English', 'Eb', now()),
     (gen_random_uuid(), $1, 'Psalm 24 setting', 'Responsorial Psalm', 'English', 'F', now()),
     (gen_random_uuid(), $1, 'Our God is an awesome God', '', 'English', 'E', now())`,
  [CHURCH],
);

// One setup key for this run, so a new church can be set up from the browser. Printed below, as the test password is.
const SETUP_KEY = setupKey();
await db.query(`INSERT INTO setup_keys (key_hash) VALUES ($1)`, [hashToken(SETUP_KEY, LOCAL_SECRET)]);

const sql = async (strings, ...values) => {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  return (await db.query(text, values)).rows;
};
const api = createApi({ sql, secret: LOCAL_SECRET });
const transaction = (work) => db.transaction((tx) => work(tagFromQuery((t, v) => tx.query(t, v))));
const admin = createAdminApi({ sql, transaction, secret: LOCAL_SECRET });
const linking = createLinkingApi({ sql, transaction, secret: LOCAL_SECRET });
const deviceUsers = createDeviceUsersApi({ sql, secret: LOCAL_SECRET, addUser: admin.addUser });
const churchSetup = createChurchSetupApi({ sql, transaction, secret: LOCAL_SECRET });
const planEditing = createPlanEditingApi({ sql, transaction, secret: LOCAL_SECRET });
const songsSync = createSongsSyncApi({ sql, transaction, secret: LOCAL_SECRET });
const planSync = createPlanSyncApi({ sql, transaction, secret: LOCAL_SECRET });
const routes = {
  login: api.login, logout: api.logout, me: api.me, 'change-password': api.changePassword, plans: api.plans,
  'users-list': admin.list, 'users-create': admin.create, 'users-update': admin.update,
  'users-reset-password': admin.resetPassword, 'users-unlock': admin.unlock,
  'link-code-create': linking.createCode, 'link-redeem': linking.redeem, 'device-status': linking.status, 'device-unlink': linking.unlink,
  'devices-list': linking.list,
  'device-users-create': deviceUsers,
  'setup-church-admin': churchSetup,
  'plan-get': planEditing.getPlan,
  'plan-save': planEditing.savePlan,
  'songs-list': planEditing.listSongs,
  'songs-sync-push': songsSync.pushSongs,
  'plan-create': planSync.createPlan,
  'plan-delete': planSync.deletePlan,
  'plan-sync-get': planSync.getPlan,
  'plan-sync-pull': planSync.pullPlans,
  'plan-sync-push': planSync.pushPlans,
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // /api/<name> as on Vercel, and the old /.netlify/functions/<name> that vercel.json still rewrites for older desktop apps.
  const fn = url.pathname.match(/^\/(?:api|\.netlify\/functions)\/([a-z-]+)$/)?.[1];
  if (fn) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const handler = routes[fn];
    const result = handler
      ? await handler({ httpMethod: req.method, headers, body: Buffer.concat(chunks).toString('utf8'), queryStringParameters: Object.fromEntries(url.searchParams) })
      : { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: '{"error":"Not found."}' };
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(WEB, rel);
  if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`Local planner on http://localhost:${PORT}  (test accounts: planner, viewer, fresh, boss (admin))`);
  console.log(`Test password for this run: ${PASSWORD}`);
  console.log(`Test setup key for this run (works once): ${SETUP_KEY}`);
});
