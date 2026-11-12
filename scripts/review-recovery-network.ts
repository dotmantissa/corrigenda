import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createAccount } from 'genlayer-js';
import type { Hex } from 'viem';
import type { Incident, Revision } from '../src/lib/shared/schema';
import { contracts, read } from '../src/lib/server/chain';
import { canonical } from '../src/lib/shared/canonical';
import { assessWithConsensus, networkTime, transact, waitUntil } from './lib/studio';
const main = process.env.GENLAYER_PRIVATE_KEY as Hex;
const keys = JSON.parse(await readFile('.env.consumer-keys', 'utf8')) as {
  listing: Hex;
  deployment: Hex;
};
const proof = JSON.parse(await readFile('verification/review-network.json', 'utf8'));
if (!proof.complete)
  throw new Error('Finish the primary hosted suite before additional recovery verification');
const loss = proof.checks.support_loss_and_real_injection.cert;
const replacement = proof.checks.failed_acknowledgement_delivery_recovered.replacement.cert;
const consumer = proof.fault_consumer.address as Hex;
const fields = [
  'request_id',
  'owner',
  'parties',
  'policy_id',
  'policy_revision',
  'subject_id',
  'subject_digest',
  'source_manifest_digest',
  'consumer',
  'consequence_digest',
  'generation',
  'deadline',
  'old_revision',
  'new_revision',
  'propositions',
];
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const tuple = (domain: string, ...parts: unknown[]) => hash([domain, parts]);
const output: Record<string, unknown> = {
  network: 'studionet',
  chain_id: 61999,
  contracts,
  classification: 'Controlled real GenVM recovery and generation regressions',
};
async function persist() {
  await writeFile(
    'verification/review-recovery-network.json',
    JSON.stringify(output, null, 2) + '\n',
  );
}
function binding(cert: Record<string, unknown>) {
  return Object.fromEntries(fields.map((k) => [k, cert[k]]));
}
function reason(receipt: { leader_receipts?: unknown }) {
  const rows = Array.isArray(receipt.leader_receipts)
    ? receipt.leader_receipts
    : [receipt.leader_receipts];
  return JSON.stringify((rows[0] as { result?: unknown })?.result ?? '');
}
const deadlineRequest = {
  ...binding(loss),
  request_id: 'review.deadline.bound',
  generation: (await read<number>(contracts.court, 'get_generation')) + 1,
  deadline: (await networkTime()) + 365 * 86400,
};
const deadlineReceipt = await transact(
  'review-deadline-bound-reject',
  main,
  contracts.court,
  'open_correction',
  [canonical(deadlineRequest)],
  false,
);
if (!reason(deadlineReceipt).includes('Correction deadline'))
  throw new Error('Deadline probe failed for a different reason');
output.deadline_bound = { receipt: deadlineReceipt, expected_reason_verified: true };
await persist();
async function open(
  name: string,
  source: Record<string, unknown>,
  key: Hex = main,
  extra: Record<string, unknown> = {},
) {
  let value;
  try {
    value = binding(await read<Record<string, unknown>>(contracts.court, 'get_request', [name]));
    if (extra.supersedes_request) value.supersedes_request = extra.supersedes_request;
  } catch {
    value = {
      ...binding(source),
      request_id: name,
      owner: createAccount(key).address,
      generation: (await read<number>(contracts.court, 'get_generation')) + 1,
      deadline: (await networkTime()) + 7200,
      ...extra,
    };
  }
  const receipt = await transact(name + '-open', key, contracts.court, 'open_correction', [
    canonical(value),
  ]);
  return { value, receipt };
}
async function assess(name: string) {
  const receipt = await assessWithConsensus(name + '-assess', main, contracts.court, name);
  if (Object.values(receipt.votes ?? {}).filter((v) => v === 'agree').length < 2)
    throw new Error('Independent agreement missing for ' + name);
  const cert = await waitUntil(() =>
    read<Record<string, unknown>>(contracts.dispatcher, 'get_certificate', [name]),
  );
  return { receipt, cert };
}
// A temporary unavailable-source request can be recovered by a different public proposer.
const oldManifest = {
  ...loss.manifests[0],
  request_id: 'review.unavailable.revision.0',
  revision_id: 'review.unavailable.0',
  source_id: 'review.unavailable',
  url: String(loss.manifests[0].url).replace('loss0.json', 'unavailable0.json'),
  supersedes: '',
};
const newManifest = {
  ...oldManifest,
  request_id: 'review.unavailable.revision.1',
  revision_id: 'review.unavailable.1',
  url: String(oldManifest.url).replace('unavailable0.json', 'unavailable1.json'),
  supersedes: oldManifest.revision_id,
};
for (const [i, m] of [oldManifest, newManifest].entries())
  await transact('review-unavailable-revision' + i, main, contracts.registry, 'register_revision', [
    canonical(m),
  ]);
