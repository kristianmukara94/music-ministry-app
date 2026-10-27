// Netlify Function: setup-church-admin. Creates a church and its first admin from a laptop, with a one-time setup key. The logic
// lives in lib/church-setup.js so it can be tested against a real Postgres.
import { createChurchSetupApi } from './lib/church-setup.js';
import { productionDeps } from './lib/neon.js';

let api;
const get = () => (api ??= createChurchSetupApi({ ...productionDeps(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get()(event);
