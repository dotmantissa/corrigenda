/** Reset cached adapters when activating a successor dispatcher, retaining identities and operations. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { contracts } from '../src/lib/server/chain';
import { db } from '../src/lib/server/db';
import { createHash } from 'node:crypto';
import { canonical } from '../src/lib/shared/canonical';

const sql = db();
const file = '.env.network-activation.json';
async function persist(value: unknown) {
  await writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(file + '.tmp', file);
}
let saved: { dispatcher: string; adapters: string[]; complete: boolean } | undefined;
try {
  saved = JSON.parse(await readFile(file, 'utf8'));
} catch {}
if (saved?.dispatcher === contracts.dispatcher && saved.complete) {
  console.log('This dispatcher has already been activated.');
} else {
  const pending =
    await sql`SELECT count(*)::int AS total FROM operations WHERE status IN ('PENDING','SIGNED','SUBMITTED','ACCEPTED')`;
  if (pending[0].total)
    throw new Error('Reconcile pending signed operations before activating the successor network.');
  if (saved?.dispatcher !== contracts.dispatcher) {
    const identities = await sql`SELECT listing_consumer,deployment_consumer FROM identities`;
    saved = {
      dispatcher: contracts.dispatcher,
      adapters: [
        ...new Set(
          identities.flatMap((i) => [i.listing_consumer, i.deployment_consumer]).filter(Boolean),
        ),
      ] as string[],
      complete: false,
    };
    await persist(saved);
  }
  // Only clear addresses captured before activation. A resumed run preserves any newly deployed adapters.
  const oldAdapters = JSON.stringify(saved!.adapters);
  const affected =
    await sql`SELECT id,address FROM identities WHERE listing_consumer IN (SELECT jsonb_array_elements_text(${oldAdapters}::jsonb)) OR deployment_consumer IN (SELECT jsonb_array_elements_text(${oldAdapters}::jsonb))`;
  await sql.transaction([
    ...affected.map((identity) => {
      const id = `adapters.${contracts.dispatcher.slice(2)}.${identity.address.slice(2)}`;
      const payload = { kind: 'deploy_consumers', operation_id: id };
      const digest = createHash('sha256').update(canonical(payload)).digest('hex');
      return sql`INSERT INTO operations(id,identity_id,kind,payload,payload_digest) VALUES(${id},${identity.id},'deploy_consumers',${JSON.stringify(payload)},${digest}) ON CONFLICT(id) DO NOTHING`;
    }),
    sql`UPDATE identities SET listing_consumer=NULL WHERE listing_consumer IN (SELECT jsonb_array_elements_text(${oldAdapters}::jsonb))`,
    sql`UPDATE identities SET deployment_consumer=NULL WHERE deployment_consumer IN (SELECT jsonb_array_elements_text(${oldAdapters}::jsonb))`,
    sql`DELETE FROM indexed_records`,
    sql`DELETE FROM chain_events`,
    sql`DELETE FROM index_cursors`,
  ]);
  await persist({ ...saved, complete: true });
  console.log(
    'Successor dispatcher activated. Identity keys and signed history retained; historical caches reset and replacement adapters queued.',
  );
}
