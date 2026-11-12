import { z } from 'zod';
export const identifier = z.string().regex(/^[A-Za-z0-9_.:]{1,96}$/);
export const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const envelope = z.object({
  request_id: identifier,
  owner: address,
  parties: z.array(address).max(8),
  policy_id: identifier,
  policy_revision: z.number().int().positive().max(4294967295),
  subject_id: identifier,
  subject_digest: hash,
  source_manifest_digest: hash,
  consumer: address,
  consequence_digest: hash,
  generation: z.number().int().nonnegative().safe(),
  deadline: z.number().int().positive().safe(),
});
export const proposition = z
  .object({
    id: identifier,
    statement: z.string().min(1).max(1000),
    materiality_question: z.string().min(1).max(1000),
    old_span: identifier,
    new_span: identifier,
    rule_ids: z.array(identifier).min(1).max(8),
  })
  .strict();
export const span = z
  .object({
    id: identifier,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive().max(49152),
    digest: hash,
  })
  .strict();
export const revision = z
  .object({
    request_id: identifier,
    revision_id: identifier,
    source_id: identifier,
    authority_id: identifier,
    channel: identifier,
    url: z.string().url().startsWith('https://').max(1024),
    byte_size: z.number().int().min(1).max(49152),
    byte_digest: hash,
    scope: z.string().min(1).max(1000),
    spans: z.array(span).min(1).max(16),
    supersedes: identifier.or(z.literal('')),
  })
  .strict();
export const correction = envelope
  .extend({
    old_revision: identifier,
    new_revision: identifier,
    propositions: z.array(proposition).min(1).max(8),
    supersedes_request: identifier.optional(),
  })
  .strict();
export const reference = z
  .object({
    revision: identifier,
    proposition: identifier,
    span: identifier,
    definition: proposition,
  })
  .strict();
export const dependency = envelope
  .extend({
    dependency_id: identifier,
    rank: z.number().int().min(1).max(4294967295),
    parents: z.array(identifier).max(8),
    references: z.array(reference).min(1).max(8),
    kind: z.enum(['PROVIDER_LISTING', 'DEPLOYMENT_APPROVAL']),
    unresolved_route: z.literal('QUARANTINED'),
    remediation_route: z.literal('ACCEPT_REPLACEMENT'),
  })
  .strict();
export const command = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('register_revision'), payload: revision }),
  z.object({ kind: z.literal('open_correction'), payload: correction }),
  z.object({ kind: z.literal('register_dependency'), payload: dependency }),
  z.object({ kind: z.literal('assess_impact'), request_id: identifier }),
  z.object({
    kind: z.literal('dispatch_page'),
    request_id: identifier,
    proposition_id: identifier,
    cursor: z.number().int().nonnegative(),
    operation_id: identifier,
  }),
  z.object({
    kind: z.literal('acknowledge_generation'),
    consumer: address,
    operation_id: z.string().regex(/^[A-Za-z0-9_.:]{1,290}$/),
    generation: z.number().int().nonnegative(),
    route: z.enum(['REFRESHED', 'QUARANTINED']),
    replacement_certificate_id: identifier.optional(),
  }),
  z.object({
    kind: z.literal('authorize'),
    consumer: address,
    dependency_id: identifier,
    operation_id: identifier,
    consequence_digest: hash,
    consumer_kind: z.enum(['PROVIDER_LISTING', 'DEPLOYMENT_APPROVAL']),
  }),
  z.object({ kind: z.literal('replay_acknowledgement'), consumer: address, operation_id: hash }),
  z.object({
    kind: z.literal('replay_notice'),
    operation_id: z.string().regex(/^[A-Za-z0-9_.:]{1,290}$/),
  }),
  z.object({ kind: z.literal('expire'), request_id: identifier }),
  z.object({ kind: z.literal('deploy_consumers'), operation_id: identifier }),
]);
export type Command = z.infer<typeof command>;
export type Revision = z.infer<typeof revision>;
export type Proposition = z.infer<typeof proposition>;
export interface Incident {
  request_id: string;
  status: string;
  generation: number;
  old_revision: string;
  new_revision: string;
  propositions: Proposition[];
  manifests: Revision[];
  certificate?: Certificate;
  deadline: number;
  owner: string;
  policy_id: string;
  policy_revision: number;
  consumer: string;
  consequence_digest: string;
  subject_id: string;
  subject_digest: string;
  source_manifest_digest: string;
  parties: string[];
  attempts: number;
  contexts?: Record<string, string>;
}
export interface Certificate {
  status: string;
  decisions: Decision[];
  unresolved: boolean;
  coverage: boolean;
  reason: string;
  certificate_digest: string;
  generation: number;
}
export interface Decision {
  proposition_id: string;
  impact: string;
  old_support: string;
  new_support: string;
  material: boolean;
  action: string;
  rule_ids: string[];
  witness_ids: string[];
}
export interface Dependency {
  dependency_id: string;
  subject_id: string;
  kind: string;
  rank: number;
  parents: string[];
  consumer: string;
  owner: string;
  usable: boolean;
  restrictions: { status: string; generation: number; proposition: string; revision: string }[];
  ancestors: { revision: string; proposition: string }[];
  consequence_digest: string;
  last_applied_generation: number;
}
export interface Operation {
  id: string;
  kind: string;
  status: string;
  hash: string | null;
  created_at: string;
  error: string | null;
}
export interface TimelineEvent {
  event: string;
  request_id?: string;
  dependency_id?: string;
  operation_id?: string;
  generation?: number;
  status?: string;
  contract: string;
  sequence: number;
}
export interface Snapshot {
  network: string;
  chain_id: number;
  updated_at: string | null;
  incidents: Incident[];
  dependencies: Dependency[];
  revisions: Revision[];
  timeline: TimelineEvent[];
  operations: Operation[];
  notices: {
    operation_id: string;
    dependency_id: string;
    proposition_id: string;
    action: string;
    certificate: Incident & Certificate;
    status?: string;
    acknowledgement?: { route: string; operation_id?: string };
  }[];
  contracts: Record<string, string>;
  connection: 'connected' | 'unavailable';
  user?: { address: string; listing_consumer: string | null; deployment_consumer: string | null };
}
