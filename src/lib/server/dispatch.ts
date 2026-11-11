import { createHash } from 'node:crypto';
import { db } from './db';
import { contracts, read } from './chain';
/** Scheduling is deterministic. It cannot supply a semantic certificate or change consumer ownership. */
export async function scheduleDispatch() {
  const sql = db();
  const rows =
    await sql`SELECT payload FROM indexed_records WHERE kind='incident' AND payload->>'status' IN ('ASSESSED','UNRESOLVED') ORDER BY updated_at ASC LIMIT 4`;
  for (const row of rows)
    for (const proposition of row.payload.propositions) {
      let page;
      try {
        page = await read<{ cursor: number; total: number }>(contracts.dispatcher, 'get_dispatch', [
          row.payload.request_id,
          proposition.id,
        ]);
      } catch {
        continue;
      }
      if (page.cursor >= page.total) continue;
      const operationId = `dispatch.${createHash('sha256').update(`${row.payload.request_id}/${proposition.id}/${page.cursor}`).digest('hex')}`;
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
