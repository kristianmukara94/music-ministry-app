// The church API's request logic, separate from HTTP and from the database. The church a request acts on always comes from
// its token. Nothing in the body or the query string can choose the church: those fields are never read for that purpose.
//
// `store` is the data layer. This file ships with an in-memory store for tests. The production store (Neon, Netlify Blobs
// or both) must implement the same methods and filter every query by church_id.
import { randomUUID, randomBytes } from 'node:crypto';
import { DEFAULT_BRANDING, checkBrandingChange, checkLogo, displayCodeFrom, sanitiseBranding } from './church.js';

const SYNCED_TABLES = ['plans', 'songs', 'devices'];

/** The in-memory store. Every table is kept per church, and every method takes the church id. */
export function createMemoryStore() {
  const churches = new Map(); // church id -> record
  const rows = new Map(); // table -> church id -> [row]
  const logos = new Map(); // church id -> { type, bytes }
  const table = (name) => {
    if (!rows.has(name)) rows.set(name, new Map());
    return rows.get(name);
  };
  return {
    codeInUse: (code) => [...churches.values()].some((c) => c.displayCode === code),
    createChurch(record) {
      churches.set(record.id, record);
      return record;
    },
    church: (churchId) => churches.get(churchId) ?? null,
    list: (name, churchId) => [...(table(name).get(churchId) ?? [])],
    insert(name, churchId, row) {
      const list = table(name).get(churchId) ?? [];
      list.push({ ...row, church_id: churchId });
      table(name).set(churchId, list);
    },
    setBranding(churchId, branding) {
      const church = churches.get(churchId);
      if (church) churches.set(churchId, { ...church, branding });
    },
    logo: (churchId) => logos.get(churchId) ?? null,
    setLogo: (churchId, logo) => logos.set(churchId, logo),
  };
}

/**
 * The API. `tokens` maps each issued token to the one church it belongs to. A request with an unknown token gets 401.
 * `handle({ method, path, token, body })` returns `{ status, body }`.
 */
export function createChurchApi({ store, tokens = new Map(), newUuid = randomUUID, newBytes = () => randomBytes(8) }) {
  const issue = (churchId) => {
    const token = randomBytes(24).toString('hex');
    tokens.set(token, churchId);
    return token;
  };

  /** A new church: its record, a display code nobody else has, and an admin token that belongs only to it. */
  function createChurch(body) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    try {
      checkBrandingChange({ name });
    } catch (err) {
      return { status: 400, body: { error: err.message } };
    }
    let displayCode;
    do {
      displayCode = displayCodeFrom(newBytes());
    } while (store.codeInUse(displayCode));
    const id = newUuid();
    const record = { id, displayCode, name, branding: sanitiseBranding({ name }), createdAt: new Date().toISOString() };
    store.createChurch(record);
    return { status: 201, body: { church: record, token: issue(id) } };
  }

  /** Runs one request. The church is the token's church, and nothing else. */
  function handle({ method, path: rawPath, token, body }) {
    // The query string is dropped: it can never name a church, so it is not read at all.
    const path = rawPath.split('?')[0];
    if (method === 'POST' && path === '/api/churches') return createChurch(body);

    const churchId = tokens.get(token);
    if (!churchId) return { status: 401, body: { error: 'Sign in or link this laptop first.' } };

    if (method === 'GET' && SYNCED_TABLES.includes(path.slice(5))) {
      return { status: 200, body: store.list(path.slice(5), churchId) };
    }
    if (method === 'GET' && path === '/api/branding') {
      const church = store.church(churchId);
      const logo = store.logo(churchId);
      return {
        status: 200,
        body: { ...church.branding, name: church.name, displayCode: church.displayCode, hasLogo: Boolean(logo), logoType: logo?.type ?? null },
      };
    }
    if (method === 'PUT' && path === '/api/branding') {
      const patch = body && typeof body === 'object' ? body : {};
      try {
        checkBrandingChange(patch);
      } catch (err) {
        return { status: 400, body: { error: err.message } };
      }
      const church = store.church(churchId);
      const branding = sanitiseBranding({ ...church.branding, ...pick(patch, ['accentGold', 'fontChoice']) });
      const name = 'name' in patch ? patch.name.trim() : church.name;
      store.setBranding(churchId, branding);
      store.createChurch({ ...store.church(churchId), name });
      return { status: 200, body: { ...branding, name } };
    }
    if (method === 'PUT' && path === '/api/logo') {
      const check = checkLogo(body?.bytes);
      if (!check.ok) return { status: 400, body: { error: check.error } };
      store.setLogo(churchId, { type: check.type, bytes: Buffer.from(body.bytes) });
      return { status: 200, body: { type: check.type } };
    }
    if (method === 'GET' && path === '/api/logo') {
      const logo = store.logo(churchId);
      if (!logo) return { status: 404, body: { error: 'No logo has been set.' } };
      return { status: 200, body: { type: logo.type, bytes: logo.bytes } };
    }
    return { status: 404, body: { error: 'Not found.' } };
  }

  return { handle, issue, createChurch, DEFAULT_BRANDING };
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
