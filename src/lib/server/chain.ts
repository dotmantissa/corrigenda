import './network';
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant, type TransactionHash } from 'genlayer-js/types';
import { keccak256, type Hex } from 'viem';
import { canonical } from '../shared/canonical';
import deployments from '../../../deployments/studionet.json';
export const contracts = deployments.contracts as Record<string, `0x${string}`>;
export function chain(key?: Hex, onSigned?: (raw: Hex, hash: Hex) => Promise<void>) {
  const original = key ? createAccount(key) : undefined;
  const account =
    original && onSigned
      ? {
          ...original,
          signTransaction: async (...args: Parameters<typeof original.signTransaction>) => {
            const signed = await original.signTransaction(...args);
            await onSigned(signed, keccak256(signed));
            return signed;
          },
        }
      : original;
  return createClient({ chain: studionet, endpoint: process.env.GENLAYER_RPC_URL, account });
}
export async function read<T>(
  contract: Hex,
  method: string,
  args: (string | number)[] = [],
): Promise<T> {
  return (await chain().readContract({
    address: contract,
    functionName: method,
    args,
    jsonSafeReturn: true,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  })) as T;
}
let networkClock: { seconds: number; observedAt: number } | undefined;
export async function networkTime(): Promise<number> {
  const now = Date.now();
  if (networkClock && now - networkClock.observedAt < 15000)
    return networkClock.seconds + Math.floor((now - networkClock.observedAt) / 1000);
  const transaction = await chain().getTransaction({
    hash: deployments.clock_reference_transaction as TransactionHash,
  });
  const seconds = Number((transaction as unknown as Record<string, unknown>).current_timestamp);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error('Network clock unavailable');
  networkClock = { seconds, observedAt: Date.now() };
  return seconds;
}
export function requestDigest(value: unknown) {
  return canonical(value);
}
export function executionSucceeded(receipt: unknown): boolean {
  if (!receipt || typeof receipt !== 'object') return false;
  const r = receipt as Record<string, unknown>;
  const outcome = r.result_name ?? r.resultName ?? r.result;
  if (typeof outcome === 'number' || /^\d+$/.test(String(outcome))) {
    if (![1, 6].includes(Number(outcome))) return false;
  } else if (
    typeof outcome === 'string' &&
    !['SUCCESS', 'AGREE', 'MAJORITY_AGREE'].includes(outcome)
  ) {
    return false;
  }
  const consensus = r.consensus_data as Record<string, unknown> | undefined;
  const leader = consensus?.leader_receipt;
  const leaders = Array.isArray(leader) ? leader : leader ? [leader] : [];
  // The first receipt is the deciding leader, matching gltest.tx_execution_succeeded.
  // Later entries can be idle participants or prior rounds, and remain in the captured evidence.
  return leaders.length > 0 && leaders[0].execution_result === 'SUCCESS';
}
export function receiptStatus(receipt: unknown): string {
  const status = (receipt as Record<string, unknown>).status;
  const numeric: Record<number, string> = {
    0: 'UNINITIALIZED',
    1: 'PENDING',
    2: 'PROPOSING',
    3: 'COMMITTING',
    4: 'REVEALING',
    5: 'ACCEPTED',
    6: 'UNDETERMINED',
    7: 'FINALIZED',
    8: 'CANCELED',
    9: 'APPEAL_REVEALING',
    10: 'APPEAL_COMMITTING',
    11: 'READY_TO_FINALIZE',
    12: 'VALIDATORS_TIMEOUT',
    13: 'LEADER_TIMEOUT',
  };
  return typeof status === 'number' || /^\d+$/.test(String(status))
    ? (numeric[Number(status)] ?? 'PENDING')
    : String(status);
}
