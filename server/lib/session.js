// Looks up the signed-in user for a request from its session cookie. Shared by every function that needs a user.
import { hashToken, readCookie, lowerHeaders } from './auth.js';

/**
 * The signed-in user for this request, or null. The church comes from the session row, never from the request. A disabled
 * user's sessions are deleted at once, so a disabled account is signed out on its next request.
 */
export async function sessionFrom({ sql, secret, now }, event) {
  const token = readCookie(lowerHeaders(event.headers).cookie);
  if (!token) return null;
  const rows = await sql`
    SELECT s.church_id, u.id AS user_id, u.username, u.display_name, u.role, u.must_change_password, u.disabled
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token, secret)} AND s.expires_at > ${now().toISOString()}`;
  const row = rows[0];
  if (!row) return null;
  if (row.disabled) {
    await sql`DELETE FROM sessions WHERE user_id = ${row.user_id}`;
    return null;
  }
  return {
    userId: row.user_id,
    churchId: row.church_id,
    role: row.role,
    username: row.username,
    displayName: row.display_name,
    mustChangePassword: row.must_change_password,
  };
}
