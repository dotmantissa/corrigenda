import { readFile, writeFile, readdir } from 'node:fs/promises';
import { chain, receiptStatus, executionSucceeded } from '../src/lib/server/chain';
import type { TransactionHash } from 'genlayer-js/types';
const root = 'verification/receipts';
for (const file of await readdir(root)) {
  const path = `${root}/${file}`,
    saved = JSON.parse(await readFile(path, 'utf8'));
  if (!saved.hash) continue;
  const receipt = await chain().getTransaction({ hash: saved.hash as TransactionHash });
  saved.status = receiptStatus(receipt);
  saved.execution = executionSucceeded(receipt) ? 'SUCCESS' : 'FAILED';
  saved.votes = receipt.consensus_data?.votes;
  await writeFile(path, JSON.stringify(saved, null, 2) + '\n');
  console.log(file, saved.status, saved.execution);
  await new Promise((resolve) => setTimeout(resolve, 1200));
}
