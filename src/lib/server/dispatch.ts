import { createHash } from 'node:crypto';
import { db } from './db';
import { contracts, read } from './chain';
/** Scheduling is deterministic. It cannot supply a semantic certificate or change consumer ownership. */
export async function scheduleDispatch() {
  const sql = db();
  const rows =
    await sql`SELECT payload FROM indexed_records WHERE kind='incident' AND payload->>'status' IN ('ASSESSED','UNRESOLVED','TIMEOUT') AND COALESCE((payload->>'dispatch_complete')::boolean,false)=false ORDER BY updated_at ASC LIMIT 4`;
  let remainingReads = 3;
  for (const row of rows) {
    const done = new Set<string>(row.payload.dispatch_done ?? []);
    for (const proposition of row.payload.propositions) {
      if (done.has(proposition.id)) continue;
      if (remainingReads === 0) return;
      remainingReads--;
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
      const operationId = `dispatch.${createHash('sha256').update(`${contracts.dispatcher.toLowerCase()}/${row.payload.request_id}/${proposition.id}/${page.cursor}`).digest('hex')}`;
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
