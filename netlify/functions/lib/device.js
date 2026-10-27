// A linked laptop, identified by its device token. The church comes from the token's row, never from a request. Shared by
// every function that acts for a laptop, so the rule for "a valid device" lives in one place.
import { bearerToken as bearerFromHeader, hashToken } from './auth.js';

/** The device token from `Authorization: Bearer <token>`, or null. */
export const bearerToken = (headers) => bearerFromHeader(headers);

/** The linked laptop for this token: its church, its linked admin, and its setup window. Null when unknown or revoked. */
export async function deviceFrom({ sql, secret }, token) {
  if (!token) return null;
  const rows = await sql`
    SELECT device_id, church_id, user_id, device_name, setup_until, last_seen_at FROM device_tokens
    WHERE token_hash = ${hashToken(token, secret)} AND revoked_at IS NULL`;
  return rows[0] ?? null;
}
