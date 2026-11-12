import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createAccount } from 'genlayer-js';
import type { Hex } from 'viem';
import type { Revision } from '../src/lib/shared/schema';
import { contracts, read } from '../src/lib/server/chain';
import { canonical } from '../src/lib/shared/canonical';
import { transact, waitUntil, networkTime } from './lib/studio';
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
async function correct(role: 'listing' | 'deployment', i: number, name: string) {
  let request;
  try {
    const retained = await read<Record<string, unknown>>(contracts.court, 'get_request', [name]);
    request = Object.fromEntries(
      [
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
      ].map((k) => [k, retained[k]]),
    );
  } catch {
    const original = binding(role);
    request = {
      ...original,
      request_id: name,
      owner: operator,
      parties: [operator, owners[role]],
      source_manifest_digest: hash([revisions[i], revisions[i + 1]]),
      generation: (await read<number>(contracts.court, 'get_generation')) + 1,
      deadline: (await networkTime()) + 7200,
      old_revision: revisions[i].revision_id,
      new_revision: revisions[i + 1].revision_id,
      propositions: [proposition],
    };
    for (const k of [
      'dependency_id',
      'rank',
      'parents',
      'references',
      'kind',
      'unresolved_route',
      'remediation_route',
    ])
      delete (request as Record<string, unknown>)[k];
  }
  await transact(name + '-open', main, contracts.court, 'open_correction', [canonical(request)]);
  return request as { request_id: string; generation: number };
}
const results: Record<string, unknown> = {};
async function assess(requestId: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const name = requestId + '-assess' + (attempt === 1 ? '' : `.attempt${attempt}`);
    try {
      return await transact(name, main, contracts.court, 'assess_impact', [requestId]);
    } catch (error) {
      let saved;
      try {
        saved = JSON.parse(await readFile(`verification/receipts/${name}.json`, 'utf8'));
      } catch {
        throw error;
      }
      if (
        saved.execution !== 'FAILED' ||
        (!['MAJORITY_DISAGREE', 'NO_MAJORITY', 7, 5].includes(saved.consensus_outcome) &&
          !JSON.stringify(saved.leader_receipts).includes('[LLM_ERROR]'))
      )
        throw error;
      console.log(
        'Assessment failed closed; retaining consensus outcome and retrying the same locked request',
        saved.hash,
      );
    }
  }
  throw new Error(
    'Three assessment executions failed; request and restrictions retained for timeout recovery',
  );
}
for (const role of ['listing', 'deployment'] as const) {
  const suffix = role === 'listing' ? '' : '.deployment';
  const config = binding(role);
  const withdrawal = await correct(role, 0, 'controlled.withdrawal' + suffix);
  await transact(
    'restoration-stale-' + role,
    keys[role],
    config.consumer,
    role === 'listing' ? 'authorize_listing' : 'approve_deployment',
    [config.dependency_id, 'controlled.stale.' + role, config.consequence_digest],
    false,
  );
  const withdrawalReceipt = await assess(withdrawal.request_id);
  if (Object.values(withdrawalReceipt.votes ?? {}).filter((v) => v === 'agree').length < 2)
    throw new Error('Independent withdrawal consensus missing');
  const first = await waitUntil(() =>
    read<{ decisions: { action: string; new_support: string }[] }>(
      contracts.dispatcher,
      'get_certificate',
      [withdrawal.request_id],
    ),
  );
  if (first.decisions[0].action !== 'QUARANTINE' || first.decisions[0].new_support !== 'FALSE')
    throw new Error('Withdrawal support invariant failed');
  await transact(withdrawal.request_id + '-page', main, contracts.dispatcher, 'dispatch_page', [
    withdrawal.request_id,
    proposition.id,
    0,
    withdrawal.request_id + '.page',
  ]);
  const notice = hash(['notice.v2', [withdrawal.request_id, proposition.id, config.dependency_id]]);
  await waitUntil(
    () => read<{ status: string }>(contracts.dispatcher, 'get_notice', [notice]),
    (v) => v.status === 'DELIVERED',
  );
  const successor = binding(role, 1, 'controlled.successor.' + role);
  await transact(
    'restoration-register-successor-' + role,
    keys[role],
    successor.consumer,
    'configure',
    [canonical(successor)],
  );
  await waitUntil(() => read(successor.consumer, 'get_decision', [successor.dependency_id]));
  const replacement = await correct(role, 1, 'controlled.replacement' + suffix);
  const replacementReceipt = await assess(replacement.request_id);
  if (Object.values(replacementReceipt.votes ?? {}).filter((v) => v === 'agree').length < 2)
    throw new Error('Independent replacement consensus missing');
  const second = await waitUntil(() =>
    read<{ decisions: { new_support: string }[] }>(contracts.dispatcher, 'get_certificate', [
      replacement.request_id,
    ]),
  );
  if (second.decisions[0].new_support !== 'TRUE')
    throw new Error('Replacement support invariant failed');
  const before = await read<{ usable: boolean }>(contracts.dispatcher, 'get_dependency', [
    config.dependency_id,
  ]);
  let accepted = false;
  try {
    accepted =
      JSON.parse(
        await readFile('verification/receipts/restoration-accept-' + role + '.json', 'utf8'),
      ).execution === 'SUCCESS';
  } catch {}
  if (before.usable && !accepted) throw new Error('Replacement bypassed owner acceptance');
  await transact(
    'restoration-accept-' + role,
    keys[role],
    config.consumer,
    'acknowledge_generation',
    [notice, withdrawal.generation, 'REFRESHED', replacement.request_id],
  );
  const ackId = hash(['acknowledgement.v2', [notice, 'REFRESHED', replacement.request_id]]);
  await waitUntil(async () => {
    const page = await read<{ total: number; items: { event: string; operation_id?: string }[] }>(
      config.consumer,
      'get_history',
      [0, 20],
    );
    const last =
      page.total > 20
        ? await read<typeof page>(config.consumer, 'get_history', [page.total - 20, 20])
        : page;
    return last.items.some((e) => e.event === 'REMEDIATION_FINALIZED' && e.operation_id === ackId);
  }, Boolean);
  await transact(
    'restoration-restored-' + role,
    keys[role],
    config.consumer,
    role === 'listing' ? 'authorize_listing' : 'approve_deployment',
    [config.dependency_id, 'controlled.restored.' + role, config.consequence_digest],
  );
  results[role] = { withdrawal, replacement, withdrawalReceipt, replacementReceipt };
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
      separate_owners: owners,
      results,
      listing_suspended_and_restored: true,
      deployment_suspended_and_restored: true,
      replacement_acceptance_required: true,
      complete: true,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Both authorization contexts restored after independently assessed, bound replacement acceptance.',
);
