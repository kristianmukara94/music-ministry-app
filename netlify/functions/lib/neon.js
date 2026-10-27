// The production database connections. The URL comes from the DATABASE_URL environment variable set in Netlify. It is read
// at call time and never written to a file or logged.
//
// Two connections are used. The HTTP connection serves single queries. A pooled connection (WebSocket) serves transactions,
// because the HTTP connection cannot hold a transaction open across several statements.
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { tagFromQuery } from './db.js';

neonConfig.webSocketConstructor = ws;

let deps = null;

function url() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set in this environment.');
  return process.env.DATABASE_URL;
}

export function productionSql() {
  return neon(url());
}

/** The query tag and the transaction helper, built once per function instance. */
export function productionDeps() {
  if (deps) return deps;
  const pool = new Pool({ connectionString: url() });
  deps = {
    sql: neon(url()),
    transaction: async (work) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(tagFromQuery((text, values) => client.query(text, values)));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
  return deps;
}
