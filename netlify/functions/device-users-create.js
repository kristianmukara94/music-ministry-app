// Netlify Function: device-users-create. Adds a web user from a linked laptop. The logic lives in lib/device-users.js so it can be
// tested against a real Postgres.
import { createAdminApi } from './lib/admin.js';
import { createDeviceUsersApi } from './lib/device-users.js';
import { productionDeps } from './lib/neon.js';

let api;
const get = () => {
  if (!api) {
    const deps = productionDeps();
    const secret = process.env.TOKEN_SECRET;
    const admin = createAdminApi({ ...deps, secret });
    api = createDeviceUsersApi({ sql: deps.sql, secret, addUser: admin.addUser });
  }
  return api;
};

export const handler = (event) => get()(event);
