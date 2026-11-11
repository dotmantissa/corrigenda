import { createHash, randomUUID } from 'node:crypto';
import { type Command } from '../shared/schema';
import { canonical } from '../shared/canonical';
import { type Identity, ApiError } from './auth';
import { contracts } from './chain';
import { db } from './db';
export async function queueCommand(identity: Identity, input: Command) {
  let target: string | null = null,
    method: string | null = null,
    args: unknown[] = [];
  switch (input.kind) {
    case 'register_revision':
      target = contracts.registry;
      method = input.kind;
      args = [canonical(input.payload)];
      break;
    case 'open_correction':
      if (input.payload.owner.toLowerCase() !== identity.address.toLowerCase())
        throw new ApiError(403, 'This correction belongs to another account.');
      target = contracts.court;
      method = input.kind;
      args = [canonical(input.payload)];
      break;
    case 'register_dependency':
      if (
        ![identity.listing_consumer, identity.deployment_consumer].includes(input.payload.consumer)
      )
        throw new ApiError(403, 'Choose one of your application adapters.');
      if (input.payload.owner.toLowerCase() !== identity.address.toLowerCase())
        throw new ApiError(403, 'The application owner does not match your account.');
      target = input.payload.consumer;
      method = 'configure';
      args = [canonical(input.payload)];
      break;
    case 'assess_impact':
      target = contracts.court;
      method = input.kind;
      args = [input.request_id];
      break;
    case 'dispatch_page':
      target = contracts.dispatcher;
      method = input.kind;
      args = [input.request_id, input.proposition_id, input.cursor, input.operation_id];
      break;
    case 'acknowledge_generation':
      if (![identity.listing_consumer, identity.deployment_consumer].includes(input.consumer))
        throw new ApiError(403, 'Only the application owner can accept evidence.');
      target = input.consumer;
      method = input.kind;
      args = [
        input.operation_id,
        input.generation,
        input.route,
        input.replacement_certificate_id ?? '',
      ];
      break;
    case 'replay_notice':
      target = contracts.dispatcher;
      method = input.kind;
      args = [input.operation_id];
      break;
    case 'expire':
      target = contracts.court;
      method = input.kind;
      args = [input.request_id];
      break;
    case 'authorize':
      if (![identity.listing_consumer, identity.deployment_consumer].includes(input.consumer))
        throw new ApiError(403, 'This application belongs to another account.');
      target = input.consumer;
      method =
        input.consumer_kind === 'PROVIDER_LISTING' ? 'authorize_listing' : 'approve_deployment';
      args = [input.dependency_id, input.operation_id, input.consequence_digest];
      break;
    case 'deploy_consumers':
      break;
  }
  if (input.kind !== 'deploy_consumers' && !target)
    throw new ApiError(503, 'The correction network has not been configured yet.');
  const payloadDigest = createHash('sha256').update(canonical(input)).digest('hex');
  let id =
    input.kind === 'acknowledge_generation'
      ? `ack.${payloadDigest}`
      : input.kind === 'replay_notice'
        ? `replay.${payloadDigest}`
        : 'payload' in input
          ? input.payload.request_id
          : 'operation_id' in input
            ? input.operation_id
            : `${input.kind}.${input.request_id}`;
  const sql = db();
  const prior = await sql`SELECT payload_digest,identity_id FROM operations WHERE id=${id}`;
  if (
    prior.length &&
    (prior[0].payload_digest !== payloadDigest || prior[0].identity_id !== identity.id)
  )
    throw new ApiError(409, 'That request name is already used for a different operation.');
  if (prior.length) {
    if (input.kind !== 'assess_impact')
      return { id, status: (await sql`SELECT status FROM operations WHERE id=${id}`)[0].status };
    const base = id;
    const attempts =
      await sql`SELECT id,status,payload_digest,identity_id FROM operations WHERE id IN (${base},${base + '.attempt.2'},${base + '.attempt.3'}) ORDER BY created_at`;
    if (
      attempts.some((op) => op.payload_digest !== payloadDigest || op.identity_id !== identity.id)
    )
      throw new ApiError(409, 'That assessment belongs to a different signed request.');
    const retained = attempts.find((op) => op.status !== 'DELIVERY_FAILED');
    if (retained) return { id: retained.id, status: retained.status };
    if (attempts.length >= 3)
      throw new ApiError(
        409,
        'Three assessment attempts failed. The evidence remains quarantined; review the source and recovery path.',
      );
    id = `${base}.attempt.${attempts.length + 1}`;
  }
  // A bounded quota prevents a session from exhausting the signing queue.
  const count =
    await sql`SELECT count(*)::int AS total FROM operations WHERE identity_id=${identity.id} AND created_at>now()-interval '1 minute'`;
  if (count[0].total >= 10)
    throw new ApiError(429, 'There is a lot in flight. Give your requests a moment to settle.');
  const inserted =
    await sql`INSERT INTO operations(id,identity_id,kind,payload,payload_digest,target,method,args) VALUES(${id},${identity.id},${input.kind},${JSON.stringify(input)},${payloadDigest},${target},${method},${JSON.stringify(args)}) ON CONFLICT(id) DO NOTHING RETURNING id`;
  if (!inserted.length) {
    const winner =
      await sql`SELECT payload_digest,identity_id,status FROM operations WHERE id=${id}`;
    if (
      !winner.length ||
      winner[0].payload_digest !== payloadDigest ||
      winner[0].identity_id !== identity.id
    )
      throw new ApiError(409, 'That request name is already used for a different operation.');
    return { id, status: winner[0].status };
  }
  return { id, status: 'PENDING', operation_key: randomUUID() };
}
