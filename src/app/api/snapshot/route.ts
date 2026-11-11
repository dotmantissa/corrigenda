import { after } from 'next/server';
import { workerTick } from '@/lib/server/worker';
import { snapshot } from '@/lib/server/indexer';
import { authenticate } from '@/lib/server/auth';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let id: string | undefined;
  if (request.headers.has('authorization')) {
    try {
      id = (await authenticate(request)).id;
    } catch {
      return Response.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 });
    }
  }
  if (id)
    after(async () => {
      try {
        await workerTick();
      } catch {
        /* Reconcile on the next poll or scheduler run. */
      }
    });
  try {
    return Response.json(await snapshot(id), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      {
        error: 'The network index is unavailable. Your decisions remain enforced by the contracts.',
      },
      { status: 503 },
    );
  }
}
