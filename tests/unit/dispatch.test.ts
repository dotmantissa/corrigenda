import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  cursor: 0,
  total: 21,
  certificate: true,
  queries: [] as { text: string; values: unknown[] }[],
}));
vi.mock('../../src/lib/server/db', () => ({
  db:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      state.queries.push({ text, values });
      return text.startsWith('SELECT payload')
        ? [
            {
              payload: {
                request_id: 'timed.out',
                status: 'TIMEOUT',
                propositions: [{ id: 'assurance' }],
              },
            },
          ]
        : [];
    },
}));
vi.mock('../../src/lib/server/chain', () => ({
  contracts: { dispatcher: 'dispatcher' },
  read: async () => {
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
