// Vercel entry point for every Netlify function. A request to /api/<name> (or /.netlify/functions/<name>, rewritten by vercel.json)
// runs netlify/functions/<name>.js. The logic is in netlify/functions/lib/vercel-adapter.js so it can be tested.
import { createVercelHandler, LOADERS } from '../netlify/functions/lib/vercel-adapter.js';

export default createVercelHandler(LOADERS);
