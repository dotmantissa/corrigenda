import { createHash } from 'node:crypto';
import { db } from '@/lib/server/db';
import { identifier } from '@/lib/shared/schema';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const id = identifier.safeParse(new URL(request.url).searchParams.get('revision'));
  if (!id.success)
    return Response.json({ error: 'Choose a registered revision.' }, { status: 400 });
  try {
    const sql = db(),
      rows = await sql`SELECT payload FROM indexed_records WHERE kind='revision' AND id=${id.data}`;
    if (!rows.length)
      return Response.json({ error: 'This revision has not been indexed yet.' }, { status: 404 });
    const manifest = rows[0].payload;
    const url = new URL(manifest.url);
    const controlledFixture =
      url.origin === new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000').origin &&
      /^\/evidence\/integration\/(initial|withdrawn|replacement)\.txt$/.test(url.pathname) &&
      !url.search &&
      !url.hash;
    if (
      !controlledFixture &&
      ![
        'raw.githubusercontent.com',
        'www.rfc-editor.org',
        'www.w3.org',
        'docs.genlayer.com',
      ].includes(url.hostname)
    )
      return Response.json(
        {
          error:
            'This source can be inspected at its public link. In app retrieval is not configured for its host.',
        },
        { status: 422 },
      );
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Unavailable');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Unavailable');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 49152) {
        await reader.cancel();
        throw new Error('Limit');
      }
      chunks.push(chunk.value);
    }
    const bytes = Buffer.concat(chunks);
    if (
      createHash('sha256').update(bytes).digest('hex') !== manifest.byte_digest ||
      size !== manifest.byte_size
    )
      return Response.json(
        {
          error: 'The source bytes have changed. Register a successor revision before using them.',
        },
        { status: 409 },
      );
    return Response.json(
      { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), manifest, verified: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      {
        error:
          'The authentic record is unavailable. This does not establish that its claim is true.',
      },
      { status: 503 },
    );
  }
}
