// API function: users-create. The check and the logic live in lib/admin.js, so they are tested against a real Postgres.
import { createAdminApi } from '../lib/admin.js';
import { productionDeps } from '../lib/neon.js';

let api;
const get = () => (api ??= createAdminApi({ ...productionDeps(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get().create(event);
