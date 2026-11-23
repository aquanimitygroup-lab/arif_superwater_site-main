import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

let sql;

/** One shared connection pool per server instance. */
export function db() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new HttpError(503, 'The database is not connected yet. Set DATABASE_URL in your Vercel project settings.');
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
  sql = postgres(url, {
    ssl: local ? false : 'require',
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // works with connection poolers (Neon, Supabase)
    onnotice: () => {},
  });
  return sql;
}

let schemaReady;
/** Creates tables on first use, so a fresh database works without a manual step. */
export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const s = db();
      const ddl = readFileSync(join(here, '..', 'db', 'schema.sql'), 'utf8');
      await s.unsafe(ddl);
      const { seedDefaults } = await import('./seed.js');
      await seedDefaults(s);
    })().catch((e) => { schemaReady = undefined; throw e; });
  }
  return schemaReady;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
