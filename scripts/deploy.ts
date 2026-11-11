import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chain, executionSucceeded, receiptStatus } from '../src/lib/server/chain';
import { TransactionStatus, type TransactionHash } from 'genlayer-js/types';
import { type Hex } from 'viem';
import { transact } from './lib/studio';
const client = chain(process.env.GENLAYER_PRIVATE_KEY as Hex);
const manifest = JSON.parse(await readFile('deployments/studionet.json', 'utf8'));
await mkdir('verification/receipts', { recursive: true });
async function submit(name: string, code: string, args: string[]) {
  const file = `verification/receipts/deploy-${name}.json`;
  let saved:
    | { hash: Hex; address?: Hex; status?: string; source_digest?: string; args?: string[] }
    | undefined;
  try {
    saved = JSON.parse(await readFile(file, 'utf8'));
  } catch {}
  const sourceDigest = createHash('sha256').update(code).digest('hex');
  if (saved?.source_digest && saved.source_digest !== sourceDigest)
    throw new Error(`Archive the historical ${name} receipt before deploying changed source.`);
  if (saved?.args && JSON.stringify(saved.args) !== JSON.stringify(args))
    throw new Error(`The saved ${name} constructor belongs to a different deployment.`);
  const hash =
    saved?.hash ?? (await client.deployContract({ code: new TextEncoder().encode(code), args }));
  await writeFile(
    file,
    JSON.stringify({ hash, status: 'SUBMITTED', source_digest: sourceDigest, args }, null, 2),
  );
  console.log(name, 'submitted', hash);
  const receipt = await client.waitForTransactionReceipt({
    hash: hash as TransactionHash,
    status: TransactionStatus.FINALIZED,
    interval: 20000,
    retries: 60,
  });
  const address = receipt.to_address as Hex;
  if (!executionSucceeded(receipt)) {
    await writeFile(
      file,
      JSON.stringify(
        {
          hash,
          status: receiptStatus(receipt),
          execution: 'FAILED',
          result: receipt.consensus_data?.leader_receipt,
        },
        null,
        2,
      ),
    );
    throw new Error(`Contract execution failed for ${name}`);
  }
  await writeFile(
    file,
    JSON.stringify(
      {
        hash,
        address,
        status: receiptStatus(receipt),
        execution: 'SUCCESS',
        source_digest: sourceDigest,
        args,
        votes: receipt.consensus_data?.votes,
      },
      null,
      2,
    ),
  );
  manifest.contracts[name] = address;
  await writeFile('deployments/studionet.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(name, 'deployed', address);
  return address;
}
for (const [name, file, args] of [
  ['registry', 'revision_registry', []],
  ['court', 'impact_court', [manifest.contracts.registry]],
  ['dispatcher', 'dependency_dispatcher', [manifest.contracts.court, manifest.contracts.registry]],
] as [string, string, string[]][]) {
  // Constructor addresses depend on completed predecessor deployments.
  if (manifest.contracts[name]) continue;
  const actual =
    name === 'court'
      ? [manifest.contracts.registry]
      : name === 'dispatcher'
        ? [manifest.contracts.court, manifest.contracts.registry]
        : args;
  await submit(name, await readFile(`contracts/${file}.py`, 'utf8'), actual);
}
for (const [target, method, arg] of [
  ['registry', 'bind_court', manifest.contracts.court],
  ['court', 'bind_dispatcher', manifest.contracts.dispatcher],
]) {
  await transact(
    method,
    process.env.GENLAYER_PRIVATE_KEY as Hex,
    manifest.contracts[target],
    method,
    [arg],
  );
}
console.log('Registry, court and dispatcher bound.');
