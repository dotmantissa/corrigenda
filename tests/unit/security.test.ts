import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/server/config', () => ({
  getConfig: () => ({
    CUSTODY_ENCRYPTION_KEY: 'a'.repeat(64),
    APP_ORIGIN: 'https://corrigenda.vercel.app',
  }),
}));
import { encryptKey, decryptKey } from '../../src/lib/server/custody';
import { assertOrigin, ApiError } from '../../src/lib/server/auth';
import { canonical } from '../../src/lib/shared/canonical';
import { command, correction, revision } from '../../src/lib/shared/schema';
describe('custodial signing boundary', () => {
  it('encrypts keys with fresh nonces and rejects tampering', () => {
    const key = `0x${'1'.repeat(64)}`,
      one = encryptKey(key),
      two = encryptKey(key);
    expect(one).not.toContain(key);
    expect(one).not.toBe(two);
    expect(decryptKey(one)).toBe(key);
    const parts = one.split('.');
    parts[2] = (parts[2][0] === '0' ? '1' : '0') + parts[2].slice(1);
    expect(() => decryptKey(parts.join('.'))).toThrow();
  });
  it('requires the deployed origin for every browser write', () => {
    expect(() =>
      assertOrigin(
        new Request('https://corrigenda.vercel.app/api/commands', {
          headers: { origin: 'https://elsewhere.test' },
        }),
      ),
    ).toThrow(ApiError);
    expect(() =>
      assertOrigin(
        new Request('https://corrigenda.vercel.app/api/commands', {
          headers: { origin: 'https://corrigenda.vercel.app' },
        }),
      ),
    ).not.toThrow();
  });
});
describe('request commitments', () => {
  it('canonicalizes nested bindings independently of property order', () =>
    expect(canonical({ z: [{ b: 2, a: 1 }], a: 'é' })).toBe('{"a":"é","z":[{"a":1,"b":2}]}'));
  it('does not accept partial correction envelopes', () =>
    expect(correction.safeParse({ request_id: 'partial' }).success).toBe(false));
  it('supports complete notice IDs and binds replacement selection', () => {
    const value = {
      kind: 'acknowledge_generation',
      consumer: `0x${'1'.repeat(40)}`,
      operation_id: `${'a'.repeat(96)}:${'b'.repeat(96)}:${'c'.repeat(96)}`,
      generation: 2,
      route: 'REFRESHED',
      replacement_certificate_id: 'replacement.2',
    };
    expect(command.parse(value)).toEqual(value);
    expect(command.safeParse({ ...value, generation: -1 }).success).toBe(false);
  });
  it('bounds complete records and proposition packets', () => {
    expect(revision.safeParse({ byte_size: 49153 }).success).toBe(false);
    expect(
      command.safeParse({
        kind: 'dispatch_page',
        request_id: 'x',
        proposition_id: 'p',
        cursor: -1,
        operation_id: 'o',
      }).success,
    ).toBe(false);
  });
});
