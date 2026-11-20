// API function: theme. The signed-in user's church colour theme, for the website's live theme watcher. The logic is in lib/theme-sync.js.
import { createThemeSyncApi } from '../lib/theme-sync.js';
import { productionSql } from '../lib/neon.js';

let api;
const get = () => (api ??= createThemeSyncApi({ sql: productionSql(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get().webTheme(event);
