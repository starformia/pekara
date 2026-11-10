import { neon } from '@neondatabase/serverless';

let runner = null;
let migrated = false;

async function getRunner() {
  if (runner) return runner;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (url.startsWith('pglite:')) {
    // Local development / tests only: embedded Postgres, no account needed.
    const { PGlite } = await import('@electric-sql/pglite');
    const path = url.slice(7);
    const pg = path ? new PGlite(path) : new PGlite();
    runner = async (t, p = []) => (await pg.query(t, p)).rows;
  } else {
    const sql = neon(url);
    runner = (t, p = []) => sql.query(t, p);
  }
  return runner;
}

export async function q(text, params = []) {
  const run = await getRunner();
  if (!migrated) {
    await run(`create table if not exists users(
      id text primary key, username text unique not null, name text not null,
      role text not null default 'staff', color text, pass_hash text not null,
      fails int not null default 0, locked_until timestamptz,
      created_at timestamptz not null default now())`);
    await run(`create table if not exists docs(
      coll text not null, id text not null, data jsonb not null,
      updated_at timestamptz not null default now(), primary key(coll, id))`);
    migrated = true;
  }
  return run(text, params);
}
