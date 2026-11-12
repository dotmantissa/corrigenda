export function assessmentDeadline(networkTime: number, minutes: number): number {
  if (!Number.isSafeInteger(networkTime) || networkTime <= 0)
    throw new Error('The network clock is unavailable. Try refreshing.');
  if (!Number.isSafeInteger(minutes) || minutes < 5 || minutes > 1440)
    throw new Error('Choose an assessment window between 5 minutes and 24 hours.');
  const deadline = networkTime + minutes * 60;
  if (!Number.isSafeInteger(deadline)) throw new Error('The assessment deadline is invalid.');
  return deadline;
}
