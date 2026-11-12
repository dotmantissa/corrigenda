import { expect, it } from 'vitest';
import { affectedDependencies } from '../../src/lib/shared/affected';
import type { Dependency, Incident, Snapshot } from '../../src/lib/shared/schema';

it('matches original and selected revision restrictions within the same authorization context', () => {
  const incident = {
    request_id: 'later',
    old_revision: 'r1',
    contexts: { p: 'claim' },
  } as unknown as Incident;
  const dependencies = [
    {
      dependency_id: 'original',
      ancestors: [{ revision: 'r1', proposition: 'p', context: 'claim' }],
      restrictions: [],
    },
    {
      dependency_id: 'other-policy',
      ancestors: [{ revision: 'r1', proposition: 'p', context: 'other' }],
      restrictions: [],
    },
    {
      dependency_id: 'replacement',
      ancestors: [{ revision: 'r0', proposition: 'p', context: 'claim' }],
      restrictions: [{ revision: 'r1', proposition: 'p', context: 'claim' }],
    },
    { dependency_id: 'historical', ancestors: [], restrictions: [] },
  ] as unknown as Dependency[];
  const notices = [
    { dependency_id: 'historical', certificate: { request_id: 'later' } },
  ] as Snapshot['notices'];
  expect(affectedDependencies(incident, dependencies, notices).map((d) => d.dependency_id)).toEqual(
    ['original', 'replacement', 'historical'],
  );
  expect(affectedDependencies({ ...incident, contexts: undefined }, dependencies, [])).toEqual([]);
});
