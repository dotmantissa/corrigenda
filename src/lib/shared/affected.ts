import type { Dependency, Incident, Snapshot } from './schema';

export function affectedDependencies(
  incident: Incident,
  dependencies: Dependency[],
  notices: Snapshot['notices'],
): Dependency[] {
  const recipients = new Set(
    notices
      .filter((n) => n.certificate.request_id === incident.request_id)
      .map((n) => n.dependency_id),
  );
  return dependencies.filter(
    (dependency) =>
      recipients.has(dependency.dependency_id) ||
      [...dependency.ancestors, ...dependency.restrictions].some(
        (reference) =>
          reference.revision === incident.old_revision &&
          !!incident.contexts?.[reference.proposition] &&
          reference.context === incident.contexts[reference.proposition],
      ),
  );
}
