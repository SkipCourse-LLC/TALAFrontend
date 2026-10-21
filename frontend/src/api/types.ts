/** Independent TALA server contracts. These types do not grant authorization. */
export type AccountRole = "student" | "parent" | "operator";
export interface User {
  uid: string;
  name: string;
  email: string;
  role: AccountRole;
  emailVerified: boolean;
}
export interface SessionState {
  session: User | null;
  csrfToken: string;
}
export interface AccountSession {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
}
export interface AccountSessions {
  sessions: AccountSession[];
  hasMore: boolean;
}
export interface SessionRevocation {
  revokedSessionCount: number;
  currentSessionRevoked: false;
}
export interface PasswordChangeReceipt {
  status: "completed";
  changedAt: string;
  revokedSessionCount: number;
}
export interface PasswordChangeResult {
  user: User;
  changedAt: string;
  revokedSessionCount: number;
}
export interface Slot {
  id: string;
  startsAt: string;
  endsAt: string;
  label: string;
  isAvailable: boolean;
}
export interface ManagedSlot extends Slot {
  status: "available" | "reserved" | "withdrawn";
  canWithdraw: boolean;
}
export interface Availability {
  slots: ManagedSlot[];
  hasMore: boolean;
}
export interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  ownerUid: string;
  slotId: string;
  status: "reserved" | "cancelled" | "ended";
  meetingIntegration: "unavailable";
  updatedAt: string;
}
export type EvidenceContentType = "text/plain" | "application/pdf";
export interface Evidence {
  id: string;
  ownerUid: string;
  appointmentId: string;
  title: string;
  contentType: EvidenceContentType;
  size: number;
  sha256: string;
  status: "submitted";
  reviewStatus: "not_reviewed" | "reviewed" | "needs_revision";
  reviewNote?: string;
  reviewedAt?: string;
  submittedAt: string;
  revisionNumber: number;
  rootEvidenceId: string;
  reviewVersion: number;
  revisesEvidenceId?: string;
  supersededByEvidenceId?: string;
}
export interface Progress {
  submittedEvidenceCount: number;
  assessedEvidenceCount: number;
  reviewedEvidenceCount: number;
  acknowledgedOutcomeCount: number;
  revisionSubmissionCount: number;
  masteryStatus: "unavailable";
}
export interface Workspace {
  slots: Slot[];
  appointments: Appointment[];
  activeAppointments: Appointment[];
  evidence: Evidence[];
  progress: Progress;
}
export interface UploadIntent {
  uploadId: string;
  expiresAt: string;
  maxBytes: number;
  sha256: string;
}
export interface UploadStatus {
  uploadId: string;
  status: "pending" | "uploaded" | "submitted" | "cancelled" | "failed";
  sha256: string;
  size: number;
  contentType: EvidenceContentType;
}
export interface PendingUpload {
  uploadId: string;
  title: string;
  appointmentId: string;
  contentType: EvidenceContentType;
  size: number;
  sha256: string;
  status: "pending" | "uploaded";
  expiresAt: string;
  revisesEvidenceId?: string;
}
export interface PendingUploads {
  uploads: PendingUpload[];
}
export interface LearningOutcome {
  id: string;
  summary: string;
  status: "published";
  source: "staff";
  publishedAt: string;
}
export interface LearningRecord {
  id: string;
  appointmentId: string;
  status: "published";
  attendance: "not_recorded";
  outcomes: LearningOutcome[];
  acknowledgedOutcomeIds: string[];
  updatedAt: string;
}
export interface LearningRecords {
  records: LearningRecord[];
  integrations: { zoom: "unavailable"; ai: "unavailable" };
}
export interface FamilyLinks {
  relationships: Array<{
    id: string;
    studentUid: string;
    parentUid: string;
    status: "active";
    consent: "recorded";
    permissions: ["read"];
  }>;
  linkedProfiles: Array<{
    uid: string;
    role: "student" | "parent";
    name: string;
  }>;
}
export interface EvidenceDownload {
  evidenceId: string;
  blob: Blob;
  filename: string;
  contentType: EvidenceContentType;
  size: number;
  sha256: string;
}
export interface Operations {
  appointments: Array<
    Appointment & { studentUid: string; studentName: string }
  >;
  evidence: Array<Evidence & { studentUid: string; studentName: string }>;
  availability: ManagedSlot[];
  availabilityHasMore: boolean;
  learningRecords: Array<
    LearningRecord & { studentUid: string; studentName: string }
  >;
}
