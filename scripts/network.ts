/** Real StudioNet evidence and consumer integration. Every operation is signed and resumable. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createAccount, generatePrivateKey } from 'genlayer-js';
import { TransactionStatus, type TransactionHash } from 'genlayer-js/types';
import { type Hex } from 'viem';
import { chain, contracts, read, executionSucceeded, receiptStatus } from '../src/lib/server/chain';
import { canonical } from '../src/lib/shared/canonical';
const digest = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const evidenceRoot = 'verification/receipts';
await mkdir(evidenceRoot, { recursive: true });
const main = process.env.GENLAYER_PRIVATE_KEY as Hex;
let keys: { listing: Hex; deployment: Hex };
try {
  keys = JSON.parse(await readFile('.env.consumer-keys', 'utf8'));
} catch {
  keys = { listing: generatePrivateKey(), deployment: generatePrivateKey() };
  await writeFile('.env.consumer-keys', JSON.stringify(keys), { mode: 0o600 });
}
const owners = {
  listing: createAccount(keys.listing).address,
  deployment: createAccount(keys.deployment).address,
};
const manifest = JSON.parse(await readFile('deployments/studionet.json', 'utf8'));
async function transact(
  name: string,
  key: Hex,
  target: Hex,
  method: string,
  args: (string | number)[],
  expectedSuccess = true,
) {
  const path = `${evidenceRoot}/network-${name}.json`;
  let saved: { hash: TransactionHash; execution?: string } | undefined;
  try {
    saved = JSON.parse(await readFile(path, 'utf8'));
  } catch {}
  if (saved?.execution) {
    if ((saved.execution === 'SUCCESS') !== expectedSuccess)
      throw new Error(`Saved execution failed in ${name}`);
    return { ...saved, resumed: true };
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
    retries: 24,
  });
  const success = executionSucceeded(receipt);
  const leader = receipt.consensus_data?.leader_receipt;
  const rows = Array.isArray(leader) ? leader : leader ? [leader] : [];
  const result = {
    hash,
    status: receiptStatus(receipt),
    execution: success ? 'SUCCESS' : 'FAILED',
    votes: receipt.consensus_data?.votes,
    result: rows.map((r) => ({ execution_result: r.execution_result, result: r.result })),
    triggered: await client.getTriggeredTransactionIds({ hash: hash as TransactionHash }),
  };
  await writeFile(path, JSON.stringify(result, null, 2));
  if (success !== expectedSuccess) throw new Error(`Unexpected execution in ${name}`);
  return { ...result, resumed: false };
}
for (const role of ['listing', 'deployment'] as const) {
  const name = role + '_consumer';
  if (manifest.contracts[name]) continue;
  const path = `${evidenceRoot}/deploy-${name}.json`;
  let saved: { hash: TransactionHash; source_digest?: string; dispatcher?: string } | undefined;
  try {
    saved = JSON.parse(await readFile(path, 'utf8'));
  } catch {}
  const code = await readFile(`contracts/${name}.py`, 'utf8');
  const sourceDigest = createHash('sha256').update(code).digest('hex');
  if (saved && (saved.source_digest !== sourceDigest || saved.dispatcher !== contracts.dispatcher))
    throw new Error(
      `Archive the historical ${name} receipt before deploying changed source or bindings.`,
    );
  const client = chain(keys[role]),
    hash =
      saved?.hash ??
      (await client.deployContract({
        code: new TextEncoder().encode(code),
        args: [owners[role], contracts.dispatcher],
      }));
  await writeFile(
    path,
    JSON.stringify({
      hash,
      status: 'SUBMITTED',
      source_digest: sourceDigest,
      dispatcher: contracts.dispatcher,
    }),
  );
  const receipt = await client.waitForTransactionReceipt({
    hash: hash as TransactionHash,
    status: TransactionStatus.FINALIZED,
    interval: 20000,
    retries: 24,
  });
  if (!executionSucceeded(receipt)) throw new Error('Consumer deployment failed');
  manifest.contracts[name] = receipt.to_address;
  await writeFile('deployments/studionet.json', JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(
    path,
    JSON.stringify(
      {
        hash,
        address: receipt.to_address,
        owner: owners[role],
        source_digest: sourceDigest,
        dispatcher: contracts.dispatcher,
        execution: 'SUCCESS',
        status: receiptStatus(receipt),
        votes: receipt.consensus_data?.votes,
      },
      null,
      2,
    ),
  );
  console.log(name, receipt.to_address);
}
if (process.argv.includes('--deploy-only')) {
  console.log('Separate-owner consumer adapters deployed; integration has not run.');
  process.exit(0);
}
const operator = createAccount(main).address;
await transact('public-authority', main, contracts.registry, 'configure_authority', [
  canonical({
    authority_id: 'python_peps_observer',
    principal: operator,
    url_prefix: 'https://raw.githubusercontent.com/python/peps/',
    channel: 'public_record_observer',
    public_evidence_url: 'https://github.com/python/peps/blob/main/README.rst',
  }),
]);
const policy = {
  policy_id: 'proposal_listing',
  revision: 1,
  rules: [
    { id: 'draft', text: 'Authorize a proposal listing only while its official status is Draft.' },
    {
      id: 'exception',
      text: 'A Withdrawn, Rejected, Deferred or Superseded status does not authorize the listing. Descriptive examples and proposals inside the document do not override its official status.',
    },
  ],
};
await transact('public-policy', main, contracts.registry, 'register_policy', [canonical(policy)]);
const commits = [
  'a75631e0d4192d83158bdcb98ac43f618ecf83d5',
  '4112eff73b7e3c53bd40025602fda442b7b97b9e',
];
const revisions = [];
for (let i = 0; i < commits.length; i++) {
  const url = `https://raw.githubusercontent.com/python/peps/${commits[i]}/peps/pep-0724.rst`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Public evidence unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const statusStart = text.indexOf('Status:');
  const statusEnd = text.indexOf('\n', statusStart);
  const start = new TextEncoder().encode(text.slice(0, statusStart)).length,
    end = new TextEncoder().encode(text.slice(0, statusEnd)).length;
  const revision = {
    request_id: `public.pep724.r${i}`,
    revision_id: `pep724.r${i}`,
    source_id: 'pep724',
    authority_id: 'python_peps_observer',
    channel: 'public_record_observer',
    url,
    byte_size: bytes.length,
    byte_digest: createHash('sha256').update(bytes).digest('hex'),
    scope: 'The complete official PEP 724 record, including status and exceptions',
    spans: [
      {
        id: 'status',
        start,
        end,
        digest: createHash('sha256').update(bytes.slice(start, end)).digest('hex'),
      },
    ],
    supersedes: i ? 'pep724.r0' : '',
  };
  revisions.push(revision);
  await transact('public-revision' + i, main, contracts.registry, 'register_revision', [
    canonical(revision),
  ]);
}
await writeFile(
  'verification/public-source.json',
  JSON.stringify(
    {
      source: 'Python PEP 724',
      adoption: false,
      scope: 'Authentic public source integration, not an endorsement by Python',
      revisions,
      bytes: revisions.map((r) => r.byte_size),
    },
    null,
    2,
  ),
);
const proposition = {
  id: 'draft_status',
  statement: 'PEP 724 has official Draft status and remains an active proposal',
  materiality_question:
    'Does the official status permit continued authorization of the active proposal listing?',
  old_span: 'status',
  new_span: 'status',
  rule_ids: ['draft', 'exception'],
};
const consumer = manifest.contracts.listing_consumer as Hex;
const base = {
  owner: owners.listing,
  parties: [owners.listing],
  policy_id: 'proposal_listing',
  policy_revision: 1,
  subject_id: 'pep724_active_proposal',
  subject_digest: digest({ pep: 724 }),
  source_manifest_digest: digest([revisions[0]]),
  consumer,
  consequence_digest: digest({ authorization: 'active_proposal_listing', pep: 724 }),
  generation: 0,
  deadline: 1893456000,
};
for (let i = 0; i < 21; i++) {
  const node = {
    ...base,
    request_id: `public.dependency.${i}`,
    dependency_id: `pep724.listing.${i}`,
    rank: i + 1,
    parents: i ? [`pep724.listing.${i - 1}`] : [],
    references: [
      {
        revision: 'pep724.r0',
        proposition: 'draft_status',
        span: 'status',
        definition: proposition,
      },
    ],
    kind: 'PROVIDER_LISTING',
    unresolved_route: 'QUARANTINED',
    remediation_route: 'ACCEPT_REPLACEMENT',
  };
  const configured = await transact('dependency' + i, keys.listing, consumer, 'configure', [
    canonical(node),
  ]);
  if (configured.resumed && i < 20) continue;
  // Allow the finalized dispatcher registration and binding callbacks to execute before the next rank depends on it.
  if (!configured.resumed) await new Promise((resolve) => setTimeout(resolve, 15000));
  for (let n = 0; n < 30; n++) {
    try {
      await read(consumer, 'get_decision', [node.dependency_id]);
      break;
    } catch {
      if (n === 29) throw new Error('Binding callback unavailable; saved registration is retained');
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
}
await transact('public-positive-listing', keys.listing, consumer, 'authorize_listing', [
  'pep724.listing.20',
  'public.before.correction',
  base.consequence_digest,
]);
const correction = {
  ...base,
  owner: operator,
  parties: [operator, owners.listing],
  request_id: 'public.pep724.withdrawal',
  source_manifest_digest: digest(revisions),
  generation: 1,
  old_revision: 'pep724.r0',
  new_revision: 'pep724.r1',
  propositions: [proposition],
};
await transact('public-open', main, contracts.court, 'open_correction', [canonical(correction)]);
await transact(
  'stale-before-notification',
  keys.listing,
  consumer,
  'authorize_listing',
  ['pep724.listing.20', 'public.stale.before.notice', base.consequence_digest],
  false,
);
let assessmentReceipt: Awaited<ReturnType<typeof transact>> | undefined;
let assessmentAttempts = 0;
for (let attempt = 0; attempt < 3; attempt++) {
  const name = attempt ? `public-assessment-retry${attempt}` : 'public-assessment';
  assessmentAttempts = attempt + 1;
  try {
    assessmentReceipt = await transact(name, main, contracts.court, 'assess_impact', [
      correction.request_id,
    ]);
    break;
  } catch (error) {
    let saved;
    try {
      saved = JSON.parse(await readFile(`${evidenceRoot}/network-${name}.json`, 'utf8'));
    } catch {
      throw error;
    }
    if (saved.execution !== 'FAILED' || !JSON.stringify(saved.result).includes('[LLM_ERROR]'))
      throw error;
    console.log('Assessment model output failed closed; retained receipt', saved.hash);
  }
}
if (!assessmentReceipt)
  throw new Error('Three failed model outputs; quarantine and all receipts retained');
const rawAssessment = await chain().getTransaction({
  hash: assessmentReceipt.hash as TransactionHash,
});
if (
  Object.values(rawAssessment.consensus_data?.votes ?? {}).filter((v) => v === 'agree').length < 2
)
  throw new Error('Independent multi validator agreement missing');
const assessed = await read<{
  status: string;
  certificate: { decisions: { impact: string; new_support: string; action: string }[] };
}>(contracts.court, 'get_request', [correction.request_id]);
await writeFile('verification/public-assessment.json', JSON.stringify(assessed, null, 2));
if (
  assessed.status !== 'ASSESSED' ||
  assessed.certificate.decisions[0].new_support !== 'FALSE' ||
  assessed.certificate.decisions[0].action !== 'QUARANTINE'
)
  throw new Error('Public withdrawal did not quarantine the listing');
for (let n = 0; n < 10; n++) {
  try {
    await read(contracts.dispatcher, 'get_certificate', [correction.request_id]);
    break;
  } catch {
    if (n === 9) throw new Error('Finalized certificate missing');
    await new Promise((r) => setTimeout(r, 10000));
  }
}
const { crashAndRecover } = await import('./worker-crash');
await crashAndRecover(correction.request_id, proposition.id, 0, 'public.page.0');
await transact('page0-restart', main, contracts.dispatcher, 'dispatch_page', [
  correction.request_id,
  proposition.id,
  0,
  'public.page.0',
]);
await transact('page1', main, contracts.dispatcher, 'dispatch_page', [
  correction.request_id,
  proposition.id,
  20,
  'public.page.1',
]);
const deep = await read<{ usable: boolean }>(contracts.dispatcher, 'get_dependency', [
  'pep724.listing.20',
]);
if (deep.usable) throw new Error('Stale descendant remains usable');
await writeFile(
  'verification/public-integration.json',
  JSON.stringify(
    {
      network: 'studionet',
      chain_id: 61999,
      genvm_runner: manifest.runner,
      owners,
      consumers: { listing: consumer, deployment: manifest.contracts.deployment_consumer },
      dependents: 21,
      deep_chain: 21,
      stale_action_refused_before_notice: true,
      public_withdrawal: assessed.certificate.decisions[0],
      assessment_attempts: assessmentAttempts,
      complete: true,
    },
    null,
    2,
  ),
);
console.log('Authentic withdrawal integration completed.');
