import { expect, it } from 'vitest';
import { receiptStatus, executionSucceeded } from '../../src/lib/server/chain';
it('rejects finalized majority disagreement despite a successful leader execution', () => {
  const receipt = {
    status: 7,
    consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] },
  };
  expect(executionSucceeded({ ...receipt, result_name: 'MAJORITY_DISAGREE' })).toBe(false);
  expect(executionSucceeded({ ...receipt, result: 7 })).toBe(false);
  expect(executionSucceeded({ ...receipt, result: 5 })).toBe(false);
  expect(executionSucceeded({ ...receipt, result_name: 'MAJORITY_AGREE', result: 6 })).toBe(true);
});
it('maps Studio status numbers including the uninitialized slot', () => {
  expect(receiptStatus({ status: 5 })).toBe('ACCEPTED');
  expect(receiptStatus({ status: 7 })).toBe('FINALIZED');
  expect(receiptStatus({ status: 8 })).toBe('CANCELED');
  expect(receiptStatus({ status: 'FINALIZED' })).toBe('FINALIZED');
});
it('does not treat finalized execution errors as success', () => {
  expect(
    executionSucceeded({
      status: 7,
      consensus_data: { leader_receipt: [{ execution_result: 'ERROR' }] },
    }),
  ).toBe(false);
  expect(
    executionSucceeded({
      status: 7,
      consensus_data: { leader_receipt: [{ execution_result: 'SUCCESS' }] },
    }),
  ).toBe(true);
});

it('uses the deciding leader receipt while retaining idle participant results', () => {
  expect(
    executionSucceeded({
      consensus_data: {
        leader_receipt: [
          { execution_result: 'SUCCESS' },
          { execution_result: 'ERROR', result: { payload: 'idle' } },
        ],
      },
    }),
  ).toBe(true);
});
