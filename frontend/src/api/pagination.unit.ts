import { expect, test } from "@playwright/test";
import { createTalaApi } from "./client";
import { cursorPage, learningRecords } from "./decoders";
const booking = {
  id: "old-booking",
  ownerUid: "learner-id",
  slotId: "old-slot",
  startsAt: "2025-01-01T12:00:00.000Z",
  endsAt: "2025-01-01T12:30:00.000Z",
  status: "ended",
  meetingIntegration: "unavailable",
  updatedAt: "2025-01-01T12:30:00.000Z",
};
const opaqueCursor = `opaque_cursor.${"s".repeat(43)}`;
const session = {
  session: {
    uid: "learner-id",
    name: "Synthetic learner",
    email: "learner@example.test",
    role: "student",
    emailVerified: false,
  },
  csrfToken: "n".repeat(43),
};

test("history pages retain opaque cursors and exact server filters without local re-slicing", async () => {
  const calls: string[] = [];
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session);
      calls.push(String(path));
      expect(new Headers(init?.headers).get("X-TALA-User")).toBe("learner-id");
      const url = new URL(String(path), "http://localhost");
      if (url.pathname === "/api/appointments")
        return Response.json({
          items: [booking],
          nextCursor: opaqueCursor,
        });
      expect(url.pathname).toBe("/api/evidence");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        reviewStatus: "needs_revision",
        currentOnly: "true",
        q: "literal 100%_work",
        cursor: opaqueCursor,
      });
      return Response.json({ items: [], nextCursor: null });
    },
  });
  const first = await api.getAppointmentsPage({ status: "ended" });
  expect(first.items[0]?.id).toBe("old-booking");
  await api.getEvidencePage({
    reviewStatus: "needs_revision",
    currentOnly: true,
    q: "  literal 100%_work  ",
    cursor: first.nextCursor!,
  });
  expect(calls).toHaveLength(2);
});

test("booking history sends exact date bounds and cursors to the authorized server page", async () => {
  const from = "2026-11-01T00:00:00-07:00";
  const to = "2026-11-02T00:00:00-08:00";
  const query = { status: "ended" as const, from, to, cursor: opaqueCursor };
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session);
      expect(new Headers(init?.headers).get("X-TALA-User")).toBe("learner-id");
      const url = new URL(String(path), "http://localhost");
      expect(url.pathname).toBe("/api/appointments");
      expect(Object.fromEntries(url.searchParams)).toEqual(query);
      return Response.json({ items: [booking], nextCursor: null });
    },
  });
  expect((await api.getAppointmentsPage(query)).items).toHaveLength(1);
  expect(query).toEqual({ status: "ended", from, to, cursor: opaqueCursor });
});

test("old booking detail rejects a substituted ID or another student's record", async () => {
  let mode = 0;
  const api = createTalaApi({
    fetcher: async (path) =>
      path === "/api/session"
        ? Response.json(session)
        : Response.json(
            mode === 0
              ? booking
              : mode === 1
                ? { ...booking, id: "other-id" }
                : { ...booking, ownerUid: "another-student" },
          ),
  });
  expect((await api.getAppointment(booking.id)).id).toBe(booking.id);
  mode = 1;
  await expect(api.getAppointment(booking.id)).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
  mode = 2;
  await expect(api.getAppointment(booking.id)).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});

test("bounded page decoders refuse duplicate identities, false continuation and unbounded learning payloads", () => {
  const parse = (raw: unknown) => raw as { id: string };
  expect(() =>
    cursorPage(
      { items: [{ id: "one" }, { id: "one" }], nextCursor: null },
      parse,
    ),
  ).toThrow();
  expect(() =>
    cursorPage({ items: [], nextCursor: opaqueCursor }, parse),
  ).toThrow();
  expect(() =>
    cursorPage(
      { items: [{ id: "one" }], nextCursor: "https://external.invalid" },
      parse,
    ),
  ).toThrow();
  expect(() =>
    learningRecords({
      records: Array(26).fill({}),
      integrations: { zoom: "unavailable", ai: "unavailable" },
      nextCursor: null,
    }),
  ).toThrow();
});
