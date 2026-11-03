export type CalendarCategory =
  | "coursework"
  | "live_sessions"
  | "learning_support"
  | "clubs_activities"
  | "holidays";
export type ClassMode = "online" | "in_person";
export type ClassEnrollmentStatus =
  | "enrolled"
  | "pending_approval"
  | "pending_payment"
  | "confirmed"
  | "waitlisted"
  | "declined"
  | "cancelled";
export interface CalendarClass {
  id: string;
  title: string;
  description: string;
  category: CalendarCategory;
  startsAt: string;
  endsAt: string;
  teacher: string;
  grades: string;
  seatsAvailable: number | null;
  capacity: number | null;
  allDay: boolean;
  location: string;
  joiningUrl?: string;
  enrolled: boolean;
  source: "test_catalog" | "local_catalog";
  topic?: string;
  modalities?: ClassMode[];
  priceCents?: number;
  enrollmentStatus?: ClassEnrollmentStatus;
  enrollmentMode?: ClassMode;
  enrollmentVersion?: number;
  enrollmentGoalId?: string;
  version?: number;
  published?: boolean;
  savedForLater?: boolean;
}
export interface CalendarMeeting {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "reserved" | "ended";
}
export interface StudentCalendar {
  source: "test_catalog" | "local_catalog";
  timeZone: "America/Phoenix";
  month: string;
  classes: CalendarClass[];
  enrolled: CalendarClass[];
  meetings: CalendarMeeting[];
  updatedAt: string;
}
export interface CalendarEnrollmentResult {
  source: "test_catalog" | "local_catalog";
  class: CalendarClass;
}
export interface ClassCatalog {
  source: "local_catalog";
  timeZone: "America/Phoenix";
  classes: CalendarClass[];
  updatedAt: string;
}
export interface ClassEnrollment {
  classId: string;
  studentUid: string;
  studentName: string;
  classTitle: string;
  startsAt: string;
  endsAt: string;
  mode: ClassMode;
  status: ClassEnrollmentStatus;
  version: number;
  priceCents: number;
  updatedAt: string;
}
export interface ClassInput {
  title: string;
  description: string;
  category: Exclude<CalendarCategory, "holidays">;
  startsAt: string;
  endsAt: string;
  teacher: string;
  topic: string;
  grades: string;
  capacity: number;
  modalities: ClassMode[];
  location: string;
  priceCents: number;
}
export interface ClassApprovalInput {
  studentUid: string;
  classId: string;
  decision: "approve" | "decline";
  expectedVersion: number;
}
export interface ClassRequestPreferences {
  classId: string;
  mode: ClassMode;
  goalId: string | null;
  expectedVersion: number;
}
export interface ClassRosterExport {
  classId: string;
  filename: string;
  contentType: "text/csv";
  content: string;
  rowCount: number;
  exportedAt: string;
}
