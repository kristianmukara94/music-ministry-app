// API function: plan-save. Saves a plan's structure from the web editor. The logic lives in lib/plan-editing.js so it can be tested against a real Postgres.
import { createPlanEditingApi } from '../lib/plan-editing.js';
import { productionDeps } from '../lib/neon.js';

let api;
const get = () => (api ??= createPlanEditingApi({ ...productionDeps(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get().savePlan(event);
