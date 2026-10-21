import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

const cursor = `synthetic_page.${"s".repeat(43)}`;
const fixture = (
  id: string,
  title: string,
  reviewStatus: "reviewed" | "not_reviewed",
) => ({
  id,
  title,
  ownerUid: "student-id",
  studentUid: "student-id",
  studentName: "Synthetic learner",
  appointmentId: "appointment-id",
  contentType: "text/plain",
  size: 16,
  sha256: "a".repeat(64),
  status: "submitted",
  reviewStatus,
  submittedAt: "2026-10-21T12:00:00.000Z",
  revisionNumber: 1,
  rootEvidenceId: id,
  reviewVersion: reviewStatus === "reviewed" ? 1 : 0,
});

test("returning to a cached operator panel still aborts stale pagination when its filter changes", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let staleAborted = false;
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/api/operations/evidence" &&
      url.searchParams.get("reviewStatus") === "not_reviewed" &&
      url.searchParams.has("cursor")
    )
      staleAborted = true;
  });
  // Every API is synthetic and intercepted; this regression never reaches an
  // existing local backend, its accounts, files or database.
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/session")
        return route.fulfill({
          json: {
            session: {
              uid: "operator-id",
              name: "Synthetic staff",
              email: "staff@example.test",
              role: "operator",
              emailVerified: false,
            },
            csrfToken: "n".repeat(43),
          },
        });
      if (url.pathname === "/api/operations/evidence") {
        const reviewed = url.searchParams.get("reviewStatus") === "reviewed";
        if (url.searchParams.has("cursor")) {
          if (!reviewed) {
            started?.();
            await held;
            return route
              .fulfill({
                json: {
                  items: [
                    fixture(
                      "stale-id",
                      "Stale awaiting document",
                      "not_reviewed",
                    ),
                  ],
                  nextCursor: null,
                },
              })
              .catch(() => {});
          }
          return route.fulfill({
            json: {
              items: [
                fixture("reviewed-more", "Reviewed second page", "reviewed"),
              ],
              nextCursor: null,
            },
          });
        }
        return route.fulfill({
          json: {
            items: [
              fixture(
                reviewed ? "reviewed-id" : "awaiting-id",
                reviewed ? "Reviewed first page" : "Awaiting first page",
                reviewed ? "reviewed" : "not_reviewed",
              ),
            ],
            nextCursor: cursor,
          },
        });
      }
      if (url.pathname === "/api/availability")
        return route.fulfill({
          json: { slots: [], hasMore: false, nextCursor: null },
        });
      if (url.pathname === "/api/operations/appointments")
        return route.fulfill({ json: { items: [], nextCursor: null } });
      return route.abort("blockedbyclient");
    },
  );
  try {
    await page.goto("/#/dashboard");
    await expect(
      page.getByRole("heading", { name: "Awaiting first page" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Meetings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Meetings and availability" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /^Review evidence/ }).click();
    await page
      .getByRole("button", { name: "Load more evidence", exact: true })
      .click();
    await ready;
    await page
      .getByLabel("Review queue", { exact: true })
      .selectOption("reviewed");
    await expect(
      page.getByRole("heading", { name: "Reviewed first page" }),
    ).toBeVisible();
    await expect.poll(() => staleAborted).toBe(true);
    await page
      .getByRole("button", { name: "Load more evidence", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /Reviewed second page/ }),
    ).toBeVisible();
    const lastPage = page
      .getByRole("status")
      .filter({ hasText: "You have reached the last page for these filters." });
    await expect(lastPage).toBeFocused();
    release?.();
    await expect(
      page.getByText("Stale awaiting document", { exact: true }),
    ).toHaveCount(0);
  } finally {
    release?.();
  }
});

