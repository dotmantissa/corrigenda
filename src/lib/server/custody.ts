import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getConfig } from './config';
export function encryptKey(key: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(getConfig().CUSTODY_ENCRYPTION_KEY, 'hex'),
      iv,
    );
  const data = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${data.toString('hex')}`;
}
export function decryptKey(value: string): `0x${string}` {
  const [iv, tag, data] = value.split('.');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(getConfig().CUSTODY_ENCRYPTION_KEY, 'hex'),
    Buffer.from(iv, 'hex'),
  );
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'hex')), cipher.final()]).toString(
    'utf8',
  ) as `0x${string}`;
}
