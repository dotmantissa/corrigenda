/** Finalize adapters queued by the authorized successor-network activation. */
import { readFile, writeFile } from 'node:fs/promises';
import { db } from '../src/lib/server/db';
import { contracts } from '../src/lib/server/chain';
import { workerTick } from '../src/lib/server/worker';

const sql = db();
const activation = JSON.parse(await readFile('.env.network-activation.json', 'utf8'));
if (activation.dispatcher !== contracts.dispatcher || !activation.complete)
  throw new Error('Activate the successor dispatcher before reconciling its adapter migration.');
const prefix = `adapters.${contracts.dispatcher.slice(2)}.%`;
for (let attempt = 0; attempt < 90; attempt++) {
  const rows =
    await sql`SELECT o.id,o.status,o.transaction_hash AS hash,i.address,i.listing_consumer,i.deployment_consumer FROM operations o JOIN identities i ON i.id=o.identity_id WHERE o.id LIKE ${prefix} ORDER BY o.created_at`;
  if (!rows.length && activation.adapters.length)
    throw new Error('Historical adapters exist but their migration journal is missing.');
  if (rows.some((row) => ['DELIVERY_FAILED', 'UNRESOLVED', 'STRANDED'].includes(row.status)))
    throw new Error('Adapter migration failed; retained journal requires reconciliation.');
  if (
    rows.every(
      (row) => row.status === 'FINALIZED' && row.listing_consumer && row.deployment_consumer,
    )
  ) {
    await writeFile(
      'verification/email-migration.json',
      JSON.stringify(
        {
          network: 'studionet',
          chain_id: 61999,
          dispatcher: contracts.dispatcher,
          classification:
            'Authorized successor deployment using the previously authenticated identity and preserved custodial key; no fresh login is claimed.',
          operations: rows,
          complete: true,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('Identity adapter migration finalized; signing history retained.');
    break;
  }
  const pending = rows.find((row) =>
    ['PENDING', 'SIGNED', 'SUBMITTED', 'ACCEPTED'].includes(row.status),
  );
  if (pending) {
    console.log('Reconciling adapter migration', pending.id, pending.status);
    await workerTick(false, pending.id);
  }
  if (attempt === 89)
    throw new Error('Adapter migration wait exhausted; saved operation hashes are retained.');
  await new Promise((resolve) => setTimeout(resolve, 20000));
}
