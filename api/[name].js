// Vercel entry point for every API function. A request to /api/<name> (or the old /.netlify/functions/<name>, which vercel.json
// rewrites here for desktop apps released before the move) runs server/functions/<name>.js. The logic is in
// server/lib/vercel-adapter.js so it can be tested.
import { createVercelHandler, LOADERS } from '../server/lib/vercel-adapter.js';

export default createVercelHandler(LOADERS);
