// Netlify Function: link-code-create. The logic lives in lib/linking.js so it can be tested against a real Postgres.
import { createLinkingApi, REDEEM_LIMIT } from './lib/linking.js';
import { productionDeps } from './lib/neon.js';
import { createRateLimiter } from './lib/rules.js';

let api;
const get = () => (api ??= createLinkingApi({
  ...productionDeps(),
  secret: process.env.TOKEN_SECRET,
  redeemLimiter: createRateLimiter(REDEEM_LIMIT),
}));

export const handler = (event) => get().createCode(event);
