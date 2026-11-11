import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { TransactionStatus, type TransactionHash } from 'genlayer-js/types';
import type { Hex } from 'viem';
import { chain, executionSucceeded, receiptStatus } from '../../src/lib/server/chain';
export async function transact(
  name: string,
  key: Hex,
  target: Hex,
  method: string,
  args: (string | number)[],
  expectedSuccess = true,
) {
  await mkdir('verification/receipts', { recursive: true });
  const path = `verification/receipts/${name}.json`;
  let saved;
  try {
    saved = JSON.parse(await readFile(path, 'utf8'));
  } catch {}
  const client = chain(key),
    hash =
      saved?.hash ??
      (await client.writeContract({ address: target, functionName: method, args, value: 0n }));
  await writeFile(path, JSON.stringify({ hash, status: 'SUBMITTED' }, null, 2));
  console.log(name, 'broadcast', hash);
  const receipt = await client.waitForTransactionReceipt({
    hash: hash as TransactionHash,
    status: TransactionStatus.FINALIZED,
    interval: 20000,
    retries: 25,
  });
  const success = executionSucceeded(receipt),
    result = {
      hash,
      status: receiptStatus(receipt),
      execution: success ? 'SUCCESS' : 'FAILED',
      votes: receipt.consensus_data?.votes,
      leader_receipts: receipt.consensus_data?.leader_receipt,
      triggered: await client.getTriggeredTransactionIds({ hash: hash as TransactionHash }),
    };
  await writeFile(path, JSON.stringify(result, null, 2) + '\n');
  if (result.status !== 'FINALIZED' || success !== expectedSuccess)
    throw new Error(`Unexpected result in ${name}`);
  return result;
}
export async function waitUntil<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean = () => true,
): Promise<T> {
  for (let i = 0; i < 12; i++) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error('Finalized callback did not arrive; restrictions retained');
}
