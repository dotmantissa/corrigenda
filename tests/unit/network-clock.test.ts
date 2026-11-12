import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('genlayer-js', () => ({
  createClient: () => ({ getTransaction: state.transaction }),
  createAccount: vi.fn(),
}));
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1794500000 * 1000));
  state.transaction.mockReset();
});
afterEach(() => vi.useRealTimers());
it('uses the Studio transaction clock and advances only within a short cache window', async () => {
  state.transaction.mockResolvedValue({ current_timestamp: 1794503600 });
  const { networkTime } = await import('../../src/lib/server/chain');
  expect(await networkTime()).toBe(1794503600);
  vi.advanceTimersByTime(5000);
  expect(await networkTime()).toBe(1794503605);
  expect(state.transaction).toHaveBeenCalledTimes(1);
  state.transaction.mockResolvedValue({ current_timestamp: 1794503620 });
  vi.advanceTimersByTime(15000);
  expect(await networkTime()).toBe(1794503620);
  expect(state.transaction).toHaveBeenCalledTimes(2);
});
it('fails closed when Studio does not provide a valid transaction clock', async () => {
  state.transaction.mockResolvedValue({});
  const { networkTime } = await import('../../src/lib/server/chain');
  await expect(networkTime()).rejects.toThrow('Network clock unavailable');
});
