import { workerTick } from '../src/lib/server/worker';
let stopped = false;
process.on('SIGTERM', () => {
  stopped = true;
});
process.on('SIGINT', () => {
  stopped = true;
});
while (!stopped) {
  try {
    const operationIndex = process.argv.indexOf('--operation-id');
    await workerTick(
      process.argv.includes('--crash-after-broadcast'),
      operationIndex >= 0 ? process.argv[operationIndex + 1] : undefined,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'CONTROLLED_WORKER_TERMINATION_AFTER_BROADCAST')
      process.exit(86);
    console.error('Worker tick could not finish; its journal is retained.');
  }
  if (process.argv.includes('--once')) break;
  if (!stopped) await new Promise((resolve) => setTimeout(resolve, 30000));
}
