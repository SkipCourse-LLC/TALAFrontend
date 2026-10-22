import { expect, test } from "@playwright/test";
import { createTalaApi } from "./client";
import type { ContactRequestInput, User } from "./types";

const operator: User = {
  uid: "operator-id",
  name: "Synthetic staff",
  email: "staff@example.test",
  role: "operator",
  emailVerified: false,
};
const session = (user: User | null, nonce = "a".repeat(43)) => ({
  session: user,
  csrfToken: nonce,
});
const request: ContactRequestInput = {
  parentName: "Synthetic Parent",
  email: "parent@example.test",
  phone: "(520) 555-0100",
  preferredMethod: "email",
  availability: [{ day: "monday", startTime: "09:00", endTime: "12:00" }],
  requestId: "synthetic-request-0001",
};

test("T3-47 the public calendar is read without a session and rejects malformed times", async () => {
  const paths: string[] = [];
  const time = {
    id: "slot-id",
    startsAt: "2027-01-05T17:00:00.000Z",
    endsAt: "2027-01-05T17:30:00.000Z",
  };
  let body: unknown = {
    times: [time],
    hasMore: false,
    timeZone: "America/Phoenix",
  };
  const api = createTalaApi({
    fetcher: async (path) => {
      paths.push(String(path));
      return Response.json(body);
    },
  });
  await expect(api.getPublicOpenTimes()).resolves.toEqual({
    times: [time],
    hasMore: false,
    timeZone: "America/Phoenix",
  });
  expect(paths).toEqual(["/api/public/open-times"]);
  body = {
    times: [{ ...time, endsAt: time.startsAt }],
    hasMore: false,
    timeZone: "America/Phoenix",
  };
  await expect(api.getPublicOpenTimes()).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});

test("T3-51 a contact request sends the anonymous CSRF token and returns only the receipt", async () => {
  const sent: Array<{ path: string; csrf: string | null; body: unknown }> = [];
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session(null));
      sent.push({
        path: String(path),
        csrf: new Headers(init?.headers).get("X-CSRF-Token"),
        body: JSON.parse(String(init?.body)),
      });
      return Response.json(
        {
          id: "receipt-id",
          status: "received",
          receivedAt: "2026-10-21T18:00:00.000Z",
        },
        { status: 201 },
      );
    },
  });
  await expect(api.submitContactRequest(request)).resolves.toEqual({
    id: "receipt-id",
    status: "received",
    receivedAt: "2026-10-21T18:00:00.000Z",
  });
  expect(sent).toEqual([
    { path: "/api/contact-requests", csrf: "a".repeat(43), body: request },
  ]);
});

test("T3-53 a contact request is never reported as sent without a valid receipt", async () => {
  let reply: () => Response = () =>
    Response.json(
      { error: { code: "RATE_LIMITED", message: "x" } },
      { status: 429 },
    );
  const api = createTalaApi({
    fetcher: async (path) =>
      path === "/api/session" ? Response.json(session(null)) : reply(),
  });
  await expect(api.submitContactRequest(request)).rejects.toMatchObject({
    code: "RATE_LIMITED",
  });
  reply = () => Response.json({ id: "receipt-id", status: "pending" });
  await expect(api.submitContactRequest(request)).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
  reply = () => new Response("<html>proxy error</html>", { status: 502 });
  await expect(api.submitContactRequest(request)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
});

test("T3-46 an availability edit is confirmed only when the server returns the new times", async () => {
  const slot = (startsAt: string, endsAt: string, id = "new-slot-id") => ({
    id,
    startsAt,
    endsAt,
    label: "Advising meeting",
    isAvailable: true,
    status: "available",
    canWithdraw: true,
  });
  let saved = slot("2027-01-05T18:00:00.000Z", "2027-01-05T18:45:00.000Z");
  const methods: string[] = [];
  const api = createTalaApi({
    fetcher: async (path, init) => {
      if (path === "/api/session") return Response.json(session(operator));
      methods.push(`${init?.method} ${String(path)}`);
      return Response.json(saved);
    },
  });
  const input = {
    startsAt: "2027-01-05T18:00:00.000Z",
    endsAt: "2027-01-05T18:45:00.000Z",
    requestId: "synthetic-edit-0001",
  };
  await expect(
    api.updateAvailability("old-slot-id", input),
  ).resolves.toMatchObject({
    id: "new-slot-id",
  });
  expect(methods).toEqual(["PATCH /api/availability/old-slot-id"]);
  saved = slot("2027-01-05T17:00:00.000Z", "2027-01-05T17:30:00.000Z");
  await expect(
    api.updateAvailability("old-slot-id", input),
  ).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});

test("T3-54 operator contact request reads and status changes are decoded strictly", async () => {
  const item = {
    id: "contact-id",
    parentName: "Synthetic Parent",
    email: "parent@example.test",
    phone: "(520) 555-0100",
    preferredMethod: "phone",
    availability: [{ day: "monday", startTime: "09:00", endTime: "12:00" }],
    timeZone: "America/Phoenix",
    status: "new",
    receivedAt: "2026-10-21T18:00:00.000Z",
    updatedAt: "2026-10-21T18:00:00.000Z",
  };
  let status = "contacted";
  const paths: string[] = [];
  const api = createTalaApi({
    fetcher: async (path) => {
      if (path === "/api/session") return Response.json(session(operator));
      paths.push(String(path));
      if (String(path).endsWith("/status"))
        return Response.json({ ...item, status });
      return Response.json({ items: [item], nextCursor: null });
    },
  });
  const page = await api.getContactRequestsPage({ status: "new" });
  expect(page.items[0]).toEqual(item);
  await expect(
    api.setContactRequestStatus("contact-id", {
      status: "contacted",
      requestId: "synthetic-status-0001",
    }),
  ).resolves.toMatchObject({ status: "contacted" });
  status = "new";
  await expect(
    api.setContactRequestStatus("contact-id", {
      status: "closed",
      requestId: "synthetic-status-0002",
    }),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  expect(paths[0]).toBe("/api/operations/contact-requests?status=new");
});
