import { readFile, writeFile, readdir } from 'node:fs/promises';
import { chain } from '../src/lib/server/chain';
import type { TransactionHash } from 'genlayer-js/types';
const rows = [];
const transactions = [];
for (const name of (await readdir('verification/receipts')).filter(
  (n) => n.includes('assess') && !n.includes('deploy'),
)) {
  const saved = JSON.parse(await readFile('verification/receipts/' + name, 'utf8'));
  if (!saved.hash) continue;
  const receipt = await chain().getTransaction({ hash: saved.hash as TransactionHash });
  const raw = receipt as unknown as Record<string, unknown>;
  const created = Number(raw.created_timestamp),
    lastVote = Number(raw.last_vote_timestamp);
  transactions.push({
    file: name,
    hash: saved.hash,
    created_at: raw.created_at ?? null,
    created_timestamp: Number.isSafeInteger(created) && created > 0 ? created : null,
    last_vote_timestamp: Number.isSafeInteger(lastVote) && lastVote > 0 ? lastVote : null,
    creation_to_last_vote_seconds:
      Number.isSafeInteger(created) &&
      created > 0 &&
      Number.isSafeInteger(lastVote) &&
      lastVote >= created
        ? lastVote - created
        : null,
  });
  const entries = receipt.consensus_data?.leader_receipt;
  for (const r of Array.isArray(entries) ? entries : entries ? [entries] : []) {
    const row = r as unknown as Record<string, unknown>;
    rows.push({
      file: name,
      hash: saved.hash,
      mode: row.mode,
      vote: row.vote,
      gas_used: row.gas_used ?? null,
      processing_time: row.processing_time ?? null,
      execution_result: row.execution_result,
      execution_stats: row.execution_stats ?? null,
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
      transactions,
      reported_participant_metrics: {
        gas_used: rows.filter((r) => r.gas_used !== null).length,
        processing_time: rows.filter((r) => r.processing_time !== null).length,
        execution_stats: rows.filter((r) => r.execution_stats !== null).length,
      },
      unit_note:
        'Participant metrics are retained only as supplied by Studio; null means unavailable. Transaction timing is measured between Studio creation and its last vote, not model CPU time. No CPU, memory or gas usage is inferred from missing fields or gas limits. Observations are not promised ceilings.',
    },
    null,
    2,
  ) + '\n',
);
console.log('Captured participant runtime measurements', rows.length);
