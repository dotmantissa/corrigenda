import { contracts, read } from './chain';
import { db } from './db';
import type {
  Incident,
  Dependency,
  Revision,
  Snapshot,
  TimelineEvent,
  Operation,
} from '../shared/schema';

export async function refreshRecord(
  kind: string,
  id: string,
  contract: string,
  method: string,
  args: (string | number)[] = [id],
) {
  const payload = await read(contract as `0x${string}`, method, args);
  const sql = db();
  await sql`INSERT INTO indexed_records(kind,id,payload) VALUES(${kind},${id},${JSON.stringify(payload)}) ON CONFLICT(kind,id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`;
}

export async function projectEvent(event: Record<string, unknown>) {
  if (event.event === 'REVISION_REGISTERED')
    await refreshRecord('revision', String(event.revision_id), contracts.registry, 'get_revision');
  if (event.event === 'POLICY_REGISTERED')
    await refreshRecord(
      'policy',
      `${event.policy_id}:${event.revision}`,
      contracts.registry,
      'get_policy',
      [String(event.policy_id), Number(event.revision)],
    );
  if (
    event.request_id &&
    [
      'CORRECTION_OPENED',
      'IMPACT_ASSESSED',
      'TIMEOUT',
      'CERTIFICATE_FINALIZED',
      'REQUEST_SUPERSEDED',
    ].includes(String(event.event))
  )
    await refreshRecord('incident', String(event.request_id), contracts.court, 'get_request');
  if (event.dependency_id)
    await refreshRecord(
      'dependency',
      String(event.dependency_id),
      contracts.dispatcher,
      'get_dependency',
    );
  if (event.event === 'PAGE_BROADCAST') {
    const page = await read<{ items: Snapshot['notices'] }>(
      contracts.dispatcher,
      'get_delivery_page',
      [String(event.request_id), String(event.proposition_id), Number(event.from), 20],
    );
    const sql = db();
    for (const notice of page.items)
      await sql`INSERT INTO indexed_records(kind,id,payload) VALUES('notice',${notice.operation_id},${JSON.stringify(notice)}) ON CONFLICT(kind,id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`;
  }
  if (event.event === 'NOTICE_DELIVERED')
    await refreshRecord('notice', String(event.operation_id), contracts.dispatcher, 'get_notice');
  if (event.event === 'ACKNOWLEDGED')
    await refreshRecord('notice', String(event.notice_id), contracts.dispatcher, 'get_notice');
}

export async function indexPage(contract: string, pauseBetweenRecordsMs = 0) {
  const sql = db(),
    cursors = await sql`SELECT cursor FROM index_cursors WHERE contract=${contract}`;
  const cursor = Number(cursors[0]?.cursor ?? 0);
  const page = await read<{ items: Record<string, unknown>[]; next: number; total: number }>(
    contract as `0x${string}`,
    'get_history',
    [cursor, 20],
  );
  if (page.next < cursor || page.next !== Math.min(cursor + page.items.length, page.total))
    throw new Error('Invalid history cursor');
  for (let i = 0; i < page.items.length; i++) {
    await sql`INSERT INTO chain_events(contract,sequence,payload) VALUES(${contract},${cursor + i},${JSON.stringify(page.items[i])}) ON CONFLICT(contract,sequence) DO UPDATE SET payload=EXCLUDED.payload`;
    // Commit the cursor only after every event and its projection are durable. A failed page is replayed in full.
    await projectEvent(page.items[i]);
    if (pauseBetweenRecordsMs)
      await new Promise((resolve) => setTimeout(resolve, pauseBetweenRecordsMs));
  }
  await sql`INSERT INTO index_cursors(contract,cursor) VALUES(${contract},${page.next}) ON CONFLICT(contract) DO UPDATE SET cursor=EXCLUDED.cursor,updated_at=now()`;
  return { ...page, contract };
}

export async function indexNetwork() {
  if (!contracts.registry) return { complete: true };
  const sql = db(),
    cursors = await sql`SELECT contract FROM index_cursors ORDER BY updated_at ASC`;
  const known = [contracts.registry, contracts.court, contracts.dispatcher];
  const contract =
    known.find((c) => !cursors.some((x) => x.contract === c)) ??
    cursors.find((x) => known.includes(x.contract))?.contract ??
    known[0];
  const page = await indexPage(contract);
  const stale =
    await sql`SELECT id FROM indexed_records WHERE kind='dependency' ORDER BY updated_at ASC LIMIT 2`;
  for (const row of stale)
    await refreshRecord('dependency', row.id, contracts.dispatcher, 'get_dependency');
  return { complete: page.next === page.total, contract, cursor: page.next, total: page.total };
}

export async function snapshot(identityId?: string): Promise<Snapshot> {
  const sql = db(),
    rows =
      await sql`SELECT kind,payload,updated_at FROM indexed_records ORDER BY updated_at DESC LIMIT 500`;
  const events =
    await sql`SELECT contract,sequence,payload FROM chain_events ORDER BY sequence DESC LIMIT 100`;
  const ops = identityId
    ? await sql`SELECT id,kind,status,transaction_hash AS hash,created_at,error_code AS error FROM operations WHERE identity_id=${identityId} ORDER BY created_at DESC LIMIT 50`
    : [];
  const users = identityId
    ? await sql`SELECT address,listing_consumer,deployment_consumer FROM identities WHERE id=${identityId}`
    : [];
  const incidents = rows
    .filter((x) => x.kind === 'incident')
    .map((x) => {
      const incident = { ...x.payload } as Incident;
      // The court represents a pending certificate as {}. Expose absence until a decision vector exists.
      if (!Array.isArray(incident.certificate?.decisions)) delete incident.certificate;
      return incident;
    });
  for (const incident of incidents) {
    if (incident.status === 'ASSESSED') {
      try {
        const cert = await read<{ status: string }>(contracts.dispatcher, 'get_certificate', [
          incident.request_id,
        ]);
        if (cert.status === 'FINALIZED') incident.status = 'FINALIZED';
      } catch {
        /* An assessed result is still waiting for its authenticated callback. */
      }
    }
  }
  return {
    network: 'GenLayer Studio',
    chain_id: 61999,
    updated_at: rows[0]?.updated_at ? new Date(rows[0].updated_at).toISOString() : null,
    incidents,
    dependencies: rows.filter((x) => x.kind === 'dependency').map((x) => x.payload as Dependency),
    revisions: rows.filter((x) => x.kind === 'revision').map((x) => x.payload as Revision),
    timeline: events.map(
      (x) =>
        ({ ...x.payload, contract: x.contract, sequence: Number(x.sequence) }) as TimelineEvent,
    ),
    operations: ops as Operation[],
    notices: rows.filter((x) => x.kind === 'notice').map((x) => x.payload),
    contracts,
    connection: 'connected',
    user: users[0] as Snapshot['user'],
  };
}
