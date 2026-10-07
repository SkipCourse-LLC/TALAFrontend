import { demoDelay } from "../shared/services/demoDelay";

export const enrollmentSteps = [
  "Parent account",
  "Student information",
  "Enrollment information",
  "Required documents",
  "Funding preference",
  "Review",
] as const;
export const enrollmentOptions = Object.freeze({
  intent: Object.freeze(["Enrollment", "Waiting list"] as const),
  learningMode: Object.freeze(["In-Person", "Online", "Hybrid"] as const),
  timeBlock: Object.freeze([
    "6–8 AM",
    "8–10 AM",
    "10 AM–12 PM",
    "12–2 PM",
    "2–4 PM",
    "4–6 PM",
  ] as const),
  funding: Object.freeze(["ESA", "STO", "Private"] as const),
});
export interface EnrollmentDraft {
  parentName: string;
  parentEmail: string;
  password: string;
  confirmPassword: string;
  studentName: string;
  studentEmail: string;
  learningMode: string;
  timeBlock: string;
  intent: string;
  documentsAcknowledged: boolean;
  funding: string;
  fundingAcknowledged: boolean;
}
// Frontend context only. No credential, document or payment instrument is retained.
export interface EnrollmentReceipt {
  parentName: string;
  parentEmail: string;
  studentName: string;
  studentEmail: string;
  funding?: (typeof enrollmentOptions.funding)[number];
  learningMode?: (typeof enrollmentOptions.learningMode)[number];
  timeBlock?: (typeof enrollmentOptions.timeBlock)[number];
  intent?: (typeof enrollmentOptions.intent)[number];
}
export type EnrollmentErrors = Partial<Record<keyof EnrollmentDraft, string>>;
function emailIsValid(value: string): boolean {
  return (
    value.trim().length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}
export function validateEnrollment(
  draft: EnrollmentDraft,
  step: number,
): EnrollmentErrors {
  const errors: EnrollmentErrors = {};
  if (step === 0) {
    if (!draft.parentName.trim())
      errors.parentName = "Enter a sample parent name.";
    else if (draft.parentName.trim().length > 80)
      errors.parentName = "Use a parent name with 80 characters or fewer.";
    if (!emailIsValid(draft.parentEmail))
      errors.parentEmail = "Enter a valid sample email.";
    if (draft.password.length < 8)
      errors.password = "Use a made-up password with at least 8 characters.";
    else if (draft.password.length > 128)
      errors.password = "Use 128 characters or fewer.";
    if (draft.password !== draft.confirmPassword)
      errors.confirmPassword = "Passwords must match.";
  }
  if (step === 1) {
    if (!draft.studentName.trim())
      errors.studentName = "Enter a sample student name.";
    else if (draft.studentName.trim().length > 80)
      errors.studentName = "Use a student name with 80 characters or fewer.";
    if (!emailIsValid(draft.studentEmail))
      errors.studentEmail = "Enter a valid sample student email.";
  }
  if (step === 2) {
    if (!enrollmentOptions.intent.some((value) => value === draft.intent))
      errors.intent = "Choose enrollment or waiting list.";
    if (
      !enrollmentOptions.learningMode.some(
        (value) => value === draft.learningMode,
      )
    )
      errors.learningMode = "Choose a learning preference.";
    if (!enrollmentOptions.timeBlock.some((value) => value === draft.timeBlock))
      errors.timeBlock = "Choose a preferred time block.";
  }
  if (step === 3 && draft.documentsAcknowledged !== true)
    errors.documentsAcknowledged =
      "Please acknowledge that no documents are being submitted.";
  if (step === 4) {
    if (!enrollmentOptions.funding.some((value) => value === draft.funding))
      errors.funding = "Choose a funding preference.";
    if (draft.fundingAcknowledged !== true)
      errors.fundingAcknowledged =
        "Please acknowledge that this is not a payment or funding approval.";
  }
  return errors;
}
type EnrollmentErrorCode =
  "UNAVAILABLE" | "INVALID_DRAFT" | "SUBMISSION_FAILED";
const messages: Record<EnrollmentErrorCode, string> = {
  UNAVAILABLE:
    "Registration is unavailable in this preview. Please try again when the service is connected.",
  INVALID_DRAFT: "Please check each registration step.",
  SUBMISSION_FAILED:
    "The demo could not complete. Your entries are still here. Uncheck the test error and retry.",
};
export class EnrollmentError extends Error {
  readonly code: EnrollmentErrorCode;
  constructor(code: EnrollmentErrorCode) {
    super(messages[code]);
    this.name = "EnrollmentError";
    this.code = code;
  }
}
export function enrollmentErrorMessage(error: unknown): string {
  return error instanceof EnrollmentError && Object.hasOwn(messages, error.code)
    ? messages[error.code]
    : "Registration could not complete. Your entries are still here. Please try again.";
}
export interface EnrollmentService {
  submit(
    draft: EnrollmentDraft,
    simulateError?: boolean,
    signal?: AbortSignal,
  ): Promise<EnrollmentReceipt>;
}
export interface MockEnrollmentOptions {
  enabled?: boolean;
  delayMs?: number;
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}
export function createMockEnrollmentService(
  options: MockEnrollmentOptions = {},
): EnrollmentService {
  const wait = options.delay ?? demoDelay;
  return {
    async submit(draft, simulateError, signal) {
      signal?.throwIfAborted();
      if (options.enabled === false) throw new EnrollmentError("UNAVAILABLE");
      // Capture allowlisted fields before waiting; later caller mutations and
      // unknown extra properties cannot enter the completed receipt.
      const snapshot: EnrollmentDraft = {
        parentName: draft.parentName,
        parentEmail: draft.parentEmail,
        password: draft.password,
        confirmPassword: draft.confirmPassword,
        studentName: draft.studentName,
        studentEmail: draft.studentEmail,
        learningMode: draft.learningMode,
        timeBlock: draft.timeBlock,
        intent: draft.intent,
        documentsAcknowledged: draft.documentsAcknowledged,
        funding: draft.funding,
        fundingAcknowledged: draft.fundingAcknowledged,
      };
      if (
        [0, 1, 2, 3, 4].some(
          (step) => Object.keys(validateEnrollment(snapshot, step)).length,
        )
      )
        throw new EnrollmentError("INVALID_DRAFT");
      await wait(options.delayMs ?? 700, signal);
      signal?.throwIfAborted();
      if (simulateError) throw new EnrollmentError("SUBMISSION_FAILED");
      return {
        parentName: snapshot.parentName.trim(),
        parentEmail: snapshot.parentEmail.trim(),
        studentName: snapshot.studentName.trim(),
        studentEmail: snapshot.studentEmail.trim(),
        funding: snapshot.funding as EnrollmentReceipt["funding"],
        learningMode:
          snapshot.learningMode as EnrollmentReceipt["learningMode"],
        timeBlock: snapshot.timeBlock as EnrollmentReceipt["timeBlock"],
        intent: snapshot.intent as EnrollmentReceipt["intent"],
      };
    },
  };
}
