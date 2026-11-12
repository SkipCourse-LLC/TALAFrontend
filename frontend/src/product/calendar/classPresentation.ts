import type { CalendarClass } from "../../api/calendarContract";
import { phoenixDateKey } from "./calendarDates";

export const categoryLabels = {
  coursework: "Coursework",
  live_sessions: "Live sessions",
  learning_support: "Learning support",
  clubs_activities: "Clubs & activities",
  holidays: "Holidays & closures",
} as const;

export function classStatus(course: CalendarClass): string {
  switch (course.enrollmentStatus) {
    case "pending_approval":
      return "Awaiting parent";
    case "pending_payment":
      return "Payment required";
    case "confirmed":
      return "Confirmed";
    case "waitlisted":
      return "Waiting list";
    case "declined":
      return "Declined";
    case "cancelled":
      return "Cancelled";
    default:
      return course.enrolled
        ? "Saved · practice"
        : course.seatsAvailable === 0
          ? "Full · waiting list"
          : "Open for requests";
  }
}
export function modeLabel(mode: string): string {
  return mode === "in_person" ? "In person" : "Online";
}
export function classPrice(course: CalendarClass | number): string {
  const priceCents =
    typeof course === "number" ? course : (course.priceCents ?? 0);
  return priceCents
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(priceCents / 100)
    : "No fee";
}

export const enrollmentStatusLabel: Record<string, string> = {
  pending_approval: "Needs parent approval",
  pending_payment: "Awaiting payment",
  confirmed: "Confirmed",
  waitlisted: "Waiting list",
  declined: "Declined",
  cancelled: "Cancelled",
  enrolled: "Saved test class",
};

export function classSchedule(startsAt: string, endsAt: string) {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    hour: "numeric",
    minute: "2-digit",
  });
  const endDate =
    phoenixDateKey(startsAt) === phoenixDateKey(endsAt)
      ? ""
      : `${day.format(new Date(endsAt))}, `;
  return `${day.format(new Date(startsAt))}, ${time.format(new Date(startsAt))}–${endDate}${time.format(new Date(endsAt))} MST`;
}
export function statusExplanation(course: CalendarClass): string {
  switch (course.enrollmentStatus) {
    case "pending_approval":
      return "Your request is saved. A linked parent must approve it before your place is confirmed.";
    case "pending_payment":
      return "Your parent approved this request. Payment is still required. Contact TALA for payment instructions; your place is confirmed after payment is verified.";
    case "confirmed":
      return "Your place is confirmed. Check the location and any instructions before class.";
    case "waitlisted":
      return "You are on the waiting list. This is not a confirmed place; TALA will review availability.";
    case "declined":
      return "Your parent declined this request. Talk with them before requesting again.";
    case "cancelled":
      return "This request was cancelled. You can request again while enrollment is open.";
    default:
      return course.source === "test_catalog"
        ? "Practice class only. This does not create school registration, attendance or credit."
        : "Choose how to attend, then send a request to your parent. Paid classes remain unconfirmed until payment is verified.";
  }
}
