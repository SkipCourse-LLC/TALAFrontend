import { array, count, id, instant, object, text } from "./decoders";
import { TalaApiError } from "./errors";
import type {
  AdmissionApplication,
  AdmissionCurrent,
  AdmissionDetail,
  AdmissionDocument,
  AdmissionSlot,
  AdmissionStatus,
  DocumentPreference,
  EnrollmentInspection,
  EnrollmentInvitation,
  AdmissionStudentSetup,
  AdmissionStudentProfile,
  AdmissionStudentResult,
} from "./admissionsContract";

function literal<T extends string>(raw: unknown, values: readonly T[]): T {
  if (!values.includes(raw as T)) throw new TalaApiError("INVALID_RESPONSE");
  return raw as T;
}
export function document(raw: unknown): AdmissionDocument {
  const v = object(raw);
  const size = count(v.size, 5 * 1024 * 1024);
  if (!size) throw new TalaApiError("INVALID_RESPONSE");
  return {
    id: id(v.id),
    name: text(v.name, 160),
    contentType: literal(v.contentType, ["application/pdf", "text/plain"]),
    size,
    uploadedAt: instant(v.uploadedAt),
  };
}
export function slot(raw: unknown): AdmissionSlot {
  const v = object(raw);
  const startsAt = instant(v.startsAt),
    endsAt = instant(v.endsAt);
  if (
    Date.parse(endsAt) <= Date.parse(startsAt) ||
    typeof v.isAvailable !== "boolean"
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    id: id(v.id),
    startsAt,
    endsAt,
    label: text(v.label, 160),
    isAvailable: v.isAvailable,
  };
}
export function application(raw: unknown): AdmissionApplication {
  const v = object(raw),
    version = count(v.version);
  if (!version) throw new TalaApiError("INVALID_RESPONSE");
  let appointment: AdmissionApplication["appointment"] = null;
  if (v.appointment !== null) {
    const a = object(v.appointment);
    const startsAt = instant(a.startsAt),
      endsAt = instant(a.endsAt);
    if (Date.parse(endsAt) <= Date.parse(startsAt))
      throw new TalaApiError("INVALID_RESPONSE");
    appointment = {
      id: id(a.id),
      slotId: id(a.slotId),
      startsAt,
      endsAt,
      status: literal(a.status, ["reserved", "cancelled"]),
    };
  }
  return {
    id: id(v.id),
    parentName: text(v.parentName, 80),
    email: text(v.email, 254),
    studentName: text(v.studentName, 80, true),
    gradeBand: text(v.gradeBand, 40, true),
    interest: text(v.interest, 600, true),
    status: literal<AdmissionStatus>(v.status, [
      "pending_interview",
      "interview_scheduled",
      "interviewed",
      "approved",
      "declined",
      "enrolled",
    ]),
    version,
    studentSetup: v.studentSetup == null ? null : studentSetup(v.studentSetup),
    documentPreference: literal<DocumentPreference>(v.documentPreference, [
      "bring",
      "upload",
      "undecided",
    ]),
    appointment,
    documents: array(v.documents, 10).map(document),
    createdAt: instant(v.createdAt),
    updatedAt: instant(v.updatedAt),
    ...(v.enrolledParentUid
      ? { enrolledParentUid: id(v.enrolledParentUid) }
      : {}),
  };
}
export function current(raw: unknown): AdmissionCurrent {
  const v = object(raw),
    integrations = object(v.integrations);
  if (
    v.mode !== "local_test" ||
    integrations.email !== "unavailable" ||
    integrations.meeting !== "unavailable"
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    application: v.application === null ? null : application(v.application),
    slots: array(v.slots, 1000).map(slot),
    integrations: { email: "unavailable", meeting: "unavailable" },
    mode: "local_test",
  };
}
export function applications(raw: unknown): {
  applications: AdmissionApplication[];
} {
  const v = object(raw);
  return { applications: array(v.applications, 1000).map(application) };
}
export function detail(raw: unknown): AdmissionDetail {
  const v = object(raw);
  const interview = v.interview === null ? null : object(v.interview);
  const invitation = v.invitation === null ? null : object(v.invitation);
  return {
    application: application(v.application),
    interview: interview
      ? {
          outcome: text(interview.outcome, 80),
          notes: text(interview.notes, 2000, true),
          recordedAt: instant(interview.recordedAt),
        }
      : null,
    audit: array(v.audit, 1000).map((raw) => {
      const a = object(raw);
      return {
        id: id(a.id),
        action: text(a.action, 100),
        actorUid: a.actorUid === null ? null : id(a.actorUid),
        createdAt: instant(a.createdAt),
      };
    }),
    invitation: invitation
      ? {
          expiresAt: instant(invitation.expiresAt),
          usedAt:
            invitation.usedAt === null ? null : instant(invitation.usedAt),
        }
      : null,
  };
}
export function invitation(raw: unknown): EnrollmentInvitation {
  const v = object(raw),
    token = text(v.token, 128);
  if (
    !/^[A-Za-z0-9_-]{43,128}$/.test(token) ||
    v.delivery !== "local_copy" ||
    v.emailSent !== false
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    token,
    expiresAt: instant(v.expiresAt),
    delivery: "local_copy",
    emailSent: false,
  };
}
export function inspection(raw: unknown): EnrollmentInspection {
  const v = object(raw);
  if (v.valid !== true || v.mode !== "local_test")
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    valid: true,
    email: text(v.email, 254),
    parentName: text(v.parentName, 80),
    expiresAt: instant(v.expiresAt),
    mode: "local_test",
  };
}
export function uploadIntent(raw: unknown) {
  const v = object(raw);
  return {
    uploadId: id(v.uploadId),
    maxBytes: count(v.maxBytes, 5 * 1024 * 1024),
    expiresAt: instant(v.expiresAt),
  };
}

function studentProfile(raw: unknown): AdmissionStudentProfile {
  const v = object(raw);
  return { uid: id(v.uid), name: text(v.name, 80), email: text(v.email, 254) };
}
export function studentSetup(raw: unknown): AdmissionStudentSetup {
  const v = object(raw),
    version = count(v.version),
    authorizedAt = instant(v.authorizedAt),
    expiresAt = instant(v.expiresAt);
  const status = literal(v.status, [
    "authorized",
    "expired",
    "provisioned",
  ] as const);
  if (
    !version ||
    Date.parse(expiresAt) <= Date.parse(authorizedAt) ||
    (status === "provisioned") !== Boolean(v.studentUid)
  )
    throw new TalaApiError("INVALID_RESPONSE");
  const student =
    v.student === undefined ? undefined : studentProfile(v.student);
  if (student && student.uid !== v.studentUid)
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    status,
    version,
    authorizedAt,
    expiresAt,
    ...(v.studentUid ? { studentUid: id(v.studentUid) } : {}),
    ...(student ? { student } : {}),
  };
}
export function studentResult(raw: unknown): AdmissionStudentResult {
  const v = object(raw),
    saved = application(v.application),
    student = studentProfile(v.student);
  if (
    saved.status !== "enrolled" ||
    saved.studentSetup?.status !== "provisioned" ||
    saved.studentSetup.studentUid !== student.uid
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return { application: saved, student };
}
