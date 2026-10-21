import { expect, test } from "@playwright/test";

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
