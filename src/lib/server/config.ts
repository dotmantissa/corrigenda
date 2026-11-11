import { z } from 'zod';
const env = z.object({
  DATABASE_URL: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().min(1),
  GENLAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-f]{64}$/),
  CUSTODY_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  GENLAYER_RPC_URL: z.string().url().default('https://studio.genlayer.com/api'),
});
export function getConfig() {
  const parsed = env.safeParse(process.env);
  if (!parsed.success) throw new Error('Server configuration is incomplete');
  return parsed.data;
}
