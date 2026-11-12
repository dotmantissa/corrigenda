import { db } from './db';
import { ApiError } from './auth';
/** Atomic counters include source preparation before retrieval or governance insertion. */
export async function admitWork(identityId: string) {
  const sql = db();
  const admitted = await sql`WITH personal AS (
    INSERT INTO admission_buckets(scope,minute,used) VALUES(${`identity.${identityId}`},date_trunc('minute',now()),1)
    ON CONFLICT(scope,minute) DO UPDATE SET used=admission_buckets.used+1 WHERE admission_buckets.used<10 RETURNING used
  ), shared AS (
    INSERT INTO admission_buckets(scope,minute,used) SELECT 'signing',date_trunc('minute',now()),1 FROM personal
    ON CONFLICT(scope,minute) DO UPDATE SET used=admission_buckets.used+1 WHERE admission_buckets.used<30 RETURNING used
  ) SELECT used FROM shared`;
  if (!admitted.length)
    throw new ApiError(429, 'The submission limit is reached. Try again next minute.');
}
