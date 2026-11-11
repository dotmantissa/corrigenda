import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  queries: [] as string[],
  reads: [] as string[],
  failRecord: false,
}));
vi.mock('../../src/lib/server/db', () => ({
  db: () => async (strings: TemplateStringsArray) => {
    const q = strings.join('?');
    state.queries.push(q);
    return q.startsWith('SELECT cursor') ? [{ cursor: 0 }] : [];
  },
}));
vi.mock('../../src/lib/server/chain', () => ({
  contracts: { registry: 'registry', court: 'court', dispatcher: 'dispatcher' },
  read: async (_contract: string, method: string, args: unknown[]) => {
    state.reads.push(`${method}:${args[0]}`);
    if (method === 'get_history')
      return {
        items: Array.from({ length: 20 }, (_, i) => ({
          event: 'REVISION_REGISTERED',
          revision_id: `r${i}`,
        })),
        next: 20,
        total: 20,
      };
    if (state.failRecord && args[0] === 'r6') throw new Error('Interrupted projection');
    return { revision_id: args[0] };
  },
}));
import { indexPage } from '../../src/lib/server/indexer';
beforeEach(() => {
  state.queries = [];
  state.reads = [];
  state.failRecord = false;
});
describe('replayable history projection', () => {
  it('projects all twenty events before advancing the cursor', async () => {
    await indexPage('registry');
    expect(state.reads.filter((r) => r.startsWith('get_revision'))).toHaveLength(20);
    expect(state.queries.at(-1)).toContain('INSERT INTO index_cursors');
  });
  it('does not skip records when projection fails midway', async () => {
    state.failRecord = true;
    await expect(indexPage('registry')).rejects.toThrow('Interrupted');
    expect(state.queries.some((q) => q.includes('INSERT INTO index_cursors'))).toBe(false);
    state.failRecord = false;
    await indexPage('registry');
    expect(state.reads).toContain('get_revision:r0');
    expect(state.reads).toContain('get_revision:r19');
  });
});
