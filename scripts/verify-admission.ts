import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { admitWork } from '../src/lib/server/admission';
import { db } from '../src/lib/server/db';
const identity = 'review-verification.' + randomUUID();
const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => admitWork(identity)));
const granted = outcomes.filter((r) => r.status === 'fulfilled').length;
const rejected = outcomes.filter((r) => r.status === 'rejected' && r.reason.status === 429).length;
if (granted !== 10 || rejected !== 10)
  throw new Error('Concurrent admission did not enforce the identity quota');
const rows =
  await db()`SELECT scope,used FROM admission_buckets WHERE scope=${'identity.' + identity}`;
if (rows.length !== 1 || rows[0].used !== 10)
  throw new Error('Atomic counter does not match admissions');
await writeFile(
  'verification/admission.json',
  JSON.stringify(
    {
      database: 'configured deployment database',
      concurrent_requests: 20,
      admitted: granted,
      rejected_429: rejected,
      atomic_counter: rows[0].used,
      source_and_command_share_gate: true,
      complete: true,
    },
    null,
    2,
  ) + '\n',
);
console.log('Concurrent database admission: 10 accepted, 10 rejected.');
