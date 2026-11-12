import { expect, it } from 'vitest';
import { assessmentDeadline } from '../../src/lib/shared/assessment-window';

it('uses the network clock for deadlines when it differs from the user clock', () => {
  const localClock = 1794500000;
  const networkClock = localClock + 3600;
  expect(assessmentDeadline(networkClock, 120) - networkClock).toBe(7200);
  expect(assessmentDeadline(networkClock, 120)).not.toBe(localClock + 7200);
});
it('bounds user windows and rejects unavailable clocks before a request is sent', () => {
  for (const minutes of [0, 4, 1441, 365 * 1440, 5.5, NaN])
    expect(() => assessmentDeadline(1794500000, minutes)).toThrow('assessment window');
  for (const seconds of [0, NaN, Infinity])
    expect(() => assessmentDeadline(seconds, 120)).toThrow('network clock');
});
