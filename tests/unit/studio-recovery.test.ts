import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  files: new Map<string, string>(),
  write: vi.fn(),
  wait: vi.fn(),
  triggered: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: async (path: string) => {
    if (!mock.files.has(path)) throw new Error('Missing file');
    return mock.files.get(path)!;
  },
  writeFile: async (path: string, body: string) => {
    mock.files.set(path, body);
  },
}));
vi.mock('../../src/lib/server/chain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/server/chain')>()),
  chain: () => ({
    writeContract: mock.write,
    waitForTransactionReceipt: mock.wait,
    getTriggeredTransactionIds: mock.triggered,
  }),
}));
import { assessWithConsensus } from '../../scripts/lib/studio';

const key = '0x1234';
const court = '0x1234567890123456789012345678901234567890';
function receipt(result: string, execution = 'SUCCESS') {
  return {
    status: 'FINALIZED',
    result,
    consensus_data: {
      votes: { first: 'agree', second: 'agree', third: 'agree' },
      leader_receipt: [{ execution_result: execution }],
    },
  };
}
beforeEach(() => {
  mock.files.clear();
  vi.clearAllMocks();
  mock.triggered.mockResolvedValue([]);
});
describe('hosted assessment recovery', () => {
  it('preserves a rejected leader round and retries only the same locked request', async () => {
    mock.write.mockResolvedValueOnce('0xfirst').mockResolvedValueOnce('0xsecond');
    mock.wait
      .mockResolvedValueOnce(receipt('MAJORITY_DISAGREE'))
      .mockResolvedValueOnce(receipt('MAJORITY_AGREE'));
    const result = await assessWithConsensus('assessment', key, court, 'locked.request');
    expect(result.execution).toBe('SUCCESS');
    expect(result.prior_failed_attempts).toMatchObject([
      { hash: '0xfirst', execution: 'FAILED', consensus_outcome: 'MAJORITY_DISAGREE' },
    ]);
    expect(JSON.parse(mock.files.get('verification/receipts/assessment.json')!)).toMatchObject({
      hash: '0xfirst',
      execution: 'FAILED',
    });
    expect(mock.write.mock.calls).toEqual([
      [{ address: court, functionName: 'assess_impact', args: ['locked.request'], value: 0n }],
      [{ address: court, functionName: 'assess_impact', args: ['locked.request'], value: 0n }],
    ]);
  });
  it('retains a submitted hash on transport failure without signing another attempt', async () => {
    mock.files.set(
      'verification/receipts/assessment.json',
      JSON.stringify({ hash: '0xretained', status: 'SUBMITTED' }),
    );
    mock.wait.mockRejectedValue(new Error('Transport interrupted'));
    await expect(assessWithConsensus('assessment', key, court, 'locked.request')).rejects.toThrow(
      'Transport interrupted',
    );
    expect(mock.write).not.toHaveBeenCalled();
    expect(mock.wait).toHaveBeenCalledWith(expect.objectContaining({ hash: '0xretained' }));
    expect(mock.files.has('verification/receipts/assessment.attempt2.json')).toBe(false);
  });
  it('does not retry a deterministic contract rejection', async () => {
    mock.write.mockResolvedValue('0xrejected');
    mock.wait.mockResolvedValue(receipt('MAJORITY_AGREE', 'ERROR'));
    await expect(assessWithConsensus('assessment', key, court, 'locked.request')).rejects.toThrow(
      'Unexpected result',
    );
    expect(mock.write).toHaveBeenCalledTimes(1);
    expect(mock.files.has('verification/receipts/assessment.attempt2.json')).toBe(false);
  });
});
