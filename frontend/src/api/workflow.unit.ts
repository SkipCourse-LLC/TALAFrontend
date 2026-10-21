import { expect, test } from "@playwright/test";
import { createTalaApi } from "./client";
import { evidence, operations, progress } from "./decoders";
import type { Evidence, ManagedSlot, User } from "./types";

const operator: User = {
  uid: "operator-id",
  name: "Synthetic staff",
  email: "staff@example.test",
  role: "operator",
  emailVerified: false,
};
const record: Evidence = {
  id: "evidence-id",
  ownerUid: "student-id",
  appointmentId: "booking-id",
  title: "Synthetic reflection",
  contentType: "text/plain",
  size: 20,
  sha256: "a".repeat(64),
  status: "submitted",
  reviewStatus: "needs_revision",
  submittedAt: "2026-10-21T12:00:00.000Z",
  revisionNumber: 1,
  rootEvidenceId: "evidence-id",
  reviewVersion: 12,
};
const meeting: ManagedSlot = {
  id: "slot-id",
  startsAt: "2099-10-22T06:30:00.000Z",
  endsAt: "2099-10-22T07:00:00.000Z",
  label: "Synthetic advising",
  isAvailable: true,
  status: "available",
  canWithdraw: true,
};
const sessionResponse = () =>
  Response.json({ session: operator, csrfToken: "n".repeat(43) });

test("manual reviews send the observed version and cannot confirm a stale response", async () => {
  let staleResponse = false;
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return sessionResponse();
      expect(path).toBe("/api/evidence/evidence-id/review");
      expect(new Headers(init?.headers).get("X-TALA-User")).toBe(operator.uid);
      expect(JSON.parse(String(init?.body))).toEqual({
        status: "reviewed",
        note: "Clear explanation.",
        requestId: "same-request-identifier",
        expectedReviewVersion: 12,
      });
      return Response.json({
        ...record,
        reviewStatus: "reviewed",
        reviewVersion: staleResponse ? 12 : 1720000000000,
      });
    },
  });
  const input = {
    status: "reviewed" as const,
    note: "Clear explanation.",
    requestId: "same-request-identifier",
    expectedReviewVersion: 12,
  };
  expect((await api.reviewEvidence(record.id, input)).reviewVersion).toBe(
    1720000000000,
  );
  staleResponse = true;
  await expect(api.reviewEvidence(record.id, input)).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});

test("availability management preserves exact times and refuses substituted withdrawal responses", async () => {
  let wrongSlot = false;
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return sessionResponse();
      if (path === "/api/availability" && init?.method === "GET")
        return Response.json({
          slots: [meeting],
          hasMore: false,
          nextCursor: null,
        });
      expect(path).toBe("/api/availability/slot-id/withdraw");
      expect(init?.method).toBe("POST");
      return Response.json({
        ...meeting,
        id: wrongSlot ? "another-slot" : meeting.id,
        status: "withdrawn",
        isAvailable: false,
        canWithdraw: false,
      });
    },
  });
  expect((await api.getAvailability()).slots[0]?.endsAt).toBe(meeting.endsAt);
  expect(
    (
      await api.withdrawAvailability(meeting.id, {
        requestId: "withdraw-request-id",
      })
    ).status,
  ).toBe("withdrawn");
  wrongSlot = true;
  await expect(
    api.withdrawAvailability(meeting.id, { requestId: "withdraw-request-id" }),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("a revision intent retains its predecessor and detail reads bind the requested evidence ID", async () => {
  let substitute = false;
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return sessionResponse();
      if (path === "/api/evidence/uploads") {
        expect(JSON.parse(String(init?.body)).revisesEvidenceId).toBe(
          record.id,
        );
        return Response.json({
          uploadId: "revision-upload",
          expiresAt: "2099-10-22T07:00:00.000Z",
          maxBytes: 5242880,
          sha256: record.sha256,
        });
      }
      return Response.json({
        ...record,
        ...(substitute ? { id: "other-id", rootEvidenceId: "other-id" } : {}),
      });
    },
  });
  await api.createEvidenceUpload({
    appointmentId: record.appointmentId,
    title: "Revised reflection",
    contentType: "text/plain",
    size: 20,
    sha256: record.sha256,
    requestId: "revision-request-id",
    revisesEvidenceId: record.id,
  });
  expect((await api.getEvidence(record.id)).reviewVersion).toBe(12);
  substitute = true;
  await expect(api.getEvidence(record.id)).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});

test("version and managed-availability decoders fail closed instead of manufacturing current state", () => {
  expect(() => evidence({ ...record, revisionNumber: 0 })).toThrow();
  expect(() => evidence({ ...record, reviewVersion: undefined })).toThrow();
  expect(() =>
    evidence({ ...record, supersededByEvidenceId: record.id }),
  ).toThrow();
  expect(() =>
    operations({
      appointments: [],
      evidence: [],
      learningRecords: [],
      availability: [{ ...meeting, status: "reserved" }],
      availabilityHasMore: false,
    }),
  ).toThrow();
  const savedProgress = {
    submittedEvidenceCount: 2,
    assessedEvidenceCount: 0,
    reviewedEvidenceCount: 1,
    acknowledgedOutcomeCount: 1,
    revisionSubmissionCount: 1,
    masteryStatus: "unavailable",
  };
  expect(progress(savedProgress).revisionSubmissionCount).toBe(1);
  expect(() =>
    progress({ ...savedProgress, revisionSubmissionCount: undefined }),
  ).toThrow();
});
