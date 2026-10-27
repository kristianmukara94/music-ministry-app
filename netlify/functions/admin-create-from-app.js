// Netlify Function: creates a web planner account from the desktop app, using the laptop's device token. The logic lives in
// lib/app-admin.js so it can be tested against a real Postgres.
import { createAppAdminApi } from './lib/app-admin.js';
import { productionDeps } from './lib/neon.js';

let createFromApp;
const get = () => (createFromApp ??= createAppAdminApi({ ...productionDeps(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get()(event);
