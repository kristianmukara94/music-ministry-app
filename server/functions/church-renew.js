// API function: church-renew. Renews a church's license from a linked laptop, with a one-time setup key. The logic lives in lib/church-setup.js
// so it can be tested against a real Postgres.
import { createChurchRenewApi } from '../lib/church-setup.js';
import { productionDeps } from '../lib/neon.js';

let api;
const get = () => (api ??= createChurchRenewApi({ ...productionDeps(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get()(event);
