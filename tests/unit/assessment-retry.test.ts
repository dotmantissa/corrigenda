import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ statuses: ['DELIVERY_FAILED'], writes: [] as unknown[][] }));
const payload = { kind: 'assess_impact', request_id: 'correction' } as const;
const digest = createHash('sha256')
  .update('{"kind":"assess_impact","request_id":"correction"}')
  .digest('hex');
vi.mock('../../src/lib/server/db', () => ({
  db:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.join('?');
      if (q.startsWith('SELECT payload_digest'))
        return [{ payload_digest: digest, identity_id: 'email_identity' }];
      if (q.startsWith('SELECT id,status'))
        return state.statuses.map((status, i) => ({
          id: i ? `assess_impact.correction.attempt.${i + 1}` : 'assess_impact.correction',
          status,
          payload_digest: digest,
          identity_id: 'email_identity',
        }));
      if (q.startsWith('SELECT count')) return [{ total: 0 }];
      if (q.startsWith('INSERT INTO operations')) {
        state.writes.push(values);
        return [{ id: values[0] }];
      }
      return [];
    },
}));
vi.mock('../../src/lib/server/chain', () => ({ contracts: { court: 'court' } }));
import { queueCommand } from '../../src/lib/server/operations';
const identity = {
  id: 'email_identity',
  address: '0x' + '1'.repeat(40),
  encrypted_key: '',
  listing_consumer: null,
  deployment_consumer: null,
} as Parameters<typeof queueCommand>[0];
beforeEach(() => {
  state.statuses = ['DELIVERY_FAILED'];
  state.writes = [];
});
it('retains a finalized failure and allocates a distinct retry journal operation', async () => {
  await expect(queueCommand(identity, payload)).resolves.toMatchObject({
    id: 'assess_impact.correction.attempt.2',
    status: 'PENDING',
  });
  expect(state.writes[0][0]).toBe('assess_impact.correction.attempt.2');
});
it('reuses an in-flight retry without submitting it twice', async () => {
  state.statuses.push('SUBMITTED');
  await expect(queueCommand(identity, payload)).resolves.toMatchObject({
    id: 'assess_impact.correction.attempt.2',
    status: 'SUBMITTED',
  });
  expect(state.writes).toHaveLength(0);
});
it('stops after three finalized failed submissions', async () => {
  state.statuses.push('DELIVERY_FAILED', 'DELIVERY_FAILED');
  await expect(queueCommand(identity, payload)).rejects.toMatchObject({ status: 409 });
  expect(state.writes).toHaveLength(0);
});
