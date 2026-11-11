import './network';
import { PrivyClient } from '@privy-io/node';
import { createAccount, generatePrivateKey } from 'genlayer-js';
import { getConfig } from './config';
import { db } from './db';
import { encryptKey } from './custody';
export interface Identity {
  id: string;
  address: `0x${string}`;
  encrypted_key: string;
  listing_consumer: string | null;
  deployment_consumer: string | null;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function authenticate(request: Request): Promise<Identity> {
  const bearer = request.headers.get('authorization');
  if (!bearer?.startsWith('Bearer '))
    throw new ApiError(401, 'Sign in with your email to continue.');
  const conf = getConfig();
  const privy = new PrivyClient({
    appId: conf.NEXT_PUBLIC_PRIVY_APP_ID,
    appSecret: conf.PRIVY_APP_SECRET,
  });
  let userId: string;
  try {
    const claims = await privy.utils().auth().verifyAccessToken(bearer.slice(7));
    userId = claims.user_id;
    const user = await privy.users()._get(userId);
    if (!user.linked_accounts.some((account) => account.type === 'email' && account.address))
      throw new Error('Email required');
  } catch {
    throw new ApiError(401, 'Your session has expired. Sign in again.');
  }
  const sql = db();
  let rows =
    await sql`SELECT id,address,encrypted_key,listing_consumer,deployment_consumer FROM identities WHERE id=${userId}`;
  if (!rows.length) {
    const key = generatePrivateKey(),
      account = createAccount(key);
    rows =
      await sql`INSERT INTO identities (id,address,encrypted_key) VALUES (${userId},${account.address},${encryptKey(key)}) ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id RETURNING id,address,encrypted_key,listing_consumer,deployment_consumer`;
  }
  return rows[0] as Identity;
}
export function assertOrigin(request: Request) {
  if (request.headers.get('origin') !== getConfig().APP_ORIGIN)
    throw new ApiError(403, 'This request did not come from Corrigenda.');
}
