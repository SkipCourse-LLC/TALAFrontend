import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const nonce = "n".repeat(43);
const anonymous = { session: null, csrfToken: nonce };
const operator = {
  session: {
    uid: "operator-id",
    name: "Synthetic staff",
    email: "staff@example.test",
    role: "operator",
    emailVerified: false,
  },
  csrfToken: nonce,
};
type Handler = (route: Route, url: URL) => Promise<unknown> | unknown;

/** Intercept every API call; anything unexpected is blocked, never proxied. */
async function mockApi(page: Page, handlers: Record<string, Handler>) {
  const unexpected: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const url = new URL(route.request().url());
      const handler = handlers[`${route.request().method()} ${url.pathname}`];
      if (handler) return handler(route, url);
      unexpected.push(`${route.request().method()} ${url.pathname}`);
      return route.abort("blockedbyclient");
    },
  );
  return unexpected;
}

async function fillContactRequest(page: Page) {
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("Choose at least one day and time."),
  ).toBeVisible();
  await page.getByLabel("Tuesday morning (8 am–12 pm)").check();
  await page.getByLabel("Thursday evening (5 pm–8 pm)").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("Choose how TALA should contact you."),
  ).toBeVisible();
  await page.getByLabel("Text message").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Parent or guardian name").fill("Synthetic Parent");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Phone").fill("555");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Enter an email address like/)).toBeVisible();
  await expect(
    page.getByText(/Enter a phone number with area code/),
  ).toBeVisible();
  await page.getByLabel("Email").fill("parent@example.test");
  await page.getByLabel("Phone").fill("520-555-0100");
  await page.getByLabel("Anything we should know?").fill("Synthetic note.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 4 of 4: Review and send")).toBeVisible();
}

test("T3-51 T3-52 a parent completes the Contact me steps and sees success only after the server receipt", async ({
  page,
}) => {
  const bodies: unknown[] = [];
  const unexpected = await mockApi(page, {
    "GET /api/session": (route) => route.fulfill({ json: anonymous }),
    "POST /api/contact-requests": (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        status: 201,
        json: {
          id: "receipt-id",
          status: "received",
          receivedAt: "2026-10-21T18:00:00.000Z",
        },
      });
    },
  });
  await page.goto("/#/contact");
  await expect(
    page.getByRole("heading", { name: "Ask TALA to contact you" }),
  ).toBeVisible();
  await fillContactRequest(page);
  await expect(page.getByText("Tuesday morning (8 am–12 pm)")).toBeVisible();
  await expect(page.getByText("Text message")).toBeVisible();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(
    page.getByRole("heading", { name: "Request sent" }),
  ).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    parentName: "Synthetic Parent",
    email: "parent@example.test",
    phone: "520-555-0100",
    preferredMethod: "text",
    notes: "Synthetic note.",
    availability: [
      { day: "tuesday", startTime: "08:00", endTime: "12:00" },
      { day: "thursday", startTime: "17:00", endTime: "20:00" },
    ],
  });
  expect(unexpected).toEqual([]);
});

test("T3-53 a failed send keeps the answers, shows no success, and retries with the same request ID", async ({
  page,
}) => {
  const ids: string[] = [];
  let fail = true;
  await mockApi(page, {
    "GET /api/session": (route) => route.fulfill({ json: anonymous }),
    "POST /api/contact-requests": (route) => {
      ids.push(route.request().postDataJSON().requestId);
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: { code: "INTERNAL_ERROR", message: "x" } },
        });
      return route.fulfill({
        status: 201,
        json: {
          id: "receipt-id",
          status: "received",
          receivedAt: "2026-10-21T18:00:00.000Z",
        },
      });
    },
  });
  await page.goto("/#/contact");
  await fillContactRequest(page);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your request was not sent.",
  );
  await expect(page.getByRole("heading", { name: "Request sent" })).toHaveCount(
    0,
  );
  await expect(page.getByText("Synthetic Parent")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Request sent" }),
  ).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});

