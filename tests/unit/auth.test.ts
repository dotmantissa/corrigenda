import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ email: true, valid: true, queries: 0 }));
vi.mock('../../src/lib/server/config', () => ({
  getConfig: () => ({ NEXT_PUBLIC_PRIVY_APP_ID: 'public_app', PRIVY_APP_SECRET: 'server_only' }),
}));
vi.mock('@privy-io/node', () => ({
  PrivyClient: class {
    utils() {
      return {
        auth: () => ({
          verifyAccessToken: async () => {
            if (!state.valid) throw new Error('Invalid token');
            return { user_id: 'verified_user' };
          },
        }),
      };
    }
    users() {
      return {
        _get: async () => ({
          linked_accounts: state.email
            ? [{ type: 'email', address: 'controlled@example.test' }]
            : [{ type: 'wallet' }],
        }),
      };
    }
  },
}));
vi.mock('../../src/lib/server/db', () => ({
  db: () => async () => {
    state.queries++;
    return [
      {
        id: 'verified_user',
        address: '0x' + '1'.repeat(40),
        encrypted_key: 'private_ciphertext',
        listing_consumer: null,
        deployment_consumer: null,
      },
    ];
  },
}));
import { authenticate } from '../../src/lib/server/auth';
beforeEach(() => {
  state.email = true;
  state.valid = true;
  state.queries = 0;
});
it('rejects invalid and absent access tokens before reading account keys', async () => {
  await expect(authenticate(new Request('https://app.test'))).rejects.toMatchObject({
    status: 401,
  });
  state.valid = false;
  await expect(
    authenticate(new Request('https://app.test', { headers: { authorization: 'Bearer invalid' } })),
  ).rejects.toMatchObject({ status: 401 });
  expect(state.queries).toBe(0);
});
it('accepts only a verified email identity', async () => {
  const request = new Request('https://app.test', {
    headers: { authorization: 'Bearer controlled' },
  });
  state.email = false;
  await expect(authenticate(request)).rejects.toMatchObject({ status: 401 });
  expect(state.queries).toBe(0);
  state.email = true;
  expect((await authenticate(request)).id).toBe('verified_user');
});
