import type { AdmissionApplication } from "../../api/admissionsContract";

type Appointment = NonNullable<AdmissionApplication["appointment"]>;

/** What the family reads about joining their interview. Never shows a link that is not ready. */
export function familyMeetingNote(appointment: Appointment): {
  joinUrl: string | null;
  meeting: string;
  email: string;
} {
  const status = appointment.meeting?.status ?? "unavailable";
  const joinUrl =
    status === "ready" ? (appointment.meeting?.joinUrl ?? null) : null;
  const meeting = joinUrl
    ? "Join by video with this link at your interview time."
    : status === "pending"
      ? "Your video link is still being prepared. TALA will email it to you."
      : status === "failed"
        ? "Your video link could not be created yet. TALA will send it before your interview."
        : "TALA will tell you how to join before your interview.";
  const emailStatus = appointment.confirmationEmail ?? "unavailable";
  const email =
    emailStatus === "sent"
      ? "A confirmation email is on its way."
      : emailStatus === "failed"
        ? "We could not send a confirmation email, but your booking is saved."
        : "";
  return { joinUrl, meeting, email };
}

/** What staff read about the interview's video link and confirmation email. */
export function staffMeetingNote(appointment: Appointment): {
  joinUrl: string | null;
  summary: string;
} {
  if (appointment.status !== "reserved")
    return { joinUrl: null, summary: "Cancelled." };
  const meeting = appointment.meeting?.status ?? "unavailable";
  const joinUrl =
    meeting === "ready" ? (appointment.meeting?.joinUrl ?? null) : null;
  const meetingText = {
    ready: "Video link ready.",
    pending: "Video link still being prepared by Google.",
    failed: "Video link failed. Send one to the family manually.",
    unavailable: "Video links are not connected.",
  }[meeting];
  const emailText = {
    sent: "Confirmation email sent.",
    failed: "Confirmation email failed. Contact the family.",
    unavailable: "Email is not connected.",
  }[appointment.confirmationEmail ?? "unavailable"];
  return { joinUrl, summary: `${meetingText} ${emailText}` };
}
