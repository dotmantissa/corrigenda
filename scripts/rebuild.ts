import { db } from '../src/lib/server/db';
import { contracts } from '../src/lib/server/chain';
import { indexPage } from '../src/lib/server/indexer';
const sql = db();
if (!process.argv.includes('--resume')) {
  await sql.transaction([
    sql`DELETE FROM indexed_records`,
    sql`DELETE FROM chain_events`,
    sql`DELETE FROM index_cursors`,
  ]);
}
console.log(
  'Rebuilding public projections from durable cursors. Signed operations and account keys are retained.',
);
for (const contract of [contracts.registry, contracts.court, contracts.dispatcher]) {
  let page;
  do {
    for (let attempt = 0; ; attempt++) {
      try {
        // Leave room for both the observed minute and hourly RPC budgets.
        page = await indexPage(contract, 15000);
        break;
      } catch (error) {
        const quota = String(error).includes('Rate limit exceeded');
        const transport = /fetch failed|ECONNRESET|ETIMEDOUT/.test(String(error));
        if (attempt >= 3 || (!quota && !transport)) throw error;
        const retryAfter = Number(
          (error as { cause?: { data?: { retry_after_seconds?: number } } }).cause?.data
            ?.retry_after_seconds ?? (quota ? 60 : 5),
        );
        const minimum = quota ? 60000 : 5000;
        const delay = Math.max(minimum, Number.isFinite(retryAfter) ? retryAfter * 1000 : minimum);
        console.log(
          'Index transport interrupted; preserving cursor and retrying after',
          delay / 1000,
          'seconds',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    console.log(contract, page.next, '/', page.total);
  } while (page.next < page.total);
}
console.log('Every committed history page has been projected.');