test.describe("operator device-local publishing", () => {
  test.use({ timezoneId: "America/New_York" });
  test("clock gaps and repeated minutes never post, while a unique time preserves its exact instant", async ({
    page,
  }) => {
    const published: Array<{ startsAt: string; endsAt: string }> = [];
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/session")
          return route.fulfill({
            json: {
              session: {
                uid: "operator-id",
                name: "Synthetic staff",
                email: "staff@example.test",
                role: "operator",
                emailVerified: false,
              },
              csrfToken: "n".repeat(43),
            },
          });
        if (path === "/api/availability") {
          if (route.request().method() === "POST") {
            const body = route.request().postDataJSON() as {
              startsAt: string;
              endsAt: string;
            };
            published.push({ startsAt: body.startsAt, endsAt: body.endsAt });
            return route.fulfill({
              json: {
                id: "unique-time-id",
                ...body,
                label: "Advising meeting",
                isAvailable: true,
              },
            });
          }
          return route.fulfill({
            json: { slots: [], hasMore: false, nextCursor: null },
          });
        }
        if (path === "/api/operations/appointments")
          return route.fulfill({ json: { items: [], nextCursor: null } });
        return route.abort("blockedbyclient");
      },
    );
    await page.goto("/#/dashboard?panel=meetings");
    const starts = page.getByLabel("Starts at", { exact: true });
    const ends = page.getByLabel("Ends at", { exact: true });
    const publish = page.getByRole("button", {
      name: "Publish availability",
      exact: true,
    });
    await expect(page.locator("#operator-time-zone-help")).toContainText(
      "America/New_York",
    );
    await expect(publish).toBeEnabled();
    for (const [start, end] of [
      ["2027-03-14T02:30", "2027-03-14T04:00"],
      ["2027-11-07T01:30", "2027-11-07T02:30"],
    ]) {
      await starts.fill(start!);
      await ends.fill(end!);
      await publish.click();
      await expect(page.getByRole("alert")).toContainText(
        "Check the entered details",
      );
      await expect(publish).toBeEnabled();
      await expect(starts).toHaveValue(start!);
      await expect(ends).toHaveValue(end!);
      expect(published).toHaveLength(0);
    }
    await starts.fill("2027-03-14T03:30");
    await ends.fill("2027-03-14T04:00");
    await publish.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Meeting time published." }),
    ).toBeVisible();
    expect(published).toEqual([
      {
        startsAt: "2027-03-14T07:30:00.000Z",
        endsAt: "2027-03-14T08:00:00.000Z",
      },
    ]);
    await expect(starts).toHaveValue("");
    await expect(ends).toHaveValue("");
  });
});

