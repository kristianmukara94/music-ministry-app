// API function: theme-sync. A linked laptop reads or sends its church's colour theme. The logic is in lib/theme-sync.js.
import { createThemeSyncApi } from '../lib/theme-sync.js';
import { productionSql } from '../lib/neon.js';

let api;
const get = () => (api ??= createThemeSyncApi({ sql: productionSql(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get().laptopTheme(event);
