import { readFile, writeFile, readdir } from 'node:fs/promises';
import { chain } from '../src/lib/server/chain';
import type { TransactionHash } from 'genlayer-js/types';
const rows = [];
for (const name of (await readdir('verification/receipts')).filter(
  (n) => n.includes('assess') && !n.includes('deploy'),
)) {
  const saved = JSON.parse(await readFile('verification/receipts/' + name, 'utf8'));
  if (!saved.hash) continue;
  const receipt = await chain().getTransaction({ hash: saved.hash as TransactionHash });
  const entries = receipt.consensus_data?.leader_receipt;
  for (const r of Array.isArray(entries) ? entries : entries ? [entries] : []) {
    const row = r as unknown as Record<string, unknown>;
    rows.push({
      file: name,
      hash: saved.hash,
      mode: row.mode,
      vote: row.vote,
      gas_used: row.gas_used,
      processing_time: row.processing_time,
      execution_result: row.execution_result,
      execution_stats: row.execution_stats,
    });
  }
}
await writeFile(
  'verification/resource-profile.json',
  JSON.stringify(
    {
      network: 'studionet',
      chain_id: 61999,
      observations: rows,
      unit_note:
        'Processing time and execution statistics are reported as supplied by Studio. These are measurements, not promised ceilings.',
    },
    null,
    2,
  ) + '\n',
);
console.log('Captured participant runtime measurements', rows.length);
