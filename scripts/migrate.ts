import { readFile, readdir } from 'node:fs/promises';
import { db } from '../src/lib/server/db';
const sql = db();
await sql`CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
for (const name of (await readdir('database/migrations'))
  .filter((x) => x.endsWith('.sql'))
  .sort()) {
  const existing = await sql`SELECT name FROM migrations WHERE name=${name}`;
  if (existing.length) continue;
  const source = await readFile(`database/migrations/${name}`, 'utf8');
  // The checked in migration is fixed trusted SQL; no user values are interpolated.
  await sql.transaction([
    ...source
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => sql.query(x)),
    sql`INSERT INTO migrations(name) VALUES (${name})`,
  ]);
  console.log('Applied', name);
}
