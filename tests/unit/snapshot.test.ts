import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  rows: [] as { kind: string; payload: Record<string, unknown> }[],
  read: vi.fn(),
}));
vi.mock('../../src/lib/server/db', () => ({
  db: () => async (strings: TemplateStringsArray) => {
    if (strings.join('').startsWith('SELECT kind,payload')) return state.rows;
    return [];
  },
}));
vi.mock('../../src/lib/server/chain', () => ({
  contracts: { dispatcher: 'dispatcher' },
  read: state.read,
}));
import { snapshot } from '../../src/lib/server/indexer';
beforeEach(() => {
  state.rows = Array.from({ length: 10 }, (_, i) => ({
    kind: 'incident',
    payload: {
      request_id: 'request' + i,
      status: 'ASSESSED',
      certificate: { decisions: [], certificate_digest: 'digest' + i },
    },
  }));
  state.read.mockReset();
});
it('bounds finality probes even when many assessed incidents are indexed', async () => {
  state.read.mockImplementation(async (_contract, _method, [id]) => ({
    status: 'FINALIZED',
    certificate_digest: 'digest' + id.replace('request', ''),
  }));
  const result = await snapshot();
  expect(state.read).toHaveBeenCalledTimes(3);
  expect(result.incidents.filter((i) => i.status === 'FINALIZED')).toHaveLength(3);
});
it('uses authenticated indexed finality and refuses a different certificate binding', async () => {
  state.rows[0].payload.dispatcher_finalized = true;
  state.read.mockResolvedValue({ status: 'FINALIZED', certificate_digest: 'another_deployment' });
  const result = await snapshot();
  expect(result.incidents.filter((i) => i.status === 'FINALIZED')).toHaveLength(1);
  expect(state.read).toHaveBeenCalledTimes(3);
});
it('never treats two absent certificate digests as proof of finality', async () => {
  state.rows = [
    {
      kind: 'incident',
      payload: { request_id: 'missing', status: 'ASSESSED', certificate: { decisions: [] } },
    },
  ];
  state.read.mockResolvedValue({ status: 'FINALIZED' });
  expect((await snapshot()).incidents[0].status).toBe('ASSESSED');
});
