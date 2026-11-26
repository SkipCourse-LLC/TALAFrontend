import { array, count, id, instant, object, text } from "./decoders";
import { TalaApiError } from "./errors";
import type {
  CalendarCategory,
  CalendarClass,
  CalendarEnrollmentResult,
  CalendarMeeting,
  StudentCalendar,
  ClassCatalog,
  ClassEnrollment,
  ClassEnrollmentStatus,
  ClassMode,
  ClassRosterExport,
} from "./calendarContract";

const categories = new Set<CalendarCategory>([
  "coursework",
  "live_sessions",
  "learning_support",
  "clubs_activities",
  "holidays",
]);

export function course(raw: unknown): CalendarClass {
  const value = object(raw);
  const category = text(value.category) as CalendarCategory;
  const startsAt = instant(value.startsAt);
  const endsAt = instant(value.endsAt);
  const capacity = value.capacity === null ? null : count(value.capacity, 1000);
  const seatsAvailable =
    value.seatsAvailable === null ? null : count(value.seatsAvailable, 1000);
  if (
    !categories.has(category) ||
    !["test_catalog", "local_catalog"].includes(String(value.source)) ||
    typeof value.enrolled !== "boolean" ||
    typeof value.allDay !== "boolean" ||
    Date.parse(endsAt) <= Date.parse(startsAt) ||
    (capacity === null) !== (seatsAvailable === null) ||
    (capacity !== null && seatsAvailable! > capacity) ||
    (category === "holidays" && (value.enrolled || !value.allDay))
  )
    throw new TalaApiError("INVALID_RESPONSE");
  const optional: Partial<CalendarClass> = {};
  if (value.savedForLater !== undefined) {
    if (typeof value.savedForLater !== "boolean")
      throw new TalaApiError("INVALID_RESPONSE");
    optional.savedForLater = value.savedForLater;
  }
  if (value.joiningUrl !== undefined) {
    const joiningUrl = text(value.joiningUrl, 1000);
    try {
      const url = new URL(joiningUrl);
      if (
        url.protocol !== "https:" ||
        !url.hostname ||
        url.username ||
        url.password ||
        /\s/u.test(joiningUrl)
      )
        throw new TalaApiError("INVALID_RESPONSE");
    } catch {
      throw new TalaApiError("INVALID_RESPONSE");
    }
    optional.joiningUrl = joiningUrl;
  }
  if (value.topic !== undefined) optional.topic = text(value.topic, 100);
  if (value.modalities !== undefined) {
    const modes = array(value.modalities, 2).map(mode);
    if (!modes.length || new Set(modes).size !== modes.length)
      throw new TalaApiError("INVALID_RESPONSE");
    optional.modalities = modes;
  }
  if (value.priceCents !== undefined)
    optional.priceCents = count(value.priceCents, 1000000);
  if (value.enrollmentStatus !== undefined)
    optional.enrollmentStatus = status(value.enrollmentStatus);
  if (value.enrollmentMode !== undefined)
    optional.enrollmentMode = mode(value.enrollmentMode);
  if (value.enrollmentVersion !== undefined)
    optional.enrollmentVersion = positive(value.enrollmentVersion);
  if (value.enrollmentGoalId !== undefined)
    optional.enrollmentGoalId = id(value.enrollmentGoalId);
  if (value.version !== undefined) optional.version = positive(value.version);
  if (value.published !== undefined) {
    if (typeof value.published !== "boolean")
      throw new TalaApiError("INVALID_RESPONSE");
    optional.published = value.published;
  }
  if (
    optional.enrollmentStatus &&
    value.enrolled !==
      [
        "enrolled",
        "pending_approval",
        "pending_payment",
        "confirmed",
        "waitlisted",
      ].includes(optional.enrollmentStatus)
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    ...optional,
    id: id(value.id),
    title: text(value.title, 160),
    description: text(value.description, 1600, true),
    category,
    startsAt,
    endsAt,
    teacher: text(value.teacher, 100, true),
    grades: text(value.grades, 100, true),
    seatsAvailable,
    capacity,
    allDay: value.allDay,
    location: text(value.location, 160, true),
    enrolled: value.enrolled,
    source: value.source as CalendarClass["source"],
  };
}

function unique<T extends { id: string }>(items: T[]): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new TalaApiError("INVALID_RESPONSE");
  return items;
}

