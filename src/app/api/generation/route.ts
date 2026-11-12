import { read, contracts, networkTime } from '@/lib/server/chain';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const [generation, network_time] = await Promise.all([
      read<number>(contracts.court, 'get_generation'),
      networkTime(),
    ]);
    return Response.json({
      generation,
      network_time,
      finality: 'conservative state read',
    });
  } catch {
    return Response.json({ error: 'The correction generation is unavailable.' }, { status: 503 });
  }
}
