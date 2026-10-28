import type { ApiAppointment, ApiEvidence } from "../api";

/** Keep pinned context without replacing a newer saved reservation. */
export function mergeAppointmentSnapshots(
  snapshots: readonly ApiAppointment[],
): ApiAppointment[] {
  const saved = new Map<string, ApiAppointment>();
  for (const appointment of snapshots) {
    const previous = saved.get(appointment.id);
    if (
      !previous ||
      Date.parse(appointment.updatedAt) >= Date.parse(previous.updatedAt)
    )
      saved.set(appointment.id, appointment);
  }
  return [...saved.values()];
}

/** Review versions and an existing successor are both monotonic server facts. */
export function mergeEvidenceSnapshots(
  snapshots: readonly ApiEvidence[],
): ApiEvidence[] {
  const saved = new Map<string, ApiEvidence>();
  for (const evidence of snapshots) {
    const previous = saved.get(evidence.id);
    if (!previous) {
      saved.set(evidence.id, evidence);
      continue;
    }
    const latest =
      evidence.reviewVersion >= previous.reviewVersion ? evidence : previous;
    // Creating a revision adds its ID to the original without incrementing
    // reviewVersion. A filtered page must not erase that known successor.
    const successor =
      latest.supersededByEvidenceId ??
      evidence.supersededByEvidenceId ??
      previous.supersededByEvidenceId;
    saved.set(
      evidence.id,
      successor && !latest.supersededByEvidenceId
        ? { ...latest, supersededByEvidenceId: successor }
        : latest,
    );
  }
  return [...saved.values()];
}
