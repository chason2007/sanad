import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/**
 * The parts of Supabase that live outside our migrations. We recreate the
 * surface our SQL actually touches - roles, auth.uid(), the storage tables -
 * so the real migration files run unmodified against a real Postgres.
 */
const SUPABASE_SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Supabase derives these from the verified JWT. Tests set the claims GUC
-- directly, which is exactly what PostgREST does after verifying a token.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'),
    ''
  )::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
alter table storage.objects force row level security;

-- Splits an object key into path segments, as Supabase Storage does.
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$ select string_to_array(name, '/') $$;

grant usage on schema auth, storage to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
`;

export type TestDb = PGlite;

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    let sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // gen_random_uuid() is core since PG13; PGlite has no pgcrypto contrib.
    sql = sql.replace(/create extension if not exists "pgcrypto";/g, '');
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

/** Create an auth user and return its id. */
export async function createAuthUser(db: TestDb, email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [email],
  );
  return res.rows[0].id;
}

/**
 * Run a callback as the `authenticated` Postgres role with the given JWT
 * claims - i.e. exactly the privilege context a browser request gets.
 *
 * Wrapped in its own transaction so `set local role` is scoped and cannot
 * leak superuser privileges into the next assertion. A throwing callback
 * rolls back, which is what we want when asserting a write was denied.
 */
export async function asUser<T>(
  db: TestDb,
  userId: string,
  claims: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const payload = JSON.stringify({ sub: userId, role: 'authenticated', ...claims });
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [payload]);
    await db.exec('set local role authenticated');
    const out = await fn();
    await db.exec('commit');
    return out;
  } catch (err) {
    await db.exec('rollback');
    throw err;
  }
}

/** Convenience: the JWT claims Supabase issues for a member of `orgId`. */
export function claimsFor(orgId: string, role: 'owner' | 'admin' | 'viewer' = 'owner') {
  return { app_metadata: { org_id: orgId, org_role: role } };
}
