import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  cursor: 0,
  total: 21,
  certificate: true,
  queries: [] as { text: string; values: unknown[] }[],
  reads: [] as string[],
  payload: { request_id: 'timed.out', status: 'TIMEOUT', propositions: [{ id: 'assurance' }] } as {
    request_id: string;
    status: string;
    propositions: { id: string }[];
    dispatch_scan?: number;
    dispatch_done?: string[];
    dispatch_complete?: boolean;
  },
}));
vi.mock('../../src/lib/server/db', () => ({
  db:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      state.queries.push({ text, values });
      return text.startsWith('SELECT payload') ? [{ payload: state.payload }] : [];
    },
}));
vi.mock('../../src/lib/server/chain', () => ({
  contracts: { dispatcher: 'dispatcher' },
  read: async (_contract: string, _method: string, args: string[]) => {
    state.reads.push(args[1]);
    if (!state.certificate) throw new Error('Callback pending');
    return { cursor: state.cursor, total: state.total };
  },
}));
import { scheduleDispatch } from '../../src/lib/server/dispatch';
beforeEach(() => {
  state.cursor = 0;
  state.total = 21;
  state.certificate = true;
  state.queries = [];
  state.reads = [];
  state.payload = {
    request_id: 'timed.out',
    status: 'TIMEOUT',
    propositions: [{ id: 'assurance' }],
  };
});
it('schedules an expired request from its finalized certificate and actual dispatch cursor', async () => {
  state.cursor = 20;
  await scheduleDispatch();
  expect(state.queries[0].text).toContain("'TIMEOUT'");
  const queued = state.queries.find((q) => q.text.startsWith('INSERT INTO operations'));
  expect(queued).toBeDefined();
  expect(JSON.parse(String(queued!.values.at(-1)))).toEqual([
    'timed.out',
    'assurance',
    20,
    queued!.values[0],
  ]);
});
it('does not invent a dispatch before the authenticated certificate arrives', async () => {
  state.certificate = false;
  await scheduleDispatch();
  expect(state.queries.some((q) => q.text.startsWith('INSERT INTO operations'))).toBe(false);
});
it('does not enqueue a completed delivery page', async () => {
  state.cursor = 21;
  await scheduleDispatch();
  expect(state.queries.some((q) => q.text.startsWith('INSERT INTO operations'))).toBe(false);
});
it('progresses across eight completed propositions over bounded worker ticks', async () => {
  state.payload.propositions = Array.from({ length: 8 }, (_, id) => ({ id: `p${id}` }));
  state.cursor = state.total;
  for (let tick = 0; tick < 3; tick++) {
    const before = state.reads.length;
    await scheduleDispatch();
    expect(state.reads.length - before).toBeLessThanOrEqual(3);
  }
  expect(new Set(state.reads)).toEqual(new Set(state.payload.propositions.map((p) => p.id)));
  expect(state.payload.dispatch_complete).toBe(true);
  expect(state.queries.some((q) => q.text.startsWith('INSERT INTO operations'))).toBe(false);
});

it('reopens completed incidents when the live reverse index grows', async () => {
  state.payload.dispatch_done = ['assurance'];
  state.payload.dispatch_complete = true;
  state.cursor = 21;
  state.total = 22;
  await scheduleDispatch();
  expect(state.payload.dispatch_complete).toBe(false);
  expect(state.queries.some((q) => q.text.startsWith('INSERT INTO operations'))).toBe(true);
  expect(state.queries[0].text).not.toContain('dispatch_complete');
});
