import { TalaApiError } from "./errors";
import type {
  Appointment,
  Evidence,
  EvidenceContentType,
  FamilyLinks,
  LearningRecord,
  LearningRecords,
  Operations,
  Progress,
  SessionState,
  Slot,
  UploadIntent,
  UploadStatus,
  User,
  Workspace,
} from "./types";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new TalaApiError("INVALID_RESPONSE");
  return raw as Record<string, unknown>;
}
export function text(raw: unknown, max = 200, empty = false): string {
  if (typeof raw !== "string" || raw.length > max || (!empty && !raw.trim()))
    throw new TalaApiError("INVALID_RESPONSE");
  return raw;
}
export function id(raw: unknown): string {
  const value = text(raw, 128);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw new TalaApiError("INVALID_RESPONSE");
  return value;
}
export function instant(raw: unknown): string {
  const value = text(raw, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new TalaApiError("INVALID_RESPONSE");
  return new Date(value).toISOString();
}
export function count(raw: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (
    typeof raw !== "number" ||
    !Number.isSafeInteger(raw) ||
    raw < 0 ||
    raw > max
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return raw;
}
export function array(raw: unknown, max = 500): unknown[] {
  if (!Array.isArray(raw) || raw.length > max)
    throw new TalaApiError("INVALID_RESPONSE");
  return raw;
}
export function contentType(raw: unknown): EvidenceContentType {
  if (raw !== "text/plain" && raw !== "application/pdf")
    throw new TalaApiError("INVALID_RESPONSE");
  return raw;
}
export function hash(raw: unknown): string {
  const value = text(raw, 64);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TalaApiError("INVALID_RESPONSE");
  return value;
}
export function user(raw: unknown): User {
  const value = object(raw);
  if (
    !["student", "parent", "operator"].includes(String(value.role)) ||
    typeof value.emailVerified !== "boolean"
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    uid: id(value.uid),
    name: text(value.name, 80),
    email: text(value.email, 254),
    role: value.role as User["role"],
    emailVerified: value.emailVerified,
  };
}
export function session(raw: unknown): SessionState {
  const value = object(raw);
  const csrfToken = text(value.csrfToken, 512);
  if (csrfToken.length < 32 || /[\r\n]/.test(csrfToken))
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    session: value.session === null ? null : user(value.session),
    csrfToken,
  };
}
export function slot(raw: unknown): Slot {
  const value = object(raw);
  if (typeof value.isAvailable !== "boolean")
    throw new TalaApiError("INVALID_RESPONSE");
  const startsAt = instant(value.startsAt),
    endsAt = instant(value.endsAt);
  if (Date.parse(endsAt) <= Date.parse(startsAt))
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    id: id(value.id),
    startsAt,
    endsAt,
    label: text(value.label, 160, true),
    isAvailable: value.isAvailable,
  };
}
export function appointment(raw: unknown, expectedOwner?: string): Appointment {
  const value = object(raw);
  const ownerUid = id(value.ownerUid);
  if (
    (expectedOwner && ownerUid !== expectedOwner) ||
    !["reserved", "cancelled", "ended"].includes(String(value.status)) ||
    value.meetingIntegration !== "unavailable"
  )
    throw new TalaApiError("INVALID_RESPONSE");
  const startsAt = instant(value.startsAt),
    endsAt = instant(value.endsAt);
  if (Date.parse(endsAt) <= Date.parse(startsAt))
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    id: id(value.id),
    ownerUid,
    slotId: id(value.slotId),
    startsAt,
    endsAt,
    status: value.status as Appointment["status"],
    meetingIntegration: "unavailable",
    updatedAt: instant(value.updatedAt),
  };
}
export function evidence(raw: unknown, expectedOwner?: string): Evidence {
  const value = object(raw);
  const ownerUid = id(value.ownerUid);
  if (
    (expectedOwner && ownerUid !== expectedOwner) ||
    value.status !== "submitted" ||
    !["not_reviewed", "reviewed", "needs_revision"].includes(
      String(value.reviewStatus),
    )
  )
    throw new TalaApiError("INVALID_RESPONSE");
  const size = count(value.size, MAX_FILE_BYTES);
  if (!size) throw new TalaApiError("INVALID_RESPONSE");
  return {
    id: id(value.id),
    ownerUid,
    appointmentId: id(value.appointmentId),
    title: text(value.title, 120),
    contentType: contentType(value.contentType),
    size,
    sha256: hash(value.sha256),
    status: "submitted",
    reviewStatus: value.reviewStatus as Evidence["reviewStatus"],
    submittedAt: instant(value.submittedAt),
    ...(value.reviewNote !== undefined
      ? { reviewNote: text(value.reviewNote, 1000) }
      : {}),
    ...(value.reviewedAt !== undefined
      ? { reviewedAt: instant(value.reviewedAt) }
      : {}),
  };
}
export function progress(raw: unknown): Progress {
  const value = object(raw);
  if (value.masteryStatus !== "unavailable")
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    submittedEvidenceCount: count(value.submittedEvidenceCount),
    assessedEvidenceCount: count(value.assessedEvidenceCount),
    reviewedEvidenceCount: count(value.reviewedEvidenceCount),
    acknowledgedOutcomeCount: count(value.acknowledgedOutcomeCount),
    masteryStatus: "unavailable",
  };
}
export function workspace(raw: unknown, ownerUid: string): Workspace {
  const value = object(raw);
  return {
    slots: array(value.slots).map(slot),
    appointments: array(value.appointments, 100).map((item) =>
      appointment(item, ownerUid),
    ),
    activeAppointments: array(value.activeAppointments, 1).map((item) =>
      appointment(item, ownerUid),
    ),
    evidence: array(value.evidence, 100).map((item) =>
      evidence(item, ownerUid),
    ),
    progress: progress(value.progress),
  };
}
export function uploadIntent(raw: unknown, expectedHash: string): UploadIntent {
  const value = object(raw);
  if (value.maxBytes !== MAX_FILE_BYTES || hash(value.sha256) !== expectedHash)
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    uploadId: id(value.uploadId),
    sha256: expectedHash,
    expiresAt: instant(value.expiresAt),
    maxBytes: MAX_FILE_BYTES,
  };
}
export function uploadStatus(raw: unknown, expectedId: string): UploadStatus {
  const value = object(raw);
  if (
    value.uploadId !== expectedId ||
    !["pending", "uploaded", "submitted", "cancelled", "failed"].includes(
      String(value.status),
    )
  )
    throw new TalaApiError("INVALID_RESPONSE");
  const size = count(value.size, MAX_FILE_BYTES);
  if (!size) throw new TalaApiError("INVALID_RESPONSE");
  return {
    uploadId: expectedId,
    status: value.status as UploadStatus["status"],
    sha256: hash(value.sha256),
    size,
    contentType: contentType(value.contentType),
  };
}
export function learningRecord(raw: unknown): LearningRecord {
  const value = object(raw);
  if (value.status !== "published" || value.attendance !== "not_recorded")
    throw new TalaApiError("INVALID_RESPONSE");
  const outcomes = array(value.outcomes, 30).map((rawOutcome) => {
    const outcome = object(rawOutcome);
    if (outcome.status !== "published" || outcome.source !== "staff")
      throw new TalaApiError("INVALID_RESPONSE");
    return {
      id: id(outcome.id),
      summary: text(outcome.summary, 2000),
      status: "published" as const,
      source: "staff" as const,
      publishedAt: instant(outcome.publishedAt),
    };
  });
  const acknowledgedOutcomeIds = array(value.acknowledgedOutcomeIds, 30).map(
    id,
  );
  if (
    new Set(outcomes.map((item) => item.id)).size !== outcomes.length ||
    new Set(acknowledgedOutcomeIds).size !== acknowledgedOutcomeIds.length ||
    acknowledgedOutcomeIds.some(
      (key) => !outcomes.some((item) => item.id === key),
    )
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    id: id(value.id),
    appointmentId: id(value.appointmentId),
    status: "published",
    attendance: "not_recorded",
    outcomes,
    acknowledgedOutcomeIds,
    updatedAt: instant(value.updatedAt),
  };
}
export function learningRecords(raw: unknown): LearningRecords {
  const value = object(raw),
    integrations = object(value.integrations);
  if (integrations.zoom !== "unavailable" || integrations.ai !== "unavailable")
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    records: array(value.records, 100).map(learningRecord),
    integrations: { zoom: "unavailable", ai: "unavailable" },
  };
}
export function familyLinks(raw: unknown, currentUid: string): FamilyLinks {
  const value = object(raw);
  const relationships = array(value.relationships, 100).map((rawLink) => {
    const link = object(rawLink);
    const studentUid = id(link.studentUid),
      parentUid = id(link.parentUid);
    if (
      (studentUid !== currentUid && parentUid !== currentUid) ||
      studentUid === parentUid ||
      link.status !== "active" ||
      link.consent !== "recorded" ||
      !Array.isArray(link.permissions) ||
      link.permissions.length !== 1 ||
      link.permissions[0] !== "read"
    )
      throw new TalaApiError("INVALID_RESPONSE");
    return {
      id: id(link.id),
      studentUid,
      parentUid,
      status: "active" as const,
      consent: "recorded" as const,
      permissions: ["read"] as ["read"],
    };
  });
  const linkedProfiles = array(value.linkedProfiles, 200).map((rawProfile) => {
    const profile = object(rawProfile),
      uid = id(profile.uid);
    if (
      !["student", "parent"].includes(String(profile.role)) ||
      !relationships.some(
        (link) => link.studentUid === uid || link.parentUid === uid,
      )
    )
      throw new TalaApiError("INVALID_RESPONSE");
    return {
      uid,
      role: profile.role as "student" | "parent",
      name: text(profile.name, 80),
    };
  });
  return { relationships, linkedProfiles };
}
export function operations(raw: unknown): Operations {
  const value = object(raw);
  return {
    appointments: array(value.appointments, 100).map((item) => {
      const record = object(item);
      const saved = appointment(record);
      const studentUid = id(record.studentUid);
      if (saved.ownerUid !== studentUid)
        throw new TalaApiError("INVALID_RESPONSE");
      return {
        ...saved,
        studentUid,
        studentName: text(record.studentName, 80),
      };
    }),
    evidence: array(value.evidence, 100).map((item) => {
      const record = object(item);
      const saved = evidence(record);
      const studentUid = id(record.studentUid);
      if (saved.ownerUid !== studentUid)
        throw new TalaApiError("INVALID_RESPONSE");
      return {
        ...saved,
        studentUid,
        studentName: text(record.studentName, 80),
      };
    }),
  };
}
