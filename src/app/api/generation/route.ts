import { read, contracts } from '@/lib/server/chain';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return Response.json({
      generation: await read<number>(contracts.court, 'get_generation'),
      finality: 'conservative state read',
    });
  } catch {
    return Response.json({ error: 'The correction generation is unavailable.' }, { status: 503 });
  }
}
