// Netlify Function: songs-sync-push. A linked laptop sends its full song list (metadata only). The logic lives in lib/songs-sync.js so
// it can be tested against a real Postgres.
import { createSongsSyncApi } from './lib/songs-sync.js';
import { productionDeps } from './lib/neon.js';

let api;
const get = () => (api ??= createSongsSyncApi({ ...productionDeps(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get().pushSongs(event);
