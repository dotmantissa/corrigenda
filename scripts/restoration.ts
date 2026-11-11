import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createAccount } from 'genlayer-js';
import type { Hex } from 'viem';
import type { Revision } from '../src/lib/shared/schema';
import { contracts, read } from '../src/lib/server/chain';
import { canonical } from '../src/lib/shared/canonical';
import { transact, waitUntil } from './lib/studio';
const keys = JSON.parse(await readFile('.env.consumer-keys', 'utf8')) as {
  listing: Hex;
  deployment: Hex;
};
const main = process.env.GENLAYER_PRIVATE_KEY as Hex,
  operator = createAccount(main).address;
const owners = {
  listing: createAccount(keys.listing).address,
  deployment: createAccount(keys.deployment).address,
};
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const root = process.env.APP_ORIGIN?.startsWith('https://')
  ? process.env.APP_ORIGIN
  : 'https://corrigenda.vercel.app';
const policy = {
  policy_id: 'controlled_verification',
  revision: 1,
  rules: [
    {
      id: 'approval',
      text: 'Authorize only when all critical findings for the named test application are resolved.',
    },
    {
      id: 'exception',
      text: 'An unresolved critical finding overrides favorable wording and forbids authorization. The document is a controlled verification record, not real customer adoption.',
    },
  ],
};
await transact('restoration-authority', main, contracts.registry, 'configure_authority', [
  canonical({
    authority_id: 'corrigenda_verification',
    principal: operator,
    url_prefix: root + '/evidence/integration/',
    channel: 'controlled_verification',
    public_evidence_url: root + '/evidence/integration/initial.txt',
  }),
]);
await transact('restoration-policy', main, contracts.registry, 'register_policy', [
  canonical(policy),
]);
const revisions: Revision[] = [];
for (const [i, file] of ['initial', 'withdrawn', 'replacement'].entries()) {
  const url = `${root}/evidence/integration/${file}.txt`,
    response = await fetch(url);
  if (!response.ok) throw new Error('Published controlled evidence unavailable');
  const bytes = Buffer.from(await response.arrayBuffer()),
    digest = createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    request_id: `controlled.revision.${i}`,
    revision_id: `controlled.r${i}`,
    source_id: 'controlled_verification_record',
    authority_id: 'corrigenda_verification',
    channel: 'controlled_verification',
    url,
    byte_size: bytes.length,
    byte_digest: digest,
    scope:
      'Complete controlled integration fixture. This is not a customer attestation or real adoption.',
    spans: [{ id: 'record', start: 0, end: bytes.length, digest }],
    supersedes: i ? `controlled.r${i - 1}` : '',
  };
  revisions.push(manifest);
  await transact(`restoration-revision${i}`, main, contracts.registry, 'register_revision', [
    canonical(manifest),
  ]);
}
const proposition = {
  id: 'critical_resolved',
  statement: 'All critical findings for corrigenda_test_application are resolved',
  materiality_question:
    'Does the evidence permit future authorization under the no unresolved critical finding policy?',
  old_span: 'record',
  new_span: 'record',
  rule_ids: ['approval', 'exception'],
};
function binding(role: 'listing' | 'deployment', revision = 0, id = `controlled.${role}`) {
  const consumer = contracts[role + '_consumer'];
  return {
    request_id: `configuration.${id}`,
    owner: owners[role],
    parties: [owners[role]],
    policy_id: policy.policy_id,
    policy_revision: 1,
    subject_id: 'corrigenda_test_application',
    subject_digest: hash({ subject: 'corrigenda_test_application' }),
    source_manifest_digest: hash([revisions[revision]]),
    consumer,
    consequence_digest: hash({ role, subject: 'corrigenda_test_application' }),
    generation: 0,
    deadline: 1893456000,
    dependency_id: id,
    rank: 1,
    parents: [],
    references: [
      {
        revision: `controlled.r${revision}`,
        proposition: proposition.id,
        span: 'record',
        definition: proposition,
      },
    ],
    kind: role === 'listing' ? 'PROVIDER_LISTING' : 'DEPLOYMENT_APPROVAL',
    unresolved_route: 'QUARANTINED',
    remediation_route: 'ACCEPT_REPLACEMENT',
  };
}
for (const role of ['listing', 'deployment'] as const) {
  const config = binding(role);
  await transact(`restoration-configure-${role}`, keys[role], config.consumer, 'configure', [
    canonical(config),
  ]);
  await waitUntil(() => read(config.consumer, 'get_decision', [config.dependency_id]));
  await transact(
    `restoration-positive-${role}`,
    keys[role],
    config.consumer,
    role === 'listing' ? 'authorize_listing' : 'approve_deployment',
    [config.dependency_id, `controlled.before.${role}`, config.consequence_digest],
  );
}
async function correct(i: number, name: string) {
  const current = await read<number>(contracts.court, 'get_generation');
  const original = binding('listing');
  const request = {
    request_id: name,
    owner: operator,
    parties: [operator, owners.listing, owners.deployment],
    policy_id: policy.policy_id,
    policy_revision: 1,
    subject_id: original.subject_id,
    subject_digest: original.subject_digest,
    source_manifest_digest: hash([revisions[i], revisions[i + 1]]),
    consumer: original.consumer,
    consequence_digest: original.consequence_digest,
    generation: current + 1,
    deadline: 1893456000,
    old_revision: `controlled.r${i}`,
    new_revision: `controlled.r${i + 1}`,
    propositions: [proposition],
  };
  // On resume reuse the exact locked generation from decisive state.
  try {
    const existing = await read<{ generation: number }>(contracts.court, 'get_request', [name]);
    request.generation = existing.generation;
  } catch {}
  await transact(name + '-open', main, contracts.court, 'open_correction', [canonical(request)]);
  return request;
}
const withdrawal = await correct(0, 'controlled.withdrawal');
for (const role of ['listing', 'deployment'] as const) {
  const config = binding(role);
  await transact(
    `restoration-stale-${role}`,
    keys[role],
    config.consumer,
    role === 'listing' ? 'authorize_listing' : 'approve_deployment',
    [config.dependency_id, `controlled.stale.${role}`, config.consequence_digest],
    false,
  );
}
const withdrawalReceipt = await transact(
  'controlled.withdrawal-assess',
  main,
  contracts.court,
  'assess_impact',
  [withdrawal.request_id],
);
if (Object.values(withdrawalReceipt.votes ?? {}).filter((v) => v === 'agree').length < 2)
  throw new Error('Withdrawal lacks multi validator agreement');