test("concealed workspaces cancel pending student, operator and calendar exports without losing local drafts", async ({
  browser,
}) => {
  for (const kind of ["student", "operator", "calendar"] as const) {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5190",
    });
    const page = await context.newPage();
    const role = kind === "operator" ? "operator" : "student";
    const user = {
      uid: `${role}-id`,
      name: "Synthetic private owner",
      email: "export@example.test",
      role,
      emailVerified: false,
    };
    const bytes = Buffer.from("Synthetic private export. No real records.");
    const booking = {
      id: "10000000-0000-4000-8000-000000000001",
      ownerUid: "student-id",
      slotId: "slot-id",
      startsAt: "2027-03-15T15:00:00Z",
      endsAt: "2027-03-15T15:30:00Z",
      status: "reserved",
      meetingIntegration: "unavailable",
      updatedAt: "2026-10-21T10:00:00Z",
    };
    const evidence = {
      ...fixture(
        "export-evidence",
        "Synthetic private document",
        "not_reviewed",
      ),
      appointmentId: booking.id,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const progress = {
      submittedEvidenceCount: 1,
      reviewedEvidenceCount: 0,
      assessedEvidenceCount: 0,
      acknowledgedOutcomeCount: 0,
      revisionSubmissionCount: 0,
      masteryStatus: "unavailable",
    };
    const artifactPath =
      kind === "calendar"
        ? `/api/appointments/${booking.id}`
        : "/api/evidence/export-evidence/content";
    let releaseArtifact: (() => void) | undefined,
      releaseSession: (() => void) | undefined,
      started: (() => void) | undefined;
    const artifactGate = new Promise<void>((resolve) => {
      releaseArtifact = resolve;
    });
    const sessionGate = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    const artifactStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let held = true,
      sessionReads = 0,
      downloads = 0,
      aborted = false;
    page.on("download", () => downloads++);
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).pathname === artifactPath) aborted = true;
    });
    await page.route(
      (url) => url.pathname.startsWith("/api/"),
      async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== "GET")
          return route.abort("blockedbyclient");
        if (path === "/api/session") {
          if (++sessionReads > 1) await sessionGate;
          return route
            .fulfill({ json: { session: user, csrfToken: "n".repeat(43) } })
            .catch(() => {});
        }
        if (path === artifactPath) {
          if (held) {
            started?.();
            await artifactGate;
          }
          return kind === "calendar"
            ? route.fulfill({ json: booking }).catch(() => {})
            : route
                .fulfill({
                  body: bytes,
                  headers: {
                    "Content-Type": "text/plain",
                    "Content-Length": String(bytes.length),
                    "Content-Disposition":
                      'attachment; filename="synthetic.txt"',
                    "X-Content-SHA256": evidence.sha256,
                  },
                })
                .catch(() => {});
        }
        if (path === "/api/workspace")
          return route.fulfill({
            json: {
              slots: [],
              appointments: [booking],
              activeAppointments: [booking],
              evidence: [evidence],
              progress,
            },
          });
        if (path === "/api/evidence" || path === "/api/operations/evidence")
          return route.fulfill({
            json: { items: [evidence], nextCursor: null },
          });
        if (path === "/api/appointments")
          return route.fulfill({
            json: { items: [booking], nextCursor: null },
          });
        if (path === "/api/learning" || path === "/api/operations/learning")
          return route.fulfill({
            json: {
              records: [],
              integrations: { zoom: "unavailable", ai: "unavailable" },
              nextCursor: null,
            },
          });
        if (path === "/api/evidence/uploads")
          return route.fulfill({ json: { uploads: [] } });
        if (
          path === "/api/available-times" ||
          path === "/api/operations/appointments"
        )
          return route.fulfill({ json: { items: [], nextCursor: null } });
        if (path === "/api/availability")
          return route.fulfill({
            json: { slots: [], hasMore: false, nextCursor: null },
          });
        return route.abort("blockedbyclient");
      },
    );
    try {
      await page.goto(
        kind === "operator"
          ? "/#/dashboard?panel=review"
          : "/#/dashboard?view=evidence",
      );
      if (kind !== "operator") {
        await page
          .getByLabel("Evidence title", { exact: true })
          .fill("Unsent private draft");
        await page
          .getByLabel("File", { exact: true })
          .setInputFiles({
            name: "unsent-draft.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("Synthetic unsent draft."),
          });
        if (kind === "calendar")
          await page
            .getByRole("button", { name: "Meetings", exact: true })
            .click();
      }
      const download =
        kind === "calendar"
          ? page.getByRole("button", { name: "Download calendar", exact: true })
          : page.getByRole("button", {
              name: "Download Synthetic private document",
              exact: true,
            });
      await download.click();
      await artifactStarted;
      await page.evaluate(() => {
        const channel = new BroadcastChannel("tala-session-events-v1");
        channel.postMessage({ type: "session-changed" });
        channel.close();
      });
      await expect(
        page.getByRole("heading", {
          name: "Checking your secure session…",
          exact: true,
        }),
      ).toBeVisible();
      await expect.poll(() => aborted).toBe(true);
      releaseArtifact?.();
      held = false;
      releaseSession?.();
      await expect(
        page.getByRole("heading", {
          name: "Checking your secure session…",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(page.getByRole("alert")).toContainText(
        "request was cancelled",
      );
      expect(downloads).toBe(0);
      const successful = page.waitForEvent("download");
      await download.click();
      await successful;
      expect(downloads).toBe(1);
      if (kind !== "operator") {
        if (kind === "calendar")
          await page
            .getByRole("button", { name: "Evidence", exact: true })
            .click();
        await expect(
          page.getByLabel("Evidence title", { exact: true }),
        ).toHaveValue("Unsent private draft");
        expect(
          await page
            .getByLabel("File", { exact: true })
            .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
        ).toBe("unsent-draft.txt");
      }
    } finally {
      releaseArtifact?.();
      releaseSession?.();
      await context.close();
    }
  }
});
