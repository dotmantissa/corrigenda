import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { TransactionStatus, type TransactionHash } from 'genlayer-js/types';
import type { Hex } from 'viem';
import { chain, executionSucceeded, receiptStatus } from '../../src/lib/server/chain';
export async function transact(
  name: string,
  key: Hex,
  target: Hex,
  method: string,
  args: (string | number | boolean)[],
  expectedSuccess = true,
) {
  await mkdir('verification/receipts', { recursive: true });
  const path = `verification/receipts/${name}.json`;
  let saved;
  try {
    saved = JSON.parse(await readFile(path, 'utf8'));
  } catch {}
  if (saved?.status === 'FINALIZED' && saved.execution) {
    if ((saved.execution === 'SUCCESS') !== expectedSuccess)
      throw new Error(`Unexpected saved result in ${name}`);
    return saved;
  }
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
    retries: 60,
  });
  const success = executionSucceeded(receipt),
    result = {
      hash,
      status: receiptStatus(receipt),
      execution: success ? 'SUCCESS' : 'FAILED',
      consensus_outcome:
        (receipt as unknown as Record<string, unknown>).result_name ?? receipt.result,
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
  for (let i = 0; i < 40; i++) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error('Finalized callback did not arrive; restrictions retained');
}

export async function finalizedCallbacks(name: string, parent: { triggered: string[] }) {
  if (!parent.triggered.length) throw new Error(`${name} did not emit a consumer callback`);
  const results = [];
  for (const [index, hash] of parent.triggered.entries()) {
    const receipt = await chain().waitForTransactionReceipt({
      hash: hash as TransactionHash,
      status: TransactionStatus.FINALIZED,
      interval: 20000,
      retries: 60,
    });
    const result = {
      hash,
      status: receiptStatus(receipt),
      execution: executionSucceeded(receipt) ? 'SUCCESS' : 'FAILED',
      consensus_outcome:
        (receipt as unknown as Record<string, unknown>).result_name ?? receipt.result,
      votes: receipt.consensus_data?.votes,
      leader_receipts: receipt.consensus_data?.leader_receipt,
    };
    await writeFile(
      `verification/receipts/${name}-callback${index}.json`,
      JSON.stringify(result, null, 2) + '\n',
    );
    if (result.status !== 'FINALIZED' || result.execution !== 'SUCCESS')
      throw new Error(`Unexpected callback result in ${name}`);
    results.push(result);
  }
  return results;
}

let networkOffset: number | undefined;
export async function networkTime() {
  if (networkOffset === undefined) {
    const saved = JSON.parse(await readFile('verification/receipts/deploy-registry.json', 'utf8'));
    const receipt = await chain().getTransaction({ hash: saved.hash as TransactionHash });
    const seconds = Number((receipt as unknown as Record<string, unknown>).current_timestamp);
    if (!Number.isSafeInteger(seconds) || seconds <= 0)
      throw new Error('Network clock unavailable');
    networkOffset = seconds - Math.floor(Date.now() / 1000);
  }
  return Math.floor(Date.now() / 1000) + networkOffset;
}
