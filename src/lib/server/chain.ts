import './network';
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
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
  })) as T;
}
export function requestDigest(value: unknown) {
  return canonical(value);
}
export function executionSucceeded(receipt: unknown): boolean {
  if (!receipt || typeof receipt !== 'object') return false;
  const r = receipt as Record<string, unknown>;
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
