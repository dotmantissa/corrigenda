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
    page = await indexPage(contract, 5500);
    console.log(contract, page.next, '/', page.total);
  } while (page.next < page.total);
}
console.log('Every committed history page has been projected.');
