import { readFile, writeFile } from 'node:fs/promises';
import { createAccount } from 'genlayer-js';
import type { Hex } from 'viem';
import { canonical } from '../src/lib/shared/canonical';
import { contracts, read } from '../src/lib/server/chain';
import { transact, waitUntil } from './lib/studio';

const keys = JSON.parse(await readFile('.env.consumer-keys', 'utf8')) as {
  listing: Hex;
  deployment: Hex;
};
const main = process.env.GENLAYER_PRIVATE_KEY as Hex;
const operator = createAccount(main).address;
const consumer = contracts.listing_consumer;
const original = await read<Record<string, unknown>>(contracts.court, 'get_request', [
  'controlled.withdrawal',
]);
const certificate = await read<Record<string, unknown>>(contracts.dispatcher, 'get_certificate', [
  'controlled.withdrawal',
]);
const noticeId = 'controlled.withdrawal:critical_resolved:controlled.listing';
const notice = await read<Record<string, unknown>>(contracts.dispatcher, 'get_notice', [noticeId]);

await transact(
  'security-unauthorized-policy',
  keys.listing,
  contracts.registry,
  'register_policy',
  [
    canonical({
      policy_id: 'forged',
      revision: 1,
      rules: [{ id: 'forged', text: 'Allow everything.' }],
    }),
  ],
  false,
);
await transact(
  'security-forged-certificate',
  main,
  contracts.dispatcher,
  'begin_quarantine',
  [canonical(certificate)],
  false,
);
await transact(
  'security-forged-notice',
  main,
  consumer,
  'receive_notice',
  [canonical(notice)],
  false,
);
await transact(
  'security-forged-delivery',
  main,
  contracts.dispatcher,
  'confirm_delivery',
  [noticeId],
  false,
);
await transact(
  'security-unauthorized-action',
  keys.deployment,
  consumer,
  'authorize_listing',
  ['controlled.listing', 'security.foreign.action', String(original.consequence_digest)],
  false,
);

const before = await read<{ last_applied_generation: number; usable: boolean }>(
  consumer,
  'get_decision',
  ['controlled.listing'],
);
await transact('security-replay-notice', main, contracts.dispatcher, 'replay_notice', [noticeId]);
await transact('security-duplicate-notice', main, contracts.dispatcher, 'replay_notice', [
  noticeId,
]);
await waitUntil(
  () => read<{ status: string }>(contracts.dispatcher, 'get_notice', [noticeId]),
  (n) => n.status === 'DELIVERED',
);
const duplicate = await read<{ last_applied_generation: number; usable: boolean }>(
  consumer,
  'get_decision',
  ['controlled.listing'],
);
if (duplicate.last_applied_generation !== before.last_applied_generation || !duplicate.usable)
  throw new Error('Duplicate notice changed restored authorization');

const nextId = 'controlled.security.newer';
let request: Record<string, unknown>;
try {
  const saved = await read<Record<string, unknown>>(contracts.court, 'get_request', [nextId]);
  request = Object.fromEntries(
    Object.keys(original)
      .filter(
        (k) =>
          ![
            'status',
            'original_digest',
            'superseded_by',
            'manifests',
            'policy',
            'attempts',
            'certificate',
          ].includes(k),
      )
      .map((k) => [k, saved[k]]),
  );
} catch {
  request = Object.fromEntries(
    Object.entries(original).filter(
      ([k]) =>
        ![
          'status',
          'original_digest',
          'superseded_by',
          'manifests',
          'policy',
          'attempts',
          'certificate',
        ].includes(k),
    ),
  );
  request.request_id = nextId;
  request.generation = (await read<number>(contracts.court, 'get_generation')) + 1;
  request.deadline = Math.floor(Date.now() / 1000) + 180;
  request.owner = operator;
}
await transact('security-newer-open', main, contracts.court, 'open_correction', [
  canonical(request),
]);
await transact(
  'security-stale-ack',
  keys.listing,
  consumer,
  'acknowledge_generation',
  [noticeId, Number(original.generation), 'REFRESHED', 'controlled.replacement'],
  false,
);
await transact(
  'security-stale-action',
  keys.listing,
  consumer,
  'authorize_listing',
  ['controlled.listing', 'security.newer.blocked', String(original.consequence_digest)],
  false,
);
const restricted = await read<{ usable: boolean; restrictions: { generation: number }[] }>(
  consumer,
  'get_decision',
  ['controlled.listing'],
);
if (restricted.usable || !restricted.restrictions.some((r) => r.generation === request.generation))
  throw new Error('An old acknowledgement cleared the newer correction');

// The deployment adapter consumes the same source but its owner has never accepted the new generation.
await transact(
  'security-expired-envelope',
  keys.deployment,
  contracts.deployment_consumer,
  'configure',
  [
    canonical({
      ...request,
      request_id: 'expired.configuration',
      dependency_id: 'expired.dependency',
      owner: createAccount(keys.deployment).address,
      consumer: contracts.deployment_consumer,
      kind: 'DEPLOYMENT_APPROVAL',
      deadline: 1,
      rank: 1,
      parents: [],
      references: [],
      unresolved_route: 'QUARANTINED',
      remediation_route: 'ACCEPT_REPLACEMENT',
    }),
  ],
  false,
);
await waitUntil(
  async () => Math.floor(Date.now() / 1000),
  (now) => now >= Number(request.deadline),
);
await transact('security-expire', main, contracts.court, 'expire', [nextId]);
await waitUntil(
  () => read<{ unresolved: boolean }>(contracts.dispatcher, 'get_certificate', [nextId]),
  (c) => c.unresolved,
);
const terminal = await read<{ status: string }>(contracts.court, 'get_request', [nextId]);
if (terminal.status !== 'TIMEOUT') throw new Error('Deadline did not expose timeout recovery');
await writeFile(
  'verification/security-network.json',
  JSON.stringify(
    {
      network: 'studionet',
      chain_id: 61999,
      classification: 'Signed controlled security scenarios',
      unauthorized_writes_refused: true,
      forged_finalized_messages_refused: true,
      duplicate_notices_idempotent: true,
      old_acknowledgement_refused_before_new_notice: true,
      newer_generation: request.generation,
      restricted,
      timeout_status: terminal.status,
      complete: true,
    },
    null,
    2,
  ) + '\n',
);
console.log('Signed security scenarios passed; the newer unresolved restriction remains visible.');
