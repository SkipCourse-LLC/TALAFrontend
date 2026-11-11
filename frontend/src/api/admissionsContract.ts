/** Admissions records are separate from school accounts and student permissions. */
export type AdmissionStatus =
  | "pending_interview"
  | "interview_scheduled"
  | "interviewed"
  | "approved"
  | "declined"
  | "enrolled";
export type DocumentPreference = "bring" | "upload" | "undecided";
export interface AdmissionSlot {
  id: string;
  startsAt: string;
  endsAt: string;
  label: string;
  isAvailable: boolean;
}
export interface AdmissionDocument {
  id: string;
  name: string;
  contentType: "application/pdf" | "text/plain";
  size: number;
  uploadedAt: string;
}
export interface AdmissionApplication {
  id: string;
  parentName: string;
  email: string;
  studentName: string;
  gradeBand: string;
  interest: string;
  status: AdmissionStatus;
  version: number;
  documentPreference: DocumentPreference;
  appointment: null | {
    id: string;
    slotId: string;
    startsAt: string;
    endsAt: string;
    status: "reserved" | "cancelled";
  };
  documents: AdmissionDocument[];
  createdAt: string;
  updatedAt: string;
  enrolledParentUid?: string;
  studentSetup?: AdmissionStudentSetup | null;
}
export interface AdmissionCurrent {
  application: AdmissionApplication | null;
  slots: AdmissionSlot[];
  integrations: { email: "unavailable"; meeting: "unavailable" };
  mode: "local_test";
}
export interface AdmissionDetail {
  application: AdmissionApplication;
  interview: null | { outcome: string; notes: string; recordedAt: string };
  audit: Array<{
    id: string;
    action: string;
    actorUid: string | null;
    createdAt: string;
  }>;
  invitation: null | { expiresAt: string; usedAt: string | null };
}
export interface AdmissionInterestInput {
  parentName: string;
  email: string;
  studentName: string;
  gradeBand: string;
  interest: string;
  requestId: string;
}
export interface AdmissionReviewInput {
  action: "record_interview" | "approve" | "decline";
  notes: string;
  version: number;
  requestId: string;
}
export interface EnrollmentInvitation {
  token: string;
  expiresAt: string;
  delivery: "local_copy";
  emailSent: false;
}
export interface EnrollmentInspection {
  valid: true;
  email: string;
  parentName: string;
  expiresAt: string;
  mode: "local_test";
}

export interface AdmissionStudentProfile {
  uid: string;
  name: string;
  email: string;
}
export interface AdmissionStudentSetup {
  status: "authorized" | "expired" | "provisioned";
  version: number;
  authorizedAt: string;
  expiresAt: string;
  studentUid?: string;
  student?: AdmissionStudentProfile;
}
export interface AdmissionStudentInput {
  version: number;
  name: string;
  email: string;
  password: string;
  consent: true;
  requestId: string;
}
export interface AdmissionStudentResult {
  application: AdmissionApplication;
  student: AdmissionStudentProfile;
}