const first = await waitUntil(() =>
  read<{ decisions: { action: string; new_support: string }[] }>(
    contracts.dispatcher,
    'get_certificate',
    [withdrawal.request_id],
  ),
);
if (first.decisions[0].action !== 'QUARANTINE' || first.decisions[0].new_support !== 'FALSE')
  throw new Error('Withdrawal was not material');
await transact('controlled.withdrawal-page', main, contracts.dispatcher, 'dispatch_page', [
  withdrawal.request_id,
  proposition.id,
  0,
  'controlled.withdrawal.page',
]);
for (const role of ['listing', 'deployment'] as const)
  await waitUntil(
    () =>
      read<{ last_applied_generation: number }>(contracts[role + '_consumer'], 'get_decision', [
        `controlled.${role}`,
      ]),
    (v) => v.last_applied_generation >= withdrawal.generation,
  );
const replacementConfig = binding('listing', 1, 'controlled.successor');
await transact(
  'restoration-register-successor',
  keys.listing,
  replacementConfig.consumer,
  'configure',
  [canonical(replacementConfig)],
);
await waitUntil(() =>
  read(replacementConfig.consumer, 'get_decision', [replacementConfig.dependency_id]),
);
const replacement = await correct(1, 'controlled.replacement');
const replacementReceipt = await transact(
  'controlled.replacement-assess',
  main,
  contracts.court,
  'assess_impact',
  [replacement.request_id],
);
if (Object.values(replacementReceipt.votes ?? {}).filter((v) => v === 'agree').length < 2)
  throw new Error('Replacement lacks multi validator agreement');
const second = await waitUntil(() =>
  read<{ decisions: { new_support: string }[] }>(contracts.dispatcher, 'get_certificate', [
    replacement.request_id,
  ]),
);
if (second.decisions[0].new_support !== 'TRUE')
  throw new Error('Replacement not independently supported');
for (const role of ['listing', 'deployment'] as const) {
  const config = binding(role),
    notice = `${withdrawal.request_id}:${proposition.id}:${config.dependency_id}`;
  const before = await read<{ usable: boolean }>(contracts.dispatcher, 'get_dependency', [
    config.dependency_id,
  ]);
  let accepted = false;
  try {
    const saved = JSON.parse(
      await readFile(`verification/receipts/restoration-accept-${role}.json`, 'utf8'),
    );
    accepted = saved.status === 'FINALIZED' && saved.execution === 'SUCCESS';
  } catch {}
  if (before.usable && !accepted)
    throw new Error('Replacement cleared quarantine before owner acceptance');
  await transact(
    `restoration-accept-${role}`,
    keys[role],
    config.consumer,
    'acknowledge_generation',
    [notice, withdrawal.generation, 'REFRESHED', replacement.request_id],
  );
  await waitUntil(
    () => read<{ usable: boolean }>(contracts.dispatcher, 'get_dependency', [config.dependency_id]),
    (v) => v.usable,
  );
  // Dispatcher acceptance precedes the authenticated callback to the consumer.
  // Only that callback permits a future action; keep the same acceptance on resume.
  const acknowledgementId = `${notice}:REFRESHED:${replacement.request_id}`;
  await waitUntil(
    async () => {
      type Page = { total: number; items: { event: string; operation_id?: string }[] };
      const first = await read<Page>(config.consumer, 'get_history', [0, 20]);
      const last =
        first.total > 20
          ? await read<Page>(config.consumer, 'get_history', [first.total - 20, 20])
          : first;
      return last.items.some(
        (event) =>
          event.event === 'REMEDIATION_FINALIZED' && event.operation_id === acknowledgementId,
      );
    },
    (finalized) => finalized,
  );
  await transact(
    `restoration-restored-${role}`,
    keys[role],
    config.consumer,
    role === 'listing' ? 'authorize_listing' : 'approve_deployment',
    [config.dependency_id, `controlled.restored.${role}`, config.consequence_digest],
  );
}
await writeFile(
  'verification/restoration.json',
  JSON.stringify(
    {
      network: 'studionet',
      chain_id: 61999,
      runner: 'py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6',
      classification: 'Controlled public integration fixtures, not real adoption',
      revisions,
      withdrawal,
      replacement,
      separate_owners: owners,
      listing_suspended_and_restored: true,
      deployment_suspended_and_restored: true,
      replacement_acceptance_required: true,
      complete: true,
    },
    null,
    2,
  ) + '\n',
);
console.log('Both consumers restored after finalized replacement acceptance.');
