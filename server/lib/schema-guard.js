// Production's database is migrated by hand, so it can lag server/db/schema.sql. These helpers keep a save working while an optional
// column is still missing, and turn a database error into one plain sentence an operator or admin can act on. No error text from the
// database reaches the response except a column or table name, which says nothing about a church's data.

const UNDEFINED_COLUMN = '42703';
const UNDEFINED_TABLE = '42P01';

/** True when `err` is Postgres's "column does not exist", for `column` when one is named. */
export const isMissingColumn = (err, column) =>
  err?.code === UNDEFINED_COLUMN && (!column || String(err?.message ?? '').includes(column));

const missingSince = new Set();

/**
 * Runs `primary`. If the database has no `column` yet, logs which migration is missing (once per instance) and runs `fallback`, which
 * writes the same thing without that column. Any other error is thrown as it was.
 */
export async function withColumnFallback(column, primary, fallback) {
  if (missingSince.has(column)) return fallback();
  try {
    return await primary();
  } catch (err) {
    if (!isMissingColumn(err, column)) throw err;
    missingSince.add(column);
    console.error(`[schema] column=${column} missing: run the matching file in server/db/migrations on this database`);
    return fallback();
  }
}

/** Forgets which columns were found missing. Tests only. */
export const resetSchemaGuard = () => missingSince.clear();

/** The quoted name in a Postgres message such as `column "synced_at" of relation "plans" does not exist`, if it is a plain identifier. */
function quotedName(message) {
  const match = /"([a-z_][a-z0-9_]{0,62})"/i.exec(String(message ?? ''));
  return match ? match[1] : null;
}

/**
 * A database error as `{ code, message }` for a plan's result. `code` is stable for the laptop to act on; `message` is for people.
 * Each message ends by saying what happens next, so nobody has to guess whether to try again.
 */
export function describeDbError(err) {
  const pg = typeof err?.code === 'string' ? err.code : '';
  if (pg === UNDEFINED_COLUMN || pg === UNDEFINED_TABLE) {
    const name = quotedName(err.message);
    return {
      code: 'db_schema',
      message: `The website's database is missing ${name ? `"${name}"` : 'a column or table'}. Ask your admin to run the latest database migration. The plan will be sent again.`,
    };
  }
  if (pg === '23505') {
    return { code: 'db_conflict', message: 'The website already holds a record that clashes with this plan. The plan will be sent again; if this keeps happening, ask your admin.' };
  }
  if (pg.startsWith('22') || pg.startsWith('23')) {
    return { code: 'db_rejected', message: "The website's database refused a value in this plan. Check its name and date, then save it again." };
  }
  if (pg === '40001' || pg === '40P01' || pg === '55P03') {
    return { code: 'busy', message: 'The website was busy saving this plan from somewhere else. It will be sent again.' };
  }
  if (pg.startsWith('08') || pg === '28P01' || pg === '53300' || pg === '57P01' || err?.name === 'NeonDbError') {
    return { code: 'db_unavailable', message: 'The website could not reach its database just now. The plan will be sent again.' };
  }
  return {
    code: 'server_error',
    message: `The website hit an unexpected error (${err?.name ?? 'Error'}${pg ? ` ${pg}` : ''}). The plan will be sent again; if this keeps happening, ask your admin to check the website logs.`,
  };
}
