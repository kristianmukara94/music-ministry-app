// The plan editor's calls to the server. Each one returns the parsed body, or throws an Error whose message is the server's plain
// message, or a neutral line when the server gave none. The session cookie is sent by the browser; nothing is kept in storage.
const API = '/.netlify/functions';
const NEUTRAL = 'Something went wrong. Try again.';
const UNREACHABLE = 'Cannot reach the planner. Check your connection and try again.';

async function request(name, { method = 'GET', query = '', body } = {}) {
  let res;
  try {
    res = await fetch(`${API}/${name}${query}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(UNREACHABLE);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === 'string' && data.error.length <= 200 ? data.error : NEUTRAL);
  return data;
}

/** One plan with its structure, and whether this user may edit it. */
export const getPlan = (id) => request('plan-get', { query: `?id=${encodeURIComponent(id)}` });

/** The church's songs, for the song picker. An empty list is a normal answer. */
export const listSongs = () => request('songs-list');

/** Saves the whole plan in one request. */
export const savePlan = (payload) => request('plan-save', { method: 'POST', body: payload });
