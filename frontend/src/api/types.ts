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
export interface LearningGoal {
  id: string;
  ownerUid: string;
  title: string;
  notes: string;
  dueDate: string | null;
  status: "active" | "completed";
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  steps: LearningGoalStep[];
  linkedEvidenceCount: number;
}
export interface LearningGoalStep {
  id: string;
  title: string;
  completed: boolean;
}
export interface LearningGoals {
  goals: LearningGoal[];
  limit: 100;
}
export interface LearningGoalInput {
  title: string;
  notes: string;
  dueDate: string | null;
  steps?: LearningGoalStep[];
}
/** One private, unsubmitted reflection per student; never shared with parents. */
export interface ReflectionDraft {
  ownerUid: string;
  title: string;
  text: string;
  status: "empty" | "saved";
  version: number;
  updatedAt: string | null;
}
export interface ReflectionDraftInput {
  title: string;
  text: string;
  version: number;
  requestId: string;
}
export interface LearningGoalEvidence {
  goalId: string;
  ownerUid: string;
  evidence: Evidence[];
  limit: 20;
}
export interface WorkspaceUpdate {
  id: string;
  type: "appointment" | "learning" | "review";
  title: string;
  summary: string;
  occurredAt: string;
  read: boolean;
  target: {
    view: "meetings" | "learning" | "evidence";
    resourceId: string;
  };
}
export interface WorkspaceUpdatesPage {
  ownerUid: string;
  items: WorkspaceUpdate[];
  nextCursor: string | null;
  unreadCount: number;
}
export interface WorkspaceUpdatesQuery {
  studentUid?: string;
  filter?: "all" | "unread";
  cursor?: string;
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
  nextCursor: string | null;
}
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface EvidencePageQuery {
  studentUid?: string;
  reviewStatus?: "all" | "not_reviewed" | "reviewed" | "needs_revision";
  currentOnly?: boolean;
  rootEvidenceId?: string;
  q?: string;
  cursor?: string;
}
export interface AppointmentPageQuery {
  studentUid?: string;
  status?: "all" | "reserved" | "cancelled" | "ended";
  /** Appointment start at/after this explicit-zone instant. */
  from?: string;
  /** Appointment start before this explicit-zone instant. */
  to?: string;
  cursor?: string;
}
export interface OperatorAppointmentQuery extends Omit<
  AppointmentPageQuery,
  "from" | "to"
> {
  publication?: "all" | "published" | "unpublished";
  q?: string;
}
export interface LearningPageQuery {
  q?: string;
  studentUid?: string;
  limit?: number;
  cursor?: string;
}
export interface OperatorLearningQuery extends LearningPageQuery {
  q?: string;
}
export interface AvailabilityPageQuery {
  status?: "all" | "available" | "reserved" | "withdrawn";
  cursor?: string;
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
  learningRecordId?: string;
}
export interface AppointmentPreparation {
  appointmentId: string;
  ownerUid: string;
  note: string;
  goalId: string | null;
  ready: boolean;
  version: number;
  updatedAt: string | null;
}
export interface AppointmentPreparationInput {
  note: string;
  goalId: string | null;
  ready: boolean;
  version: number;
  requestId: string;
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
  nextCursor: string | null;
}
export type OperatorEvidence = Evidence & {
  studentUid: string;
  studentName: string;
};
export type OperatorAppointment = Appointment & {
  studentUid: string;
  studentName: string;
  learningRecordId?: string;
};
export type OperatorLearningRecord = LearningRecord & {
  studentUid: string;
  studentName: string;
};
export interface OperatorLearningRecords {
  records: OperatorLearningRecord[];
  integrations: { zoom: "unavailable"; ai: "unavailable" };
  nextCursor: string | null;
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
