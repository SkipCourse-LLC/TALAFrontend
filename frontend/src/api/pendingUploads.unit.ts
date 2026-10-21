import { expect, test } from "@playwright/test";
import { createTalaApi } from "./client";
import { pendingUploads } from "./decoders";
const upload = {
  uploadId: "unfinished-upload",
  appointmentId: "own-appointment",
  title: "Synthetic reflection",
  contentType: "text/plain",
  size: 32,
  sha256: "a".repeat(64),
  status: "uploaded",
  expiresAt: "2099-10-21T12:00:00.000Z",
  revisesEvidenceId: "previous-evidence",
};

test("unfinished upload metadata is bounded and excludes terminal rows or private file paths", () => {
  const saved = pendingUploads({
    uploads: [
      {
        ...upload,
        privatePath: "synthetic-private-path",
        ownerPassword: "placeholder-only",
      },
    ],
  });
  expect(saved.uploads[0]).toEqual(upload);
  expect(() =>
    pendingUploads({ uploads: [{ ...upload, status: "submitted" }] }),
  ).toThrow();
  expect(() =>
    pendingUploads({ uploads: [{ ...upload, size: 5242881 }] }),
  ).toThrow();
  expect(() => pendingUploads({ uploads: [upload, upload] })).toThrow();
  expect(() =>
    pendingUploads({
      uploads: Array.from({ length: 11 }, (_, index) => ({
        ...upload,
        uploadId: `upload-${index}`,
      })),
    }),
  ).toThrow();
});

test("restoring unfinished uploads is an actor-bound read without automatic cleanup or submit", async () => {
  const calls: string[] = [];
  const api = createTalaApi({
    fetcher: async (path, init) => {
      calls.push(String(path));
      if (path === "/api/session")
        return Response.json({
          session: {
            uid: "student-id",
            name: "Synthetic learner",
            email: "learner@example.test",
            role: "student",
            emailVerified: false,
          },
          csrfToken: "n".repeat(43),
        });
      expect(path).toBe("/api/evidence/uploads");
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get("X-TALA-User")).toBe("student-id");
      return Response.json({ uploads: [upload] });
    },
  });
  expect((await api.getPendingUploads()).uploads[0]?.revisesEvidenceId).toBe(
    "previous-evidence",
  );
  expect(calls).toEqual(["/api/session", "/api/evidence/uploads"]);
});
