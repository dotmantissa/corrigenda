import { createHash } from 'node:crypto';
import { db } from './db';
import { contracts, read } from './chain';
/** Scheduling is deterministic. It cannot supply a semantic certificate or change consumer ownership. */
export async function scheduleDispatch() {
  const sql = db();
  const rows =
    await sql`SELECT payload FROM indexed_records WHERE kind='incident' AND payload->>'status' IN ('ASSESSED','UNRESOLVED','TIMEOUT') ORDER BY updated_at ASC LIMIT 4`;
  let remainingReads = 3;
  for (const row of rows) {
    const done = new Set<string>(row.payload.dispatch_done ?? []);
    const propositions = row.payload.propositions;
    const start = Number(row.payload.dispatch_scan ?? 0) % propositions.length;
    for (let step = 0; step < propositions.length; step++) {
      const proposition = propositions[(start + step) % propositions.length];
      if (remainingReads === 0) return;
      remainingReads--;
      row.payload.dispatch_scan = (start + step + 1) % propositions.length;
      await sql`UPDATE indexed_records SET payload=${JSON.stringify(row.payload)},updated_at=now() WHERE kind='incident' AND id=${row.payload.request_id}`;
      let page;
      try {
        page = await read<{ cursor: number; total: number }>(contracts.dispatcher, 'get_dispatch', [
          row.payload.request_id,
          proposition.id,
        ]);
      } catch {
        continue;
      }
      if (page.cursor >= page.total) {
        done.add(proposition.id);
        row.payload.dispatch_done = [...done];
        row.payload.dispatch_complete = done.size === row.payload.propositions.length;
        await sql`UPDATE indexed_records SET payload=${JSON.stringify(row.payload)} WHERE kind='incident' AND id=${row.payload.request_id}`;
        continue;
      }
      done.delete(proposition.id);
      row.payload.dispatch_done = [...done];
      row.payload.dispatch_complete = false;
      await sql`UPDATE indexed_records SET payload=${JSON.stringify(row.payload)} WHERE kind='incident' AND id=${row.payload.request_id}`;
      const operationId = `dispatch.${createHash('sha256')
        .update(
          JSON.stringify([
            'dispatch.v2',
            contracts.dispatcher.toLowerCase(),
            row.payload.request_id,
            proposition.id,
            page.cursor,
          ]),
        )
        .digest('hex')}`;
      const payload = {
        kind: 'dispatch_page',
        request_id: row.payload.request_id,
        proposition_id: proposition.id,
        cursor: page.cursor,
        operation_id: operationId,
      };
      await sql`INSERT INTO operations(id,kind,payload,payload_digest,target,method,args) VALUES(${operationId},'dispatch_page',${JSON.stringify(payload)},${createHash('sha256').update(JSON.stringify(payload)).digest('hex')},${contracts.dispatcher},'dispatch_page',${JSON.stringify([row.payload.request_id, proposition.id, page.cursor, operationId])}) ON CONFLICT(id) DO NOTHING`;
      return;
    }
  }
}
