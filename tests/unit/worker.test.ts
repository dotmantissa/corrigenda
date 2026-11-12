import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  queries: [] as { query: string; values: unknown[] }[],
  op: {} as Record<string, unknown>,
  signCalls: 0,
  rebroadcasts: [] as string[],
  receipt: { status: 1, success: false } as { status: number; success: boolean } | null,
  extra: [] as Record<string, unknown>[],
}));
vi.mock('../../src/lib/server/db', () => ({
  db:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join('?');
      state.queries.push({ query, values });
      if (query.startsWith('INSERT INTO worker_leases')) return [{ lease_id: 'lease' }];
      if (query.startsWith('SELECT o.*')) return [state.op, ...state.extra];
      return [];
    },
}));
vi.mock('../../src/lib/server/custody', () => ({ decryptKey: () => 'controlled_key' }));
vi.mock('../../src/lib/server/indexer', () => ({ indexNetwork: async () => ({}) }));
vi.mock('../../src/lib/server/dispatch', () => ({ scheduleDispatch: async () => {} }));
vi.mock('../../src/lib/server/chain', () => ({
  contracts: { dispatcher: 'dispatcher' },
  chain: (_key: unknown, onSigned: (raw: string, hash: string) => Promise<void>) => ({
    writeContract: async () => {
      state.signCalls++;
      await onSigned('controlled_raw', 'controlled_hash');
      return 'controlled_hash';
    },
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: string }) => {
      state.rebroadcasts.push(serializedTransaction);
    },
    getTransaction: async () => state.receipt,
  }),
  executionSucceeded: (r: { success: boolean }) => r.success,
  receiptStatus: (r: { status: number }) =>
    ({ 1: 'PENDING', 7: 'FINALIZED', 8: 'CANCELED' })[r.status],
}));
import { workerTick } from '../../src/lib/server/worker';
beforeEach(() => {
  state.queries = [];
  state.extra = [];
  state.signCalls = 0;
  state.rebroadcasts = [];
  state.receipt = { status: 1, success: false };
  state.op = {
    id: 'operation',
    kind: 'dispatch_page',
    status: 'PENDING',
    attempts: 0,
    target: 'dispatcher',
    method: 'dispatch_page',
    args: [],
  };
});
it('persists the signed hash before recording broadcast completion', async () => {
  await workerTick(false, 'operation');
  const signed = state.queries.findIndex((q) => q.query.includes("status='SIGNED'"));
  const submitted = state.queries.findIndex((q) => q.query.includes("status='SUBMITTED'"));
  expect(signed).toBeGreaterThan(-1);
  expect(submitted).toBeGreaterThan(signed);
  expect(state.queries.find((q) => q.query.startsWith('SELECT o.*'))?.values).toEqual([
    'operation',
    'operation',
  ]);
});
it('reconciles the identical signed operation without allocating another signature', async () => {
  state.op = {
    ...state.op,
    status: 'SIGNED',
    transaction_hash: 'old_hash',
    signed_transaction: 'old_raw',
    attempts: 3,
  };
  state.receipt = { status: 7, success: true };
  await workerTick();
  expect(state.signCalls).toBe(0);
  expect(state.rebroadcasts).toEqual(['old_raw']);
  expect(state.queries.find((q) => q.query.includes('receipt='))?.values[0]).toBe('FINALIZED');
});
it('exposes unresolved after three presigning failures and releases the worker lease', async () => {
  state.op.attempts = 3;
  await workerTick();
  expect(state.signCalls).toBe(0);
  expect(state.queries.some((q) => q.query.includes("status='UNRESOLVED'"))).toBe(true);
  expect(state.queries.at(-1)?.query).toContain('UPDATE worker_leases');
});
it('records canceled and finalized failed executions as delivery failures', async () => {
  state.op.transaction_hash = 'existing_hash';
  state.receipt = { status: 8, success: false };
  await workerTick();
  expect(state.queries.some((q) => q.query.includes('TRANSACTION_CANCELED'))).toBe(true);
  state.queries = [];
  state.receipt = { status: 7, success: false };
  await workerTick();
  expect(state.queries.find((q) => q.query.includes('receipt='))?.values[0]).toBe(
    'DELIVERY_FAILED',
  );
  expect(state.signCalls).toBe(0);
});

it('reconciles a missing receipt without starving another identity submission', async () => {
  state.op = {
    ...state.op,
    identity_id: 'old',
    transaction_hash: 'lost_hash',
    status: 'SUBMITTED',
    receipt_checks: 30,
  };
  state.extra = [
    {
      id: 'new',
      identity_id: 'new',
      kind: 'dispatch_page',
      status: 'PENDING',
      attempts: 0,
      target: 'dispatcher',
      method: 'dispatch_page',
      args: [],
    },
  ];
  state.receipt = null;
  await workerTick();
  expect(state.signCalls).toBe(1);
  expect(
    state.queries.some(
      (q) => q.query.includes('receipt_checks=receipt_checks+1') && q.values.includes('STRANDED'),
    ),
  ).toBe(true);
  expect(state.queries.find((q) => q.query.startsWith('SELECT o.*'))?.query).toContain(
    'PARTITION BY',
  );
  expect(state.queries.find((q) => q.query.startsWith('SELECT o.*'))?.query).toContain(
    'candidate.reconcile_at<=now()',
  );
});