test("T3-47 the public calendar shows open times, an empty state and a retryable error", async ({
  page,
}) => {
  let reply: "times" | "empty" | "error" = "error";
  await mockApi(page, {
    "GET /api/session": (route) => route.fulfill({ json: anonymous }),
    "GET /api/public/open-times": (route) =>
      reply === "error"
        ? route.fulfill({ status: 500, body: "Server error" })
        : route.fulfill({
            json: {
              times:
                reply === "empty"
                  ? []
                  : [
                      {
                        id: "slot-a",
                        startsAt: "2027-01-05T17:00:00.000Z",
                        endsAt: "2027-01-05T17:30:00.000Z",
                      },
                      {
                        id: "slot-b",
                        startsAt: "2027-01-05T20:00:00.000Z",
                        endsAt: "2027-01-05T20:45:00.000Z",
                      },
                    ],
              hasMore: false,
              timeZone: "America/Phoenix",
            },
          }),
  });
  await page.goto("/#/schedule");
  await expect(page.getByRole("alert")).toContainText(
    "Open times could not be loaded.",
  );
  reply = "times";
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Tuesday, January 5" }),
  ).toBeVisible();
  await expect(page.getByText("10:00 AM – 10:30 AM")).toBeVisible();
  await expect(page.getByText("1:00 PM – 1:45 PM")).toBeVisible();
  reply = "empty";
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No open times right now" }),
  ).toBeVisible();
});

test.describe("calendar in UTC", () => {
  test.use({ timezoneId: "UTC" });

  test("calendar day and month follow the API timezone", async ({ page }) => {
    await mockApi(page, {
      "GET /api/session": (route) => route.fulfill({ json: anonymous }),
      "GET /api/public/open-times": (route) =>
        route.fulfill({
          json: {
            times: [
              {
                id: "slot-a",
                startsAt: "2027-01-06T01:00:00.000Z",
                endsAt: "2027-01-06T01:30:00.000Z",
              },
            ],
            hasMore: false,
            timeZone: "America/Phoenix",
          },
        }),
    });
    await page.goto("/#/schedule");
    await expect(
      page.getByRole("heading", { name: "Tuesday, January 5" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "January 2027" })).toBeVisible();
    await expect(page.getByText("6:00 PM – 6:30 PM")).toBeVisible();
  });
});

test("a selected public time sends a contact request and shows success only after its receipt", async ({
  page,
}) => {
  const requests: Array<Record<string, unknown>> = [];
  let accept = false;
  await mockApi(page, {
    "GET /api/session": (route) => route.fulfill({ json: anonymous }),
    "GET /api/public/open-times": (route) =>
      route.fulfill({
        json: {
          times: [
            {
              id: "slot-a",
              startsAt: "2027-01-05T17:00:00.000Z",
              endsAt: "2027-01-05T17:30:00.000Z",
            },
          ],
          hasMore: false,
          timeZone: "America/Phoenix",
        },
      }),
    "POST /api/contact-requests": (route) => {
      requests.push(route.request().postDataJSON());
      return accept
        ? route.fulfill({
            status: 201,
            json: {
              id: "request-receipt",
              status: "received",
              receivedAt: "2026-10-21T18:00:00.000Z",
            },
          })
        : route.fulfill({
            status: 503,
            json: { error: { code: "INTERNAL_ERROR", message: "x" } },
          });
    },
  });

  await page.goto("/#/schedule");
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "10:00 AM – 10:30 AM" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue →" }).click();
  await page.getByLabel("Name *").fill("Synthetic Parent");
  await page.getByLabel("Phone *").fill("520-555-0100");
  await page.getByLabel("Email *").fill("parent@example.test");
  await page.getByRole("button", { name: "Continue →" }).click();
  await page.getByRole("button", { name: "Send meeting request" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Request received" }),
  ).toHaveCount(0);
  accept = true;
  await page.getByRole("button", { name: "Send meeting request" }).click();
  await expect(
    page.getByRole("heading", { name: "Request received" }),
  ).toBeVisible();
  await expect(page.getByText("your time is not reserved yet")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    parentName: "Synthetic Parent",
    email: "parent@example.test",
    phone: "520-555-0100",
    preferredMethod: "email",
    availability: [
      { day: "tuesday", startTime: "10:00", endTime: "10:30" },
    ],
  });
  expect(requests[1]?.requestId).toBe(requests[0]?.requestId);
  expect(requests[0]?.notes).toContain("Requested Zoom Video meeting");
});

