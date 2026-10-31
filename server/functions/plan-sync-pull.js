// API function: plan-sync-pull. The logic lives in lib/plan-sync.js so it can be tested against a real Postgres.
import { createPlanSyncApi } from '../lib/plan-sync.js';
import { productionDeps } from '../lib/neon.js';

let api;
const get = () => (api ??= createPlanSyncApi({ ...productionDeps(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get().pullPlans(event);