const owner = createAccount(keys.listing).address;
const config = {
  ...binding(loss),
  request_id: 'review.unavailable.config',
  owner,
  parties: [owner],
  subject_id: 'review_unavailable_application',
  subject_digest: hash({ subject: 'review_unavailable_application' }),
  consequence_digest: hash({ authorize: 'review_unavailable_application' }),
  source_manifest_digest: hash([oldManifest]),
  consumer,
  generation: 0,
  deadline: 1893456000,
  dependency_id: 'review.unavailable',
  rank: 1,
  parents: [],
  references: [
    {
      revision: oldManifest.revision_id,
      proposition: loss.propositions[0].id,
      span: loss.propositions[0].old_span,
      definition: loss.propositions[0],
    },
  ],
  kind: 'PROVIDER_LISTING',
  unresolved_route: 'QUARANTINED',
  remediation_route: 'ACCEPT_REPLACEMENT',
};
for (const k of ['old_revision', 'new_revision', 'propositions'])
  delete (config as Record<string, unknown>)[k];
await transact('review-unavailable-configure', keys.listing, consumer, 'configure', [
  canonical(config),
]);
await waitUntil(() => read(consumer, 'get_decision', [config.dependency_id]));
const unavailable = {
  ...config,
  source_manifest_digest: hash([oldManifest, newManifest]),
  old_revision: oldManifest.revision_id,
  new_revision: newManifest.revision_id,
  propositions: loss.propositions,
};
const first = await open('review.unavailable', unavailable);
const unresolved = await assess('review.unavailable');
if (unresolved.cert.status !== 'UNRESOLVED' || unresolved.cert.reason !== 'SOURCE_UNAVAILABLE')
  throw new Error('Unavailable evidence did not remain unresolved');
const recovered = await open('review.public.recovered', unavailable, keys.deployment, {
  supersedes_request: 'review.unavailable',
});
const prior = await read<{ status: string; superseded_by: string }>(
  contracts.court,
  'get_request',
  ['review.unavailable'],
);
if (prior.status !== 'SUPERSEDED' || prior.superseded_by !== 'review.public.recovered')
  throw new Error('Different proposer could not recover the request');
await assess('review.public.recovered');
output.public_recovery = {
  original_owner: first.value.owner,
  recovery_owner: recovered.value.owner,
  prior,
  recovered,
  independent_of_original_owner: first.value.owner !== recovered.value.owner,
};
await persist();
// Assessing the older pair must leave the newer pair's shared-revision flag untouched.
const older = await open('review.overlap.old', loss);
const newer = await open('review.overlap.newer', replacement);
const context = loss.contexts[loss.propositions[0].id];
const before = await read<Record<string, unknown>>(contracts.court, 'get_flag', [
  loss.new_revision,
  loss.propositions[0].id,
  context,
]);
const olderAssessment = await assess('review.overlap.old');
const after = await read<Record<string, unknown>>(contracts.court, 'get_flag', [
  loss.new_revision,
  loss.propositions[0].id,
  context,
]);
if (canonical(before) !== canonical(after) || after.generation !== newer.value.generation)
  throw new Error('Older assessment overwrote newer correction state');
const newerAssessment = await assess('review.overlap.newer');
output.overlap = { older, newer, before, after, olderAssessment, newerAssessment, monotonic: true };
await persist();
await transact('review-overlap-page', main, contracts.dispatcher, 'dispatch_page', [
  'review.overlap.old',
  loss.propositions[0].id,
  0,
  'review.overlap.page',
]);
const noticeId = tuple('notice.v2', 'review.overlap.old', loss.propositions[0].id, 'review.loss');
await waitUntil(
  () => read<{ status: string }>(contracts.dispatcher, 'get_notice', [noticeId]),
  (n) => n.status === 'DELIVERED',
);
const ack = await transact(
  'review-overlap-restore',
  keys.listing,
  consumer,
  'acknowledge_generation',
  [noticeId, Number(older.value.generation), 'REFRESHED', 'review.overlap.newer'],
);
const ackId = tuple('acknowledgement.v2', noticeId, 'REFRESHED', 'review.overlap.newer');
await waitUntil(async () => {
  type Page = { total: number; items: { event: string; operation_id?: string }[] };
  const first = await read<Page>(consumer, 'get_history', [0, 20]);
  const last =
    first.total > 20 ? await read<Page>(consumer, 'get_history', [first.total - 20, 20]) : first;
  return last.items.some((e) => e.event === 'REMEDIATION_FINALIZED' && e.operation_id === ackId);
}, Boolean);
await transact('review-overlap-restored-action', keys.listing, consumer, 'authorize_listing', [
  'review.loss',
  'review.overlap.restored',
  loss.consequence_digest,
]);
output.overlap_recovery = { ack, restored_after_finalized_callback: true };
await persist();
console.log('Bounded public recovery and overlapping generation ordering verified on GenVM.');

