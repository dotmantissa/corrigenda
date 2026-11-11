import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  race: false,
  identical: false,
  digest: '',
  writes: 0,
}));
vi.mock('../../src/lib/server/db', () => ({
  db:
    () =>
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join('?');
      if (query.startsWith('SELECT payload_digest,identity_id,status'))
        return [
          {
            payload_digest: state.identical ? state.digest : 'conflicting_digest',
            identity_id: 'email_identity',
            status: 'SIGNED',
          },
        ];
      if (query.startsWith('SELECT payload_digest')) return [];
      if (query.startsWith('SELECT count')) return [{ total: 0 }];
      if (query.startsWith('INSERT INTO operations')) {
        state.writes++;
        state.digest = String(values[4]);
        return state.race ? [] : [{ id: 'operation' }];
      }
      return [];
    },
}));
vi.mock('../../src/lib/server/chain', () => ({
  contracts: { court: 'court', registry: 'registry', dispatcher: 'dispatcher' },
}));
import { queueCommand } from '../../src/lib/server/operations';
const identity = {
  id: 'email_identity',
  address: `0x${'1'.repeat(40)}` as const,
  encrypted_key: '',
  listing_consumer: '0x' + '2'.repeat(40),
  deployment_consumer: null,
} as const;
beforeEach(() => {
  state.race = false;
  state.identical = false;
  state.writes = 0;
});
it('rejects a concurrent conflicting operation ID rather than reporting it queued', async () => {
  state.race = true;
  await expect(
    queueCommand(identity, { kind: 'assess_impact', request_id: 'correction' }),
  ).rejects.toMatchObject({ status: 409 });
});
it('returns the existing journal status when an identical request wins the race', async () => {
  state.race = true;
  state.identical = true;
  await expect(
    queueCommand(identity, { kind: 'assess_impact', request_id: 'correction' }),
  ).resolves.toMatchObject({ id: 'assess_impact.correction', status: 'SIGNED' });
});
it('refuses an authorization for an account controlled by another identity', async () => {
  await expect(
    queueCommand(identity, {
      kind: 'authorize',
      consumer: '0x' + '3'.repeat(40),
      dependency_id: 'dependency',
      operation_id: 'operation',
      consequence_digest: 'a'.repeat(64),
      consumer_kind: 'PROVIDER_LISTING',
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(state.writes).toBe(0);
});
