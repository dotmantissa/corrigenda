import './network';
import { neon, neonConfig } from '@neondatabase/serverless';
// This endpoint accepts direct HTTPS SQL for the configured Neon region.
neonConfig.fetchEndpoint = (host) => `https://${host}/sql`;
export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Database is not configured');
  return neon(url);
}