const futureSlot = {
  id: "slot-a",
  startsAt: "2027-01-05T17:00:00.000Z",
  endsAt: "2027-01-05T17:30:00.000Z",
  label: "Advising meeting",
  isAvailable: true,
  status: "available",
  canWithdraw: true,
};
async function operatorWorkspace(page: Page, extra: Record<string, Handler>) {
  return mockApi(page, {
    "GET /api/session": (route) => route.fulfill({ json: operator }),
    "GET /api/availability": (route) =>
      route.fulfill({
        json: { slots: [futureSlot], hasMore: false, nextCursor: null },
      }),
    "GET /api/operations/appointments": (route) =>
      route.fulfill({ json: { items: [], nextCursor: null } }),
    "GET /api/operations/evidence": (route) =>
      route.fulfill({ json: { items: [], nextCursor: null } }),
    ...extra,
  });
}

test("T3-46 T3-50 an admin edit shows saved only after the server confirms it", async ({
  page,
}) => {
  const edits: unknown[] = [];
  let status = 409;
  await operatorWorkspace(page, {
    "PATCH /api/availability/slot-a": (route) => {
      edits.push(route.request().postDataJSON());
      return status === 409
        ? route.fulfill({
            status: 409,
            json: { error: { code: "CONFLICT", message: "x" } },
          })
        : route.fulfill({
            json: {
              ...futureSlot,
              id: "slot-b",
              endsAt: "2027-01-05T17:45:00.000Z",
            },
          });
    },
  });
  await page.goto("/#/dashboard?panel=meetings");
  await page.getByRole("button", { name: /^Edit / }).click();
  await expect(
    page.getByRole("heading", { name: "Edit meeting time" }),
  ).toBeFocused();
  await expect(page.getByLabel("Starts at")).toHaveValue("2027-01-05T10:00");
  await page.getByLabel("Ends at").fill("2027-01-05T10:45");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The change was not confirmed.",
  );
  await expect(page.getByText("Meeting time updated.")).toHaveCount(0);
  status = 200;
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Meeting time updated.")).toBeVisible();
  expect(edits).toHaveLength(2);
  expect(edits[0]).toMatchObject({
    startsAt: "2027-01-05T17:00:00.000Z",
    endsAt: "2027-01-05T17:45:00.000Z",
    label: "Advising meeting",
  });
  expect((edits[1] as { requestId: string }).requestId).toBe(
    (edits[0] as { requestId: string }).requestId,
  );
});

test("T3-54 an admin reviews contact requests and marks one contacted", async ({
  page,
}) => {
  const request = {
    id: "contact-id",
    parentName: "Synthetic Parent",
    email: "parent@example.test",
    phone: "520-555-0100",
    preferredMethod: "phone",
    availability: [{ day: "monday", startTime: "08:00", endTime: "12:00" }],
    timeZone: "America/Phoenix",
    notes: "Synthetic note.",
    status: "new",
    receivedAt: "2026-10-21T18:00:00.000Z",
    updatedAt: "2026-10-21T18:00:00.000Z",
  };
  const queries: string[] = [];
  await operatorWorkspace(page, {
    "GET /api/operations/contact-requests": (route, url) => {
      queries.push(url.search);
      return route.fulfill({ json: { items: [request], nextCursor: null } });
    },
    "POST /api/operations/contact-requests/contact-id/status": (route) =>
      route.fulfill({ json: { ...request, status: "contacted" } }),
  });
  await page.goto("/#/dashboard?panel=requests");
  await expect(page.getByText("Synthetic Parent")).toBeVisible();
  await expect(page.getByText("Monday morning (8 am–12 pm)")).toBeVisible();
  await page.getByRole("button", { name: "Mark contacted" }).click();
  await expect(
    page.getByText("Synthetic Parent marked contacted."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
  expect(queries[0]).toBe("?status=new");
});
