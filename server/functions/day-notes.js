// API function: day-notes. The church's calendar day memos for the web Planner. The logic is in lib/day-notes.js.
import { createDayNotesApi } from '../lib/day-notes.js';
import { productionSql } from '../lib/neon.js';

let api;
const get = () => (api ??= createDayNotesApi({ sql: productionSql(), secret: process.env.TOKEN_SECRET }));

export const handler = (event) => get().dayNotes(event);
