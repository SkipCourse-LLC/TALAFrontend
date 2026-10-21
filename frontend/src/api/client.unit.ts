import { expect, test } from "@playwright/test";
import { createTalaApi, fingerprintEvidenceFile } from "./client";
import type { User } from "./types";

const learner: User = {
  uid: "learner-id",
  name: "Synthetic learner",
  email: "learner@example.test",
  role: "student",
  emailVerified: false,
};
const session = (user: User | null = learner, nonce = "a".repeat(43)) => ({
  session: user,
  csrfToken: nonce,
});

test("one aborted StrictMode consumer cannot poison the shared session bootstrap", async () => {
  let resolve: ((response: Response) => void) | undefined;
  let requests = 0;
  const api = createTalaApi({
    fetcher: async () => {
      requests++;
      return new Promise<Response>((done) => {
        resolve = done;
      });
    },
  });
  const first = new AbortController();
  const discarded = api.getSession(first.signal);
  first.abort();
  const remount = api.getSession(new AbortController().signal);
  resolve?.(Response.json(session()));
  await expect(discarded).rejects.toMatchObject({ code: "CANCELLED" });
  expect(await remount).toEqual(learner);
  expect(requests).toBe(1);
});

test("successful authentication rotates the in-memory CSRF token for subsequent writes", async () => {
  const api = createTalaApi({
    fetcher: async (input, init) => {
      if (input === "/api/session") return Response.json(session(null));
      if (input === "/api/auth/register") {
        expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(
          "a".repeat(43),
        );
        return Response.json(session(learner, "b".repeat(43)));
      }
      if (input === "/api/profile") {
        expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(
          "b".repeat(43),
        );
        expect(new Headers(init?.headers).get("X-TALA-User")).toBe(learner.uid);
        return Response.json({ ...learner, name: "Updated synthetic learner" });
      }
      throw new Error("Unexpected request");
    },
  });
  expect(
    (
      await api.register({
        name: learner.name,
        email: learner.email,
        password: "Synthetic-only-password",
        accountType: "student",
      })
    ).uid,
  ).toBe(learner.uid);
  expect(
    (await api.updateProfile({ name: "Updated synthetic learner" })).name,
  ).toBe("Updated synthetic learner");
  await expect(
    api.register({
      name: learner.name,
      email: learner.email,
      password: "Synthetic-only-password",
      accountType: "student",
    }),
  ).rejects.toMatchObject({ code: "ACTIVE_SESSION" });
});

test("workspace responses cannot substitute another student's private records", async () => {
  const api = createTalaApi({
    fetcher: async (input) =>
      input === "/api/session"
        ? Response.json(session())
        : Response.json({
            slots: [],
            appointments: [
              {
                id: "booking",
                ownerUid: "other-learner",
                slotId: "slot",
                startsAt: "2026-10-21T10:00:00.000Z",
                endsAt: "2026-10-21T11:00:00.000Z",
                status: "reserved",
                meetingIntegration: "unavailable",
                updatedAt: "2026-10-21T09:00:00.000Z",
              },
            ],
            activeAppointments: [],
            evidence: [],
            progress: {
              submittedEvidenceCount: 0,
              reviewedEvidenceCount: 0,
              assessedEvidenceCount: 0,
              acknowledgedOutcomeCount: 0,
              masteryStatus: "unavailable",
            },
          }),
  });
  await expect(api.getWorkspace()).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});

test("authenticated GET requests bind the displayed actor to the shared server cookie", async () => {
  let requested = false;
  const api = createTalaApi({
    fetcher: async (input, init) => {
      if (input === "/api/session") return Response.json(session());
      requested = true;
      expect(new Headers(init?.headers).get("X-TALA-User")).toBe(learner.uid);
      // The real server compares this UI intent with its current cookie session.
      return Response.json(
        {
          error: {
            code: "AUTH_REQUIRED",
            message: "The account changed in another tab.",
          },
        },
        { status: 401 },
      );
    },
  });
  await expect(api.getLearningRecords()).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
  });
  expect(requested).toBe(true);
});

test("a matching uploaded file resumes submission without uploading its bytes again", async () => {
  const file = new File(["Synthetic evidence"], "sample.txt", {
    type: "text/plain",
  });
  const sha256 = await fingerprintEvidenceFile(file);
  let puts = 0;
  const api = createTalaApi({
    fetcher: async (input, init) => {
      if (input === "/api/session") return Response.json(session());
      if (init?.method === "PUT") puts++;
      return Response.json({
        uploadId: "upload-id",
        status: "uploaded",
        sha256,
        size: file.size,
        contentType: file.type,
      });
    },
  });
  const value = await api.uploadEvidenceFile(
    {
      uploadId: "upload-id",
      sha256,
      maxBytes: 5242880,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    file,
  );
  expect(value.status).toBe("uploaded");
  expect(puts).toBe(0);
});

test("private downloads become Blobs only after exact size, type and checksum validation", async () => {
  const file = new File(["Synthetic private file"], "sample.txt", {
    type: "text/plain",
  });
  const sha256 = await fingerprintEvidenceFile(file);
  let corrupt = false;
  const api = createTalaApi({
    fetcher: async (input) => {
      if (input === "/api/session") return Response.json(session());
      return new Response(await file.arrayBuffer(), {
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": String(file.size),
          "Content-Disposition": 'attachment; filename="ignored-safe-name.txt"',
          "X-Content-SHA256": corrupt ? "0".repeat(64) : sha256,
        },
      });
    },
  });
  const download = await api.downloadEvidence("evidence-id");
  expect(await download.blob.text()).toBe("Synthetic private file");
  expect(download.filename).toBe("evidence-evidence-id.txt");
  corrupt = true;
  await expect(api.downloadEvidence("evidence-id")).rejects.toMatchObject({
    code: "INTEGRITY_ERROR",
  });
});