function meeting(raw: unknown): CalendarMeeting {
  const value = object(raw);
  const startsAt = instant(value.startsAt);
  const endsAt = instant(value.endsAt);
  if (
    !["reserved", "ended"].includes(String(value.status)) ||
    Date.parse(endsAt) <= Date.parse(startsAt)
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    id: id(value.id),
    title: text(value.title, 160),
    startsAt,
    endsAt,
    status: value.status as CalendarMeeting["status"],
  };
}

export function studentCalendar(raw: unknown): StudentCalendar {
  const value = object(raw);
  const month = text(value.month, 7);
  if (
    !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) ||
    !["test_catalog", "local_catalog"].includes(String(value.source)) ||
    value.timeZone !== "America/Phoenix"
  )
    throw new TalaApiError("INVALID_RESPONSE");
  const enrolled = unique(array(value.enrolled, 2000).map(course));
  if (enrolled.some((item) => !item.enrolled))
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    source: value.source as StudentCalendar["source"],
    timeZone: "America/Phoenix",
    month,
    classes: unique(array(value.classes, 1000).map(course)),
    enrolled,
    meetings: unique(array(value.meetings, 1000).map(meeting)),
    updatedAt: instant(value.updatedAt),
  };
}

export function calendarEnrollment(raw: unknown): CalendarEnrollmentResult {
  const value = object(raw);
  if (!["test_catalog", "local_catalog"].includes(String(value.source)))
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    source: value.source as CalendarEnrollmentResult["source"],
    class: course(value.class),
  };
}

function mode(raw: unknown): ClassMode {
  if (raw !== "online" && raw !== "in_person")
    throw new TalaApiError("INVALID_RESPONSE");
  return raw;
}
function status(raw: unknown): ClassEnrollmentStatus {
  if (
    ![
      "enrolled",
      "pending_approval",
      "pending_payment",
      "confirmed",
      "waitlisted",
      "declined",
      "cancelled",
    ].includes(String(raw))
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return raw as ClassEnrollmentStatus;
}
function positive(raw: unknown): number {
  const value = count(raw);
  if (!value) throw new TalaApiError("INVALID_RESPONSE");
  return value;
}
export function classCatalog(raw: unknown): ClassCatalog {
  const value = object(raw);
  if (value.source !== "local_catalog" || value.timeZone !== "America/Phoenix")
    throw new TalaApiError("INVALID_RESPONSE");
  const classes = unique(array(value.classes, 1000).map(course));
  if (classes.some((item) => item.source !== "local_catalog"))
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    source: "local_catalog",
    timeZone: "America/Phoenix",
    classes,
    updatedAt: instant(value.updatedAt),
  };
}
export function classEnrollment(raw: unknown): ClassEnrollment {
  const value = object(raw),
    startsAt = instant(value.startsAt),
    endsAt = instant(value.endsAt);
  if (Date.parse(startsAt) >= Date.parse(endsAt))
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    classId: id(value.classId),
    studentUid: id(value.studentUid),
    studentName: text(value.studentName, 100),
    classTitle: text(value.classTitle, 160),
    startsAt,
    endsAt,
    mode: mode(value.mode),
    status: status(value.status),
    version: positive(value.version),
    priceCents: count(value.priceCents, 1000000),
    updatedAt: instant(value.updatedAt),
  };
}
export function classEnrollments(raw: unknown): {
  enrollments: ClassEnrollment[];
} {
  const value = object(raw),
    enrollments = array(value.enrollments, 2000).map(classEnrollment);
  if (
    new Set(enrollments.map((item) => `${item.studentUid}:${item.classId}`))
      .size !== enrollments.length
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return { enrollments };
}

export function classRosterExport(raw: unknown): ClassRosterExport {
  const value = object(raw),
    classId = id(value.classId);
  if (
    value.contentType !== "text/csv" ||
    value.filename !== `tala-class-roster-${classId}.csv` ||
    typeof value.content !== "string" ||
    value.content.length > 2 * 1024 * 1024 ||
    value.content.includes("\0")
  )
    throw new TalaApiError("INVALID_RESPONSE");
  return {
    classId,
    filename: value.filename,
    contentType: "text/csv",
    content: value.content,
    rowCount: count(value.rowCount, 2000),
    exportedAt: instant(value.exportedAt),
  };
}
