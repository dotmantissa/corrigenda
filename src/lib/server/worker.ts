import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { type Hex } from 'viem';
import { TransactionStatus, type TransactionHash } from 'genlayer-js/types';
import { db } from './db';
import { decryptKey } from './custody';
import { chain, contracts, executionSucceeded, receiptStatus } from './chain';
import { indexNetwork } from './indexer';
import { scheduleDispatch } from './dispatch';
export async function workerTick(crashAfterBroadcast = false, operationId?: string) {
  const sql = db(),
    leaseId = randomUUID();
  // One worker owns nonce allocation at a time. Expired leases recover a terminated process.
  const lease =
    await sql`INSERT INTO worker_leases(name,lease_id,lease_until) VALUES('signer',${leaseId},now()+interval '90 seconds') ON CONFLICT(name) DO UPDATE SET lease_id=EXCLUDED.lease_id,lease_until=EXCLUDED.lease_until WHERE worker_leases.lease_until<now() RETURNING lease_id`;
  if (!lease.length) return;
  try {
    // One due receipt and one new submission per tick; neither lane can monopolize the signer.
    const pending = await sql`SELECT o.*,i.encrypted_key,i.address FROM operations o
      LEFT JOIN identities i ON i.id=o.identity_id
      WHERE o.id IN (
        SELECT id FROM (
          SELECT candidate.id,row_number() OVER (PARTITION BY (candidate.transaction_hash IS NULL)
            ORDER BY candidate.reconcile_at,candidate.created_at) AS lane_order FROM operations candidate
          WHERE candidate.status IN ('PENDING','SIGNED','SUBMITTED','ACCEPTED','STRANDED')
          AND (${operationId ?? null}::text IS NULL OR candidate.id=${operationId ?? null})
          AND (candidate.lease_until IS NULL OR candidate.lease_until<now()) AND candidate.reconcile_at<=now()
          AND (candidate.transaction_hash IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM operations outstanding WHERE outstanding.transaction_hash IS NOT NULL
            AND outstanding.status IN ('SIGNED','SUBMITTED','STRANDED')
            AND COALESCE(CASE WHEN outstanding.kind='configure_authority' THEN NULL ELSE outstanding.identity_id END,'governance')=
                COALESCE(CASE WHEN candidate.kind='configure_authority' THEN NULL ELSE candidate.identity_id END,'governance')
          ))
        ) lanes WHERE lane_order=1
      ) ORDER BY (o.transaction_hash IS NULL),o.reconcile_at,o.created_at`;
    for (const op of pending) {
      try {
        await sql`UPDATE operations SET lease_until=now()+interval '75 seconds',lease_id=${leaseId} WHERE id=${op.id}`;
        const client = chain(
          !op.identity_id || op.kind === 'configure_authority'
            ? (process.env.GENLAYER_PRIVATE_KEY as Hex)
            : decryptKey(op.encrypted_key),
          async (raw, hash) => {
            // Journal the deterministic hash before broadcast, including the crash window before RPC returns.
            op.transaction_hash = hash;
            op.signed_transaction = raw;
            await sql`UPDATE operations SET status='SIGNED',signed_transaction=${raw},transaction_hash=${hash},updated_at=now() WHERE id=${op.id}`;
          },
        );
        if (!op.transaction_hash) {
          if (op.attempts >= 3) {
            await sql`UPDATE operations SET status='UNRESOLVED',error_code='SIGNING_RETRY_LIMIT',lease_until=NULL,updated_at=now() WHERE id=${op.id}`;
            continue;
          }
          await sql`UPDATE operations SET attempts=attempts+1 WHERE id=${op.id}`;
          if (op.kind === 'deploy_consumers') {
            const payload = op.payload;
            const role = payload.role ?? 'listing';
            const file = role === 'listing' ? 'listing_consumer' : 'deployment_consumer';
            const hash = await client.deployContract({
              code: new TextEncoder().encode(await readFile(`contracts/${file}.py`, 'utf8')),
              args: [op.address, contracts.dispatcher],
            });
            op.transaction_hash = hash;
          } else {
            op.transaction_hash = await client.writeContract({
              address: op.target,
              functionName: op.method,
              args: op.args,
              value: 0n,
            });
          }
          if (crashAfterBroadcast) process.kill(process.pid, 'SIGKILL');
          await sql`UPDATE operations SET status='SUBMITTED',transaction_hash=${op.transaction_hash},updated_at=now() WHERE id=${op.id}`;
        } else if (['SIGNED', 'STRANDED'].includes(op.status) && op.signed_transaction) {
          try {
            await client.sendRawTransaction({ serializedTransaction: op.signed_transaction });
          } catch {
            /* An already known identical transaction is reconciled below. */
          }
        }
        let receipt;
        try {
          receipt = await client.getTransaction({ hash: op.transaction_hash as TransactionHash });
        } catch {
          receipt = null;
        }
        if (receipt) {
          const status = receiptStatus(receipt),
            success = executionSucceeded(receipt);
          if (status === 'CANCELED') {
            await sql`UPDATE operations SET status='DELIVERY_FAILED',error_code='TRANSACTION_CANCELED',lease_until=NULL,updated_at=now() WHERE id=${op.id}`;
          } else if (status === 'FINALIZED') {
            const finalStatus = success ? 'FINALIZED' : 'DELIVERY_FAILED';
            const captured = {
              hash: receipt.hash,
              status,
              execution: success ? 'SUCCESS' : 'FAILED',
              consensus_outcome:
                (receipt as unknown as Record<string, unknown>).result_name ?? receipt.result,
              votes: receipt.consensus_data?.votes,
            };
            await sql`UPDATE operations SET status=${finalStatus},receipt=${JSON.stringify(captured)},error_code=${success ? null : 'CONTRACT_EXECUTION_FAILED'},lease_until=NULL,updated_at=now() WHERE id=${op.id}`;
            if (success && op.kind === 'deploy_consumers') {
              if (op.payload.role === 'deployment')
                await sql`UPDATE identities SET deployment_consumer=${receipt.to_address} WHERE id=${op.identity_id}`;
              else {
                await sql`UPDATE identities SET listing_consumer=${receipt.to_address} WHERE id=${op.identity_id}`;
                await sql`INSERT INTO operations(id,identity_id,kind,payload,payload_digest) VALUES(${op.id + '.deployment'},${op.identity_id},'deploy_consumers',${JSON.stringify({ ...op.payload, role: 'deployment' })},${op.payload_digest + '.deployment'}) ON CONFLICT(id) DO NOTHING`;
              }
            }
            if (success && ['register_dependency', 'assess_impact'].includes(op.kind)) {
              await sql`INSERT INTO usage_ledger(operation_id,identity_id,unit,quantity) VALUES(${op.id},${op.identity_id},${op.kind === 'register_dependency' ? 'registered_dependency' : 'bounded_assessment'},1) ON CONFLICT(operation_id) DO NOTHING`;
            }
          } else {
            const checks = Number(op.receipt_checks ?? 0) + 1;
            const stranded = checks >= 30;
            await sql`UPDATE operations SET status=${stranded ? 'STRANDED' : status === 'ACCEPTED' ? 'ACCEPTED' : 'SUBMITTED'},error_code=${stranded ? 'RECEIPT_STRANDED' : null},receipt_checks=receipt_checks+1,reconcile_at=now()+${Math.min(900, 30 * 2 ** Math.min(checks, 5))}*interval '1 second',lease_until=NULL,updated_at=now() WHERE id=${op.id}`;
          }
        } else {
          const checks = Number(op.receipt_checks ?? 0) + 1;
          await sql`UPDATE operations SET status=${checks >= 30 ? 'STRANDED' : op.status === 'SIGNED' ? 'SIGNED' : 'SUBMITTED'},error_code='RECEIPT_MISSING',receipt_checks=receipt_checks+1,reconcile_at=now()+${Math.min(900, 30 * 2 ** Math.min(checks, 5))}*interval '1 second',lease_until=NULL,updated_at=now() WHERE id=${op.id}`;
        }
      } catch {
        // The journaled hash survives transport errors; recovery never allocates a replacement signature.
        await sql`UPDATE operations SET error_code='TRANSPORT_RETRY',reconcile_at=now()+interval '60 seconds',lease_until=NULL,updated_at=now() WHERE id=${op.id}`;
      }
    }
    await indexNetwork();
    await scheduleDispatch();
  } finally {
    // A shared cooldown bounds RPC bursts across persistent workers and authenticated HTTP wakeups.
    await sql`UPDATE worker_leases SET lease_until=now()+interval '20 seconds' WHERE name='signer' AND lease_id=${leaseId}`;
  }
}
export async function waitFinalized(hash: Hex) {
  const result = await chain().waitForTransactionReceipt({
    hash: hash as TransactionHash,
    status: TransactionStatus.FINALIZED,
    interval: 12000,
    retries: 20,
  });
  if (!executionSucceeded(result)) throw new Error('Contract execution failed');
  return result;
}
