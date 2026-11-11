import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ url: '', digest: '', size: 0 }));
vi.mock('../../src/lib/server/db', () => ({
  db: () => async () => [
    { payload: { url: state.url, byte_digest: state.digest, byte_size: state.size } },
  ],
}));
import { GET } from '../../src/app/api/sources/route';
const body = 'Controlled verification record.\n';
const invoke = () =>
  GET(new Request('https://corrigenda.vercel.app/api/sources?revision=controlled.r0'));
beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'https://corrigenda.vercel.app');
  state.url = 'https://corrigenda.vercel.app/evidence/integration/initial.txt';
  state.size = Buffer.byteLength(body);
  state.digest = createHash('sha256').update(body).digest('hex');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body)),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('retrieves labeled public fixtures only when their bytes match the commitment', async () => {
  const response = await invoke();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ text: body, verified: true });
  expect(fetch).toHaveBeenCalledWith(
    new URL(state.url),
    expect.objectContaining({ redirect: 'error' }),
  );
});
it.each([
  'https://corrigenda.vercel.app/api/worker',
  'https://corrigenda.vercel.app/evidence/integration/initial.txt?redirect=elsewhere',
  'https://elsewhere.test/evidence/integration/initial.txt',
])('does not permit arbitrary app URLs or other fixture hosts: %s', async (url) => {
  state.url = url;
  expect((await invoke()).status).toBe(422);
  expect(fetch).not.toHaveBeenCalled();
});
it('refuses changed source bytes instead of displaying them as verified', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Changed record.')),
  );
  expect((await invoke()).status).toBe(409);
});
