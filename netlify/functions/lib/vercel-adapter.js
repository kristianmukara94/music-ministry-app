// Runs the Netlify handlers on Vercel. Each netlify/functions/<name>.js exports handler(event), which returns { statusCode, headers,
// body }. This turns a Vercel request into that event and the result back into a Vercel response. The handlers do not change.
// Only the names in LOADERS are served; any other name gets 404.

const LOADERS = {
  'admin-create-from-app': () => import('../admin-create-from-app.js'),
  'change-password': () => import('../change-password.js'),
  'device-status': () => import('../device-status.js'),
  'device-unlink': () => import('../device-unlink.js'),
  'device-users-create': () => import('../device-users-create.js'),
  'link-code-create': () => import('../link-code-create.js'),
  'link-redeem': () => import('../link-redeem.js'),
  login: () => import('../login.js'),
  logout: () => import('../logout.js'),
  me: () => import('../me.js'),
  'plan-get': () => import('../plan-get.js'),
  'plan-save': () => import('../plan-save.js'),
  plans: () => import('../plans.js'),
  'setup-church-admin': () => import('../setup-church-admin.js'),
  'songs-sync-push': () => import('../songs-sync-push.js'),
  'plan-create': () => import('../plan-create.js'),
  'plan-delete': () => import('../plan-delete.js'),
  'plan-sync-get': () => import('../plan-sync-get.js'),
  'plan-sync-pull': () => import('../plan-sync-pull.js'),
  'plan-sync-push': () => import('../plan-sync-push.js'),
  'songs-list': () => import('../songs-list.js'),
  'users-create': () => import('../users-create.js'),
  'users-list': () => import('../users-list.js'),
  'users-reset-password': () => import('../users-reset-password.js'),
  'users-unlock': () => import('../users-unlock.js'),
  'users-update': () => import('../users-update.js'),
};

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

/** The request body as the text the handlers parse. Vercel may have parsed JSON already, so it is turned back into text. */
export function bodyText(body) {
  if (body === undefined || body === null || body === '') return undefined;
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return JSON.stringify(body);
}

/** The Netlify-style event for a Vercel request. Header names are lower case, and a client's own address header is removed. */
export function toEvent(req) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers ?? {})) headers[key.toLowerCase()] = value;
  // Only the platform may set this one. A copy the client sent is removed, so it cannot choose a rate-limit bucket.
  delete headers['x-nf-client-connection-ip'];
  const { name, ...query } = req.query ?? {};
  return {
    httpMethod: req.method,
    headers,
    body: bodyText(req.body),
    queryStringParameters: Object.keys(query).length ? query : null,
    remoteAddress: req.socket?.remoteAddress,
  };
}

function send(res, statusCode, headers, body) {
  res.statusCode = statusCode;
  for (const [key, value] of Object.entries(headers ?? {})) res.setHeader(key, value);
  res.end(body ?? '');
}

/** The Vercel handler for api/[name].js. `loaders` maps each served name to a function that loads its module. */
export function createVercelHandler(loaders) {
  return async function vercelHandler(req, res) {
    const name = req.query?.name;
    const load = typeof name === 'string' && Object.hasOwn(loaders, name) ? loaders[name] : null;
    if (!load) return send(res, 404, JSON_HEADERS, '{"error":"Not found."}');
    let result;
    try {
      const mod = await load();
      result = await mod.handler(toEvent(req));
    } catch (err) {
      // Logs the kind of error only. The message can contain query text, so it is left out.
      console.error(`[vercel] ${err.name}`);
      result = { statusCode: 500, headers: JSON_HEADERS, body: '{"error":"Something went wrong. Try again."}' };
    }
    return send(res, result.statusCode, result.headers, result.body);
  };
}

export { LOADERS };
