// Rate limits kept in Neon, so every function instance shares the same counts. One statement per attempt: the insert or the update
// is atomic, so parallel requests on one bucket never let more than the limit through. A window that has expired starts again
// at this attempt. The counts are per bucket: a limit's name plus a client address (or a keyed token), never the request body.

/**
 * Counts one attempt in `bucketKey`. Allows it while the window holds no more than `limit` attempts, and refuses it after.
 * Returns { allowed, retryAfterSeconds }; retryAfterSeconds is 0 when allowed.
 */
export async function hit(sql, bucketKey, limit, windowSeconds, now = new Date()) {
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - windowSeconds * 1000).toISOString();
  const rows = await sql`
    INSERT INTO rate_limits (bucket_key, window_start, hits)
    VALUES (${bucketKey}, ${at}, 1)
    ON CONFLICT (bucket_key) DO UPDATE SET
      window_start = CASE WHEN rate_limits.window_start <= ${cutoff} THEN ${at} ELSE rate_limits.window_start END,
      hits = CASE WHEN rate_limits.window_start <= ${cutoff} THEN 1 ELSE rate_limits.hits + 1 END
    RETURNING hits, window_start`;
  const hits = Number(rows[0].hits);
  if (hits <= limit) return { allowed: true, retryAfterSeconds: 0 };
  const resetAt = new Date(rows[0].window_start).getTime() + windowSeconds * 1000;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)) };
}
