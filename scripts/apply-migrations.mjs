/**
 * Apply supabase/migrations/*.sql through the Supabase Management API.
 *
 * Normally this is `supabase db push`, which speaks the Postgres wire
 * protocol on port 5432. That port is blocked from this environment, so we
 * go over HTTPS instead and record the results in
 * supabase_migrations.schema_migrations ourselves, which is the same table
 * the CLI uses - so a later `db push` from an unblocked network sees these
 * as already applied rather than trying to run them twice.
 *
 * Usage: node scripts/apply-migrations.mjs [--dry]
 * Env:   SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const DRY = process.argv.includes('--dry');

if (!REF || !TOKEN) {
  console.error('Set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN.');
  process.exit(1);
}

const ENDPOINT = `https://api.supabase.com/v1/projects/${REF}/database/query`;

async function runSql(query) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const message = body?.message || body?.error || text;
    throw new Error(`HTTP ${res.status}: ${message}`);
  }
  return body;
}

const files = readdirSync(join(process.cwd(), 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log(`Project ${REF} - ${files.length} migrations\n`);

// The CLI's bookkeeping table. Creating it ourselves keeps both paths in sync.
await runSql(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text
  );
`);

const applied = new Set(
  (await runSql('select version from supabase_migrations.schema_migrations'))
    .map((r) => r.version),
);

let ran = 0;
for (const file of files) {
  const version = file.split('_')[0];
  const name = file.replace(/^\d+_/, '').replace(/\.sql$/, '');

  if (applied.has(version)) {
    console.log(`  skip  ${file} (already applied)`);
    continue;
  }
  if (DRY) {
    console.log(`  would run  ${file}`);
    continue;
  }

  process.stdout.write(`  apply ${file} ... `);
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8');

  try {
    await runSql(sql);
  } catch (err) {
    console.log('FAILED');
    console.error(`\n${file}\n${err.message}\n`);
    process.exit(1);
  }

  await runSql(
    `insert into supabase_migrations.schema_migrations (version, name)
     values ('${version}', '${name.replace(/'/g, "''")}')
     on conflict (version) do nothing;`,
  );

  console.log('ok');
  ran += 1;
}

console.log(`\n${ran} applied, ${files.length - ran} skipped.`);
