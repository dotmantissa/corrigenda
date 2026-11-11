import { createHash } from 'node:crypto';
import { z } from 'zod';
import { authenticate, assertOrigin, ApiError } from '@/lib/server/auth';
import { db } from '@/lib/server/db';
import { contracts } from '@/lib/server/chain';
import { canonical } from '@/lib/shared/canonical';
import { identifier } from '@/lib/shared/schema';
const inputSchema = z
  .object({
    url: z.string().url().startsWith('https://'),
    revision_id: identifier,
    source_id: identifier,
    scope: z.string().min(1).max(1000),
    supersedes: identifier.or(z.literal('')),
    span_id: identifier,
    public_evidence_url: z.string().url().startsWith('https://'),
  })
  .strict();
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const identity = await authenticate(request);
    const input = inputSchema.parse(await request.json());
    const url = new URL(input.url);
    if (!['raw.githubusercontent.com', 'www.rfc-editor.org', 'www.w3.org'].includes(url.hostname))
      throw new ApiError(
        422,
        'Choose an immutable raw GitHub record, an RFC or a W3C public record.',
      );
    if (
      url.hostname === 'raw.githubusercontent.com' &&
      !/^\/[^/]+\/[^/]+\/[0-9a-f]{40}\//.test(url.pathname)
    )
      throw new ApiError(
        422,
        'Use the full commit hash in the raw GitHub URL so the exact revision is clear.',
      );
    const response = await fetch(url, {
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new ApiError(422, 'The public record could not be retrieved.');
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError(422, 'The public record has no readable body.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 32768) {
        await reader.cancel();
        throw new ApiError(
          413,
          'This complete record exceeds the assessed text budget. Register a smaller complete document.',
        );
      }
      chunks.push(item.value);
    }
    if (!size) throw new ApiError(422, 'The public record is empty.');
    const bytes = Buffer.concat(chunks),
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      byteDigest = createHash('sha256').update(bytes).digest('hex');
    const prefix =
      url.hostname === 'raw.githubusercontent.com'
        ? `https://${url.hostname}/${url.pathname.split('/').slice(1, 3).join('/')}/`
        : `https://${url.hostname}/`;
    const authorityId = `principal.${createHash('sha256')
      .update(identity.id + prefix)
      .digest('hex')
      .slice(0, 32)}`;
    const authority = {
      authority_id: authorityId,
      principal: identity.address,
      url_prefix: prefix,
      channel: 'public_record_observer',
      public_evidence_url: input.public_evidence_url,
    };
    const sql = db(),
      operationId = `authority.${authorityId}`,
      payloadDigest = createHash('sha256').update(canonical(authority)).digest('hex');
    const existing = await sql`SELECT payload_digest FROM operations WHERE id=${operationId}`;
    if (existing.length && existing[0].payload_digest !== payloadDigest)
      throw new ApiError(
        409,
        'This principal configuration is already locked. Its evidence URL must stay the same.',
      );
    await sql`INSERT INTO operations(id,identity_id,kind,payload,payload_digest,target,method,args) VALUES(${operationId},${identity.id},'configure_authority',${JSON.stringify(authority)},${payloadDigest},${contracts.registry},'configure_authority',${JSON.stringify([canonical(authority)])}) ON CONFLICT(id) DO NOTHING`;
    const manifest = {
      request_id: `revision.${input.revision_id}`,
      revision_id: input.revision_id,
      source_id: input.source_id,
      authority_id: authorityId,
      channel: authority.channel,
      url: input.url,
      byte_size: size,
      byte_digest: byteDigest,
      scope: input.scope,
      spans: [{ id: input.span_id, start: 0, end: size, digest: byteDigest }],
      supersedes: input.supersedes,
    };
    return Response.json({ text, manifest, authority, authority_status: 'PENDING' });
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json({ error: error.message }, { status: error.status });
    return Response.json(
      { error: 'We could not prepare this record. Check the source details and try again.' },
      { status: 422 },
    );
  }
}