// Owner acceptance alone must retain the successor claim for its next correction.
const acceptedManifest = replacement.manifests[1];
const withdrawnManifest = {
  ...loss.manifests[1],
  request_id: 'review.revision.loss3',
  revision_id: 'review.loss3',
  supersedes: acceptedManifest.revision_id,
};
await transact('review-revision-loss3', main, contracts.registry, 'register_revision', [
  canonical(withdrawnManifest),
]);
const successorRequest = {
  ...binding(replacement),
  old_revision: acceptedManifest.revision_id,
  new_revision: withdrawnManifest.revision_id,
  source_manifest_digest: hash([acceptedManifest, withdrawnManifest]),
};
await open('review.accepted.successor.withdrawal', successorRequest);
const deniedBeforeNotice = await read<{ usable: boolean; restrictions: { revision: string }[] }>(
  contracts.dispatcher,
  'get_dependency',
  ['review.loss'],
);
if (
  deniedBeforeNotice.usable ||
  !deniedBeforeNotice.restrictions.some((r) => r.revision === withdrawnManifest.supersedes)
)
  throw new Error('Accepted successor restriction escaped original dependency before delivery');
const successorAssessment = await assess('review.accepted.successor.withdrawal');
await transact('review-accepted-successor-page', main, contracts.dispatcher, 'dispatch_page', [
  'review.accepted.successor.withdrawal',
  loss.propositions[0].id,
  0,
  'review.accepted.successor.page',
]);
const successorNotice = tuple(
  'notice.v2',
  'review.accepted.successor.withdrawal',
  loss.propositions[0].id,
  'review.loss',
);
await waitUntil(
  () => read<{ status: string }>(contracts.dispatcher, 'get_notice', [successorNotice]),
  (n) => n.status === 'DELIVERED',
);
output.accepted_successor_continuity = {
  successorAssessment,
  deniedBeforeNotice,
  no_additional_dependency_registration: true,
  delivered_to_original_dependency: true,
};
await persist();

// A finalized KEEP must advance authorization continuity even before its own notice arrives.
const stableProof = proof.checks.exhausted_opening_rejected_without_flags;
if (!stableProof) throw new Error('Primary KEEP and budget regression missing');
const keepCert = await read<Record<string, unknown> & Incident & { manifests: Revision[] }>(
  contracts.dispatcher,
  'get_certificate',
  ['review.stable.3'],
);
const stableOld = keepCert.manifests[1];
const { execFileSync } = await import('node:child_process');
const stableFixtureCommit = execFileSync(
  'git',
  ['log', '-1', '--format=%H', '--', 'tests/fixtures/review/stable2.json'],
  { encoding: 'utf8' },
).trim();
if (!/^[a-f0-9]{40}$/.test(stableFixtureCommit))
  throw new Error('Commit and publish the same-subject KEEP withdrawal fixture first');
const stableBytes = await readFile('tests/fixtures/review/stable2.json');
const stableByteDigest = createHash('sha256').update(stableBytes).digest('hex');
const stableWithdrawn = {
  ...stableOld,
  request_id: 'review.revision.stable2',
  revision_id: 'review.stable2',
  url: `https://raw.githubusercontent.com/dotmantissa/corrigenda/${stableFixtureCommit}/tests/fixtures/review/stable2.json`,
  byte_size: stableBytes.length,
  byte_digest: stableByteDigest,
  spans: [{ id: 'record', start: 0, end: stableBytes.length, digest: stableByteDigest }],
  supersedes: stableOld.revision_id,
};
await transact('review-revision-stable2', main, contracts.registry, 'register_revision', [
  canonical(stableWithdrawn),
]);
await open('review.keep.successor.withdrawal', {
  ...binding(keepCert),
  old_revision: stableOld.revision_id,
  new_revision: stableWithdrawn.revision_id,
  source_manifest_digest: hash([stableOld, stableWithdrawn]),
});
const keepDeniedBeforeNotice = await read<{
  usable: boolean;
  restrictions: { revision: string }[];
}>(contracts.dispatcher, 'get_dependency', ['review.stable']);
if (
  keepDeniedBeforeNotice.usable ||
  !keepDeniedBeforeNotice.restrictions.some((r) => r.revision === stableOld.revision_id)
)
  throw new Error('KEEP successor restriction escaped original dependency');
const keepAssessment = await assess('review.keep.successor.withdrawal');
await transact('review-keep-successor-page', main, contracts.dispatcher, 'dispatch_page', [
  'review.keep.successor.withdrawal',
  keepCert.propositions[0].id,
  0,
  'review.keep.successor.page',
]);
const keepNotice = tuple(
  'notice.v2',
  'review.keep.successor.withdrawal',
  keepCert.propositions[0].id,
  'review.stable',
);
await waitUntil(
  () => read<{ status: string }>(contracts.dispatcher, 'get_notice', [keepNotice]),
  (n) => n.status === 'DELIVERED',
);
output.keep_successor_continuity = {
  keepAssessment,
  keepDeniedBeforeNotice,
  no_additional_dependency_registration: true,
  restricted_before_keep_notice_delivery: true,
  delivered_to_original_dependency: true,
};
output.complete = true;
await persist();
console.log(
  'Accepted replacements and KEEP successors retain future denial and propagation on GenVM.',
);
