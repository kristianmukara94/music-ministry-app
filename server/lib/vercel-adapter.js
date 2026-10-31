// Runs the API handlers on Vercel. Each server/functions/<name>.js exports handler(event), which returns { statusCode, headers,
// body }. This turns a Vercel request into that event and the result back into a Vercel response. The handlers do not change.
// Only the names in LOADERS are served; any other name gets 404.

const LOADERS = {
  'admin-create-from-app': () => import('../functions/admin-create-from-app.js'),
  'change-password': () => import('../functions/change-password.js'),
  'device-status': () => import('../functions/device-status.js'),
  'device-unlink': () => import('../functions/device-unlink.js'),
  'device-users-create': () => import('../functions/device-users-create.js'),
  'devices-list': () => import('../functions/devices-list.js'),
  'link-code-create': () => import('../functions/link-code-create.js'),
  'link-redeem': () => import('../functions/link-redeem.js'),
  login: () => import('../functions/login.js'),
  logout: () => import('../functions/logout.js'),
  me: () => import('../functions/me.js'),
  'plan-get': () => import('../functions/plan-get.js'),
  'plan-save': () => import('../functions/plan-save.js'),
  plans: () => import('../functions/plans.js'),
  'setup-church-admin': () => import('../functions/setup-church-admin.js'),
  'songs-sync-push': () => import('../functions/songs-sync-push.js'),
  'plan-create': () => import('../functions/plan-create.js'),
  'plan-delete': () => import('../functions/plan-delete.js'),
  'plan-sync-get': () => import('../functions/plan-sync-get.js'),
  'plan-sync-pull': () => import('../functions/plan-sync-pull.js'),
  'plan-sync-push': () => import('../functions/plan-sync-push.js'),
  'songs-list': () => import('../functions/songs-list.js'),
  'users-create': () => import('../functions/users-create.js'),
  'users-list': () => import('../functions/users-list.js'),
  'users-reset-password': () => import('../functions/users-reset-password.js'),
  'users-unlock': () => import('../functions/users-unlock.js'),
  'users-update': () => import('../functions/users-update.js'),
};

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

/** The request body as the text the handlers parse. Vercel may have parsed JSON already, so it is turned back into text. */
export function bodyText(body) {
  if (body === undefined || body === null || body === '') return undefined;
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return JSON.stringify(body);
}

/** The handler event for a Vercel request. Header names are lower case. */
export function toEvent(req) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers ?? {})) headers[key.toLowerCase()] = value;
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
