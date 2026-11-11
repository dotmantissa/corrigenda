import { timingSafeEqual } from 'node:crypto';
import { workerTick } from '@/lib/server/worker';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET,
    provided = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (
    !expected ||
    !provided ||
    Buffer.byteLength(expected) !== Buffer.byteLength(provided) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  )
    return Response.json({ error: 'Authorized scheduler required.' }, { status: 401 });
  try {
    await workerTick();
    return Response.json({ status: 'RECONCILED' });
  } catch {
    return Response.json(
      { error: 'Recovery will continue from the journal on the next invocation.' },
      { status: 503 },
    );
  }
}
