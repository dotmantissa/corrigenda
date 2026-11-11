import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chain, contracts, read, executionSucceeded, receiptStatus } from '../src/lib/server/chain';
import { TransactionStatus, type TransactionHash } from 'genlayer-js/types';
import type { Hex } from 'viem';
import { transact } from './lib/studio';
const client = chain(process.env.GENLAYER_PRIVATE_KEY as Hex),
  file = 'verification/receipts/assessment-probe-deploy.json';
let saved;
try {
  saved = JSON.parse(await readFile(file, 'utf8'));
} catch {}
const code = await readFile('contracts/assessment_probe.py', 'utf8'),
  hash =
    saved?.hash ??
    (await client.deployContract({
      code: new TextEncoder().encode(code),
      args: [contracts.court],
    }));
await writeFile(file, JSON.stringify({ hash, status: 'SUBMITTED' }));
console.log('Assessment probe broadcast', hash);
const receipt = await client.waitForTransactionReceipt({
  hash: hash as TransactionHash,
  status: TransactionStatus.FINALIZED,
  interval: 12000,
  retries: 25,
});
if (!executionSucceeded(receipt)) throw new Error('Probe deployment failed');
const address = receipt.to_address as Hex;
await writeFile(
  file,
  JSON.stringify(
    {
      hash,
      address,
      status: receiptStatus(receipt),
      source_digest: createHash('sha256').update(code).digest('hex'),
    },
    null,
    2,
  ),
);
await transact('assessment-probe', process.env.GENLAYER_PRIVATE_KEY as Hex, address, 'assess', [
  'public.pep724.withdrawal',
]);
console.log(
  'Independent public probe result',
  JSON.stringify(await read(address, 'get_result', ['public.pep724.withdrawal'])),
);
