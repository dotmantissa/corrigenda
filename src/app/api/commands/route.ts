import { after } from 'next/server';
import { workerTick } from '@/lib/server/worker';
import { command } from '@/lib/shared/schema';
import { authenticate, assertOrigin, ApiError } from '@/lib/server/auth';
import { queueCommand } from '@/lib/server/operations';
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const identity = await authenticate(request);
    const text = await request.text();
    if (Buffer.byteLength(text) > 30000)
      throw new ApiError(
        413,
        'This request is too large. Split it into smaller complete requests.',
      );
    const input = command.safeParse(JSON.parse(text));
    if (!input.success)
      throw new ApiError(
        400,
        'Some request fields need attention. Check the identifiers, commitments and limits.',
      );
    const queued = await queueCommand(identity, input.data);
    after(async () => {
      try {
        await workerTick();
      } catch {
        /* The journal retains this operation for recovery. */
      }
    });
    return Response.json(queued, { status: 202 });
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json({ error: error.message }, { status: error.status });
    return Response.json(
      {
        error:
          'We could not submit this request. Your existing evidence is safe. Try again shortly.',
      },
      { status: 503 },
    );
  }
}
