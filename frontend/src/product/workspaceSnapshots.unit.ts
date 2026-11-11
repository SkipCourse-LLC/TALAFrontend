import { expect, test } from "@playwright/test";
import type { ApiAppointment, ApiEvidence } from "../api";
import {
  mergeAppointmentSnapshots,
  mergeEvidenceSnapshots,
} from "./workspaceSnapshots";

const booking: ApiAppointment = {
  id: "synthetic-booking",
  ownerUid: "synthetic-learner",
  slotId: "synthetic-slot",
  startsAt: "2026-10-30T21:30:00.000Z",
  endsAt: "2026-10-30T22:00:00.000Z",
  status: "reserved",
  meetingIntegration: "unavailable",
  updatedAt: "2026-10-28T20:00:00.000Z",
};
const work: ApiEvidence = {
  id: "synthetic-work",
  rootEvidenceId: "synthetic-work",
  ownerUid: booking.ownerUid,
  appointmentId: booking.id,
  title: "Synthetic reflection",
  contentType: "text/plain",
  size: 1,
  sha256: "0".repeat(64),
  status: "submitted",
  reviewStatus: "needs_revision",
  reviewVersion: 1,
  revisionNumber: 1,
  submittedAt: booking.updatedAt,
};

test("a newer cancellation wins regardless of arrival order and keeps its identity", () => {
  const cancelled: ApiAppointment = {
    ...booking,
    status: "cancelled",
    updatedAt: "2026-10-28T20:01:00.000Z",
  };
  expect(mergeAppointmentSnapshots([booking, cancelled])).toEqual([cancelled]);
  expect(mergeAppointmentSnapshots([cancelled, booking])).toEqual([cancelled]);
  expect(booking.status).toBe("reserved");
});

test("a fresh source resolves an equal-timestamp booking without dropping other records", () => {
  const cancelled: ApiAppointment = { ...booking, status: "cancelled" };
  const other = { ...booking, id: "synthetic-other-booking" };
  expect(mergeAppointmentSnapshots([booking, other, cancelled])).toEqual([
    cancelled,
    other,
  ]);
});

test("a later review cannot be replaced by a pinned needs-revision snapshot", () => {
  const reviewed: ApiEvidence = {
    ...work,
    reviewStatus: "reviewed",
    reviewVersion: 2,
  };
  expect(mergeEvidenceSnapshots([work, reviewed])).toEqual([reviewed]);
  expect(mergeEvidenceSnapshots([reviewed, work])).toEqual([reviewed]);
});

test("a known successor survives equal or newer review versions and input order", () => {
  const superseded = { ...work, supersededByEvidenceId: "synthetic-successor" };
  const reviewed: ApiEvidence = {
    ...work,
    reviewStatus: "reviewed",
    reviewVersion: 2,
  };
  expect(mergeEvidenceSnapshots([superseded, work])).toEqual([superseded]);
  expect(mergeEvidenceSnapshots([work, superseded])).toEqual([superseded]);
  expect(mergeEvidenceSnapshots([superseded, reviewed])).toEqual([
    { ...reviewed, supersededByEvidenceId: superseded.supersededByEvidenceId },
  ]);
  expect(work.supersededByEvidenceId).toBeUndefined();
});
