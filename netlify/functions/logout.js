// Netlify Function: logout. The logic lives in lib/handlers.js so it can be tested against a real Postgres.
import { createApi } from './lib/handlers.js';
import { productionSql } from './lib/neon.js';

let api;
const get = () => (api ??= createApi({ sql: productionSql(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get().logout(event);
