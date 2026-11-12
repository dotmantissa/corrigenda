import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ allowed: true, queries: [] as string[], fetches: 0 }));
vi.mock('../../src/lib/server/db', () => ({
  db: () => async (strings: TemplateStringsArray) => {
    const query = strings.join('?');
    state.queries.push(query);
    return state.allowed ? [{ used: 1 }] : [];
  },
}));
vi.mock('../../src/lib/server/auth', () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  assertOrigin: () => {},
  authenticate: async () => ({ id: 'user', address: '0x' + '1'.repeat(40) }),
}));
vi.mock('../../src/lib/server/chain', () => ({ contracts: { registry: 'registry' } }));
import { admitWork } from '../../src/lib/server/admission';
import { POST } from '../../src/app/api/commit/route';
beforeEach(() => {
  state.allowed = true;
  state.queries = [];
  state.fetches = 0;
  vi.stubGlobal('fetch', async () => {
    state.fetches++;
    throw new Error('Should not retrieve rejected work');
  });
});
it('uses atomic admission for both identity and shared governance capacity', async () => {
  await admitWork('user');
  expect(state.queries[0]).toContain('ON CONFLICT(scope,minute) DO UPDATE');
  expect(state.queries[0]).toContain('admission_buckets.used<10');
  expect(state.queries[0]).toContain('admission_buckets.used<30');
  state.allowed = false;
  await expect(admitWork('user')).rejects.toMatchObject({ status: 429 });
});
it('rejects source preparation before fetching or inserting authority work', async () => {
  state.allowed = false;
  const request = new Request('https://corrigenda.vercel.app/api/commit', {
    method: 'POST',
    body: JSON.stringify({
      url: 'https://www.w3.org/record',
      revision_id: 'r1',
      source_id: 's',
      scope: 'Complete record',
      supersedes: '',
      span_id: 'all',
      public_evidence_url: 'https://www.w3.org/evidence',
    }),
  });
  const response = await POST(request);
  expect(response.status).toBe(429);
  expect(state.fetches).toBe(0);
  expect(state.queries).toHaveLength(1);
});
