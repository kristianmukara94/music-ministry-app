// Netlify Function: device-status. The logic lives in lib/linking.js so it can be tested against a real Postgres.
import { createLinkingApi } from './lib/linking.js';
import { productionDeps } from './lib/neon.js';

let api;
const get = () => (api ??= createLinkingApi({ ...productionDeps(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get().status(event);
