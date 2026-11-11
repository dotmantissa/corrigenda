import { identifier } from '@/lib/shared/schema';
import { contracts, read } from '@/lib/server/chain';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const id = identifier.safeParse(new URL(request.url).searchParams.get('request'));
  if (!id.success) return Response.json({ error: 'Choose a correction.' }, { status: 400 });
  try {
    const certificate = await read<{ propositions: { id: string }[] }>(
      contracts.dispatcher,
      'get_certificate',
      [id.data],
    );
    const pages = [];
    for (const proposition of certificate.propositions)
      pages.push({
        proposition_id: proposition.id,
        ...(await read<{ cursor: number; total: number }>(contracts.dispatcher, 'get_dispatch', [
          id.data,
          proposition.id,
        ])),
      });
    return Response.json({ pages }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { error: 'Delivery begins when the finalized certificate reaches the dispatcher.' },
      { status: 409 },
    );
  }
}
