import type {
  ContactMethod,
  ContactRequestInput,
  ContactWindow,
  Weekday,
} from "../api";

/** Same field rules as server/contactRequests.cjs; the server stays authoritative. */
export const weekdays: ReadonlyArray<{ id: Weekday; label: string }> = [
  { id: "monday", label: "Monday" },
  { id: "tuesday", label: "Tuesday" },
  { id: "wednesday", label: "Wednesday" },
  { id: "thursday", label: "Thursday" },
  { id: "friday", label: "Friday" },
  { id: "saturday", label: "Saturday" },
  { id: "sunday", label: "Sunday" },
];
export const timeWindows = [
  { id: "morning", label: "Morning", startTime: "08:00", endTime: "12:00" },
  { id: "afternoon", label: "Afternoon", startTime: "12:00", endTime: "17:00" },
  { id: "evening", label: "Evening", startTime: "17:00", endTime: "20:00" },
] as const;
export type TimeWindowId = (typeof timeWindows)[number]["id"];
export const contactMethods: ReadonlyArray<{
  id: ContactMethod;
  label: string;
}> = [
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone call" },
  { id: "text", label: "Text message" },
];

export interface ContactDraft {
  /** Keys are `${day}:${window}` for each chosen box. */
  windows: string[];
  preferredMethod: ContactMethod | "";
  parentName: string;
  email: string;
  phone: string;
  notes: string;
}
export type ContactField = Exclude<keyof ContactDraft, "windows"> | "windows";
export type ContactErrors = Partial<Record<ContactField, string>>;
export const emptyContactDraft: ContactDraft = {
  windows: [],
  preferredMethod: "",
  parentName: "",
  email: "",
  phone: "",
  notes: "",
};

export const windowKey = (day: Weekday, window: TimeWindowId) =>
  `${day}:${window}`;

export function contactWindows(draft: ContactDraft): ContactWindow[] {
  return weekdays.flatMap((day) =>
    timeWindows
      .filter((window) => draft.windows.includes(windowKey(day.id, window.id)))
      .map((window) => ({
        day: day.id,
        startTime: window.startTime,
        endTime: window.endTime,
      })),
  );
}

export function validateAvailability(draft: ContactDraft): ContactErrors {
  return contactWindows(draft).length
    ? {}
    : { windows: "Choose at least one day and time." };
}
export function validateMethod(draft: ContactDraft): ContactErrors {
  return draft.preferredMethod
    ? {}
    : { preferredMethod: "Choose how TALA should contact you." };
}
export function validateDetails(draft: ContactDraft): ContactErrors {
  const errors: ContactErrors = {};
  const name = draft.parentName.trim();
  if (!name) errors.parentName = "Enter your name.";
  else if (name.length > 80 || /\p{Cc}/u.test(name))
    errors.parentName = "Use 80 characters or fewer.";
  const email = draft.email.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = "Enter an email address like name@example.com.";
  const phone = draft.phone.trim();
  const digits = phone.replace(/\D/g, "").length;
  if (
    phone.length > 30 ||
    !/^[0-9+().\s-]+$/.test(phone) ||
    digits < 10 ||
    digits > 15
  )
    errors.phone = "Enter a phone number with area code, like 520-555-0100.";
  if (draft.notes.trim().length > 1000)
    errors.notes = "Use 1,000 characters or fewer.";
  return errors;
}
export function validateContactDraft(draft: ContactDraft): ContactErrors {
  return {
    ...validateAvailability(draft),
    ...validateMethod(draft),
    ...validateDetails(draft),
  };
}

export function contactRequestInput(
  draft: ContactDraft,
  requestId: string,
): ContactRequestInput {
  if (!draft.preferredMethod) throw new Error("A contact method is required.");
  const notes = draft.notes.trim();
  return {
    parentName: draft.parentName.trim(),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    preferredMethod: draft.preferredMethod,
    availability: contactWindows(draft),
    ...(notes ? { notes } : {}),
    requestId,
  };
}

export function windowLabel(window: ContactWindow): string {
  const day = weekdays.find((item) => item.id === window.day)?.label ?? "";
  const preset = timeWindows.find(
    (item) =>
      item.startTime === window.startTime && item.endTime === window.endTime,
  );
  return preset
    ? `${day} ${preset.label.toLowerCase()} (${clockLabel(window.startTime)}–${clockLabel(window.endTime)})`
    : `${day} ${clockLabel(window.startTime)}–${clockLabel(window.endTime)}`;
}
export function clockLabel(value: string): string {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 || 12;
  return minute
    ? `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`
    : `${twelve} ${suffix}`;
}
