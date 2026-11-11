import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { db } from '../src/lib/server/db';
import { contracts } from '../src/lib/server/chain';
async function invoke(crash: boolean, operationId: string) {
  const child = spawn(
    process.execPath,
    [
      '--env-file=.env',
      '--import=tsx',
      'scripts/worker.ts',
      '--once',
      '--operation-id',
      operationId,
      ...(crash ? ['--crash-after-broadcast'] : []),
    ],
    { stdio: 'ignore' },
  );
  return await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    pid: number | undefined;
  }>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal, pid: child.pid }));
  });
}
export async function crashAndRecover(
  requestId: string,
  propositionId: string,
  cursor: number,
  operationId: string,
) {
  const file = 'verification/worker-crash.json';
  try {
    const prior = JSON.parse(await readFile(file, 'utf8'));
    if (prior.complete) return;
  } catch {}
  const sql = db(),
    payload = { requestId, propositionId, cursor, operationId };
  await sql`INSERT INTO operations(id,kind,payload,payload_digest,target,method,args) VALUES(${operationId},'dispatch_page',${JSON.stringify(payload)},${createHash('sha256').update(JSON.stringify(payload)).digest('hex')},${contracts.dispatcher},'dispatch_page',${JSON.stringify([requestId, propositionId, cursor, operationId])}) ON CONFLICT(id) DO NOTHING`;
  let rows = await sql`SELECT status,transaction_hash FROM operations WHERE id=${operationId}`;
  let termination;
  if (rows[0].status === 'PENDING') {
    termination = await invoke(true, operationId);
    if (termination.signal !== 'SIGKILL')
      throw new Error('Worker was not terminated after broadcast');
    rows = await sql`SELECT status,transaction_hash FROM operations WHERE id=${operationId}`;
    if (rows[0].status !== 'SIGNED' || !rows[0].transaction_hash)
      throw new Error('Prebroadcast journal missing');
    await writeFile(
      file,
      JSON.stringify(
        { operation_id: operationId, hash: rows[0].transaction_hash, termination, complete: false },
        null,
        2,
      ),
    );
  }
  const hash = rows[0].transaction_hash;
  console.log('Worker killed after broadcast; journal retained', hash);
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20000));
    await invoke(false, operationId);
    rows =
      await sql`SELECT status,transaction_hash,receipt FROM operations WHERE id=${operationId}`;
    console.log('Recovered worker journal', rows[0].status);
    if (rows[0].transaction_hash !== hash)
      throw new Error('Recovery broadcast a different operation');
    if (rows[0].status === 'FINALIZED') {
      const previous = JSON.parse(await readFile(file, 'utf8'));
      await writeFile(
        file,
        JSON.stringify(
          { ...previous, complete: true, receipt: rows[0].receipt, recovered_status: 'FINALIZED' },
          null,
          2,
        ),
      );
      return;
    }
    if (rows[0].status === 'DELIVERY_FAILED')
      throw new Error('Recovered dispatch failed execution');
  }
  throw new Error('Worker recovery timeout; journal remains pending');
}
