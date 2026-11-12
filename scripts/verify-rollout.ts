import { writeFile } from 'node:fs/promises';
import { contracts, read } from '../src/lib/server/chain';
import { db } from '../src/lib/server/db';
import { waitUntil } from './lib/studio';

const sql = db();
const checks = [];
for (const contract of [contracts.registry, contracts.court, contracts.dispatcher]) {
  const history = await read<{ total: number }>(contract, 'get_history', [0, 1]);
  const cursors = await sql`SELECT cursor FROM index_cursors WHERE contract=${contract}`;
  const events =
    await sql`SELECT count(*)::int AS total FROM chain_events WHERE contract=${contract}`;
  const cursor = Number(cursors[0]?.cursor ?? -1);
  if (cursor !== history.total || events[0].total !== history.total)
    throw new Error('Public history projection is incomplete: ' + contract);
  checks.push({ contract, cursor, total: history.total, events: events[0].total });
  await new Promise((resolve) => setTimeout(resolve, 6000));
}
type Notice = { operation_id: string; dependency_id: string; status: string };
const notices = await waitUntil(
  async () => {
    const first = await read<{ items: Notice[]; total: number }>(
      contracts.dispatcher,
      'get_delivery_page',
      ['public.pep724.withdrawal', 'draft_status', 0, 20],
    );
    const last = await read<{ items: Notice[] }>(contracts.dispatcher, 'get_delivery_page', [
      'public.pep724.withdrawal',
      'draft_status',
      20,
      20,
    ]);
    return { total: first.total, items: [...first.items, ...last.items] };
  },
  (page) =>
    page.total === 21 &&
    page.items.length === 21 &&
    page.items.every((n) => n.status === 'DELIVERED'),
);
const publicDependencies =
  await sql`SELECT payload FROM indexed_records WHERE kind='dependency' AND id LIKE 'pep724.listing.%'`;
const projectedNotices =
  await sql`SELECT payload FROM indexed_records WHERE kind='notice' AND payload->'certificate'->>'request_id'='public.pep724.withdrawal'`;
if (publicDependencies.length !== 21 || publicDependencies.some((r) => r.payload.usable))
  throw new Error('A public dependent projection remains usable or is missing');
if (
  projectedNotices.length !== 21 ||
  projectedNotices.some((r) => r.payload.status !== 'DELIVERED')
)
  throw new Error('Delivered notices are not fully projected');
await writeFile(
  'verification/index-rebuild.json',
  JSON.stringify(
    {
      network: 'studionet',
      chain_id: 61999,
      checks,
      public_notices: notices.items.length,
      all_public_notices_delivered: true,
      all_public_dependents_quarantined: true,
      complete: true,
    },
    null,
    2,
  ) + '\n',
);
const operations =
  await sql`SELECT id,kind,status,transaction_hash AS hash,error_code,receipt_checks,created_at,updated_at FROM operations ORDER BY created_at`;
await writeFile(
  'verification/journal-final.json',
  JSON.stringify(
    {
      network: 'studionet',
      chain_id: 61999,
      dispatcher: contracts.dispatcher,
      classification:
        'Preserved historical and current operation journal; signed bytes and account keys omitted',
      operations,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Exact public history, delivered notices, denied dependents and preserved journal verified.',
);
