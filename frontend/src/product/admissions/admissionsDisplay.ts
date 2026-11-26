import type { AdmissionStatus } from "../../api";

export const admissionStatusLabel: Record<AdmissionStatus, string> = {
  pending_interview: "Pending interview",
  interview_scheduled: "Interview booked",
  interviewed: "Ready for a decision",
  approved: "Approved",
  declined: "Declined",
  enrolled: "Account created",
};
