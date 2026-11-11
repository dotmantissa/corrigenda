export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
    .join(',')}}`;
}
export function humanStatus(status: string) {
  const names: Record<string, string> = {
    ASSESSED: 'Awaiting finality',
    FINALIZED: 'Finalized',
    UNRESOLVED: 'Needs another look',
    PENDING: 'Pending',
    ACCEPTED: 'Accepted',
    SUBMITTED: 'Submitted',
    SUPERSEDED: 'Superseded',
    TIMEOUT: 'Deadline passed',
    DELIVERY_FAILED: 'Delivery failed',
    BROADCAST: 'On its way',
    QUARANTINED: 'Quarantined',
    REFRESHED: 'Evidence accepted',
    CLEAR: 'Usable',
    RETRACTION: 'Retraction',
    QUALIFICATION: 'Qualification',
    CONTRADICTION: 'Contradiction',
    NONMATERIAL: 'No material change',
  };
  return names[status] ?? status.toLowerCase().replaceAll('_', ' ');
}
