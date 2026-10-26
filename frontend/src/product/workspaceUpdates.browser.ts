import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webOrigin = "http://127.0.0.1:5186";
const apiOrigin = "http://127.0.0.1:8796";
let directory = "";
let closeServer: (() => Promise<void>) | undefined;
let callFixture: (action: string, input: unknown) => Promise<unknown>;
const unexpectedHosts: string[] = [];
const runtimeErrors: string[] = [];

async function startFixture() {
  directory = await mkdtemp(join(tmpdir(), "tala-product-browser-"));
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          "../../../server/test/product-browser-server.cjs",
          import.meta.url,
        ),
      ),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        NODE_OPTIONS: "",
        TALA_BROWSER_TEST_DATA_DIR: directory,
        TALA_BROWSER_TEST_API_PORT: "8796",
        TALA_BROWSER_TEST_WEB_PORT: "5186",
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  callFixture = (action, input) =>
    new Promise((resolve, reject) => {
      if (!child.connected) {
        reject(new Error("The isolated fixture is unavailable."));
        return;
      }
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The synthetic fixture operation timed out."));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      child.send({ id, action, input });
    });
  child.once("exit", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("The isolated fixture exited."));
    }
    pending.clear();
  });
  closeServer = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error("The isolated workspace updates server did not start."),
        ),
      10_000,
    );
    child.on(
      "message",
      (message: {
        ready?: boolean;
        id?: string;
        result?: unknown;
        error?: string;
      }) => {
        if (message.ready) {
          clearTimeout(timer);
          resolve();
        }
        if (!message.id) return;
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.result);
      },
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("The isolated workspace updates server exited."));
    });
  });
}

async function isolate(context: BrowserContext) {
  const recordPageError = (page: Page) =>
    page.on("pageerror", () =>
      runtimeErrors.push("Unhandled workspace updates runtime error"),
    );
  context.pages().forEach(recordPageError);
  context.on("page", recordPageError);
  // Every browser API request reaches this suite's temporary real database.
  // The application's ordinary Vite proxy must never reach a developer server.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === webOrigin && url.pathname.startsWith("/api/")) {
      try {
        const response = await route.fetch({
          url: `${apiOrigin}${url.pathname}${url.search}`,
        });
        await route.fulfill({ response });
      } catch {
        await route.abort("connectionfailed").catch(() => {});
      }
      return;
    }
    if (url.origin === webOrigin || ["blob:", "data:"].includes(url.protocol)) {
      await route.continue();
      return;
    }
    unexpectedHosts.push(url.host);
    await route.abort("blockedbyclient");
  });
}

test.beforeEach(async ({ context }) => {
  unexpectedHosts.length = runtimeErrors.length = 0;
  closeServer = undefined;
  directory = "";
  await isolate(context);
  await startFixture();
});

test.afterEach(async ({ context }) => {
  for (const page of context.pages()) await page.close();
  try {
    await closeServer?.();
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
  expect(runtimeErrors).toEqual([]);
  expect(
    [...new Set(unexpectedHosts)],
    "Workspace updates must not contact Firebase or external services",
  ).toEqual([]);
});

async function register(page: Page, role: "student" | "parent" = "student") {
  const suffix = randomUUID();
  const account = {
    name: `Synthetic workspace updates ${role}`,
    email: `${suffix}@example.test`,
    password: `Synthetic-only-${suffix}`,
  };
  await page.goto("/#/register");
  await page.getByLabel("Name", { exact: true }).fill(account.name);
  await page.getByLabel("Account type", { exact: true }).selectOption(role);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(account.password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: `Hello, ${account.name}.`, exact: true }),
  ).toBeVisible();
  return account;
}

async function chooseView(page: Page, name: "Updates" | "Meetings") {
  const control = page
    .getByRole("navigation", { name: "Workspace sections", exact: true })
    .getByRole("button", {
      name: name === "Updates" ? /^Updates(?:\s|$)/ : name,
    });
  await control.click();
  await expect(control).toHaveAttribute("aria-current", "page");
  await expect(
    page.locator(name === "Updates" ? "#updates-heading" : "#meetings-heading"),
  ).toBeVisible();
}

function updates(page: Page): Locator {
  return page.getByRole("region", { name: "Updates", exact: true });
}

async function bookMeeting(
  page: Page,
  label = "Synthetic advising reservation",
) {
  const starts = Date.now() + 86_400_000;
  const slot = (await callFixture("addAvailability", {
    startsAt: new Date(starts).toISOString(),
    endsAt: new Date(starts + 1_800_000).toISOString(),
    label,
  })) as { id: string };
  await chooseView(page, "Meetings");
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  const available = page.getByLabel("Available meeting time", { exact: true });
  await expect(available).toBeEnabled();
  await available.selectOption(slot.id);
  await page.getByRole("button", { name: "Book meeting", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your booking was saved to the server." }),
  ).toBeVisible();
}

test("saved meeting updates open the real record without marking it read and preserve explicit read status after sign-in", async ({
  page,
}) => {
  const account = await register(page);
  await chooseView(page, "Updates");
  const panel = updates(page);
  await expect(
    panel.getByRole("heading", { name: "No updates yet.", exact: true }),
  ).toBeVisible();
  await bookMeeting(page);
  await chooseView(page, "Updates");
  const row = panel.locator(".workspace-updates-row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-unread", "true");
  await expect(
    panel.getByRole("button", { name: /^Unread updates \(1\)$/ }),
  ).toBeVisible();
  await row
    .getByRole("button", { name: /^Open “Meeting reservation saved”$/ })
    .click();
  const detail = page.getByRole("dialog", {
    name: "Meeting details",
    exact: true,
  });
  await expect(
    detail.getByText("Time reserved", { exact: true }),
  ).toBeVisible();
  expect(
    new URLSearchParams(page.url().split("?")[1]).get("booking"),
  ).toBeTruthy();
  await detail
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await expect(page.locator("#updates-heading")).toBeFocused();
  await expect(row).toHaveAttribute("data-unread", "true");
  await row
    .getByRole("button", { name: /^Mark “Meeting reservation saved” as read$/ })
    .click();
  await expect(row).toHaveAttribute("data-unread", "false");
  await expect(row.getByText("Read", { exact: true })).toBeVisible();
  await page.reload();
  await expect(row).toHaveAttribute("data-unread", "false");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
  await chooseView(page, "Updates");
  await expect(row).toHaveAttribute("data-unread", "false");
  await panel.getByRole("button", { name: /^Unread updates \(0\)$/ }).click();
  await expect(
    panel.getByRole("heading", { name: "You’re up to date.", exact: true }),
  ).toBeVisible();
});

test("real pagination keeps loaded updates after interruption and read-all receipts leave later changes unread", async ({
  page,
  browser,
}) => {
  const student = await register(page);
  const staffContext = await browser.newContext({
    baseURL: webOrigin,
    timezoneId: "America/Phoenix",
  });
  try {
    await isolate(staffContext);
    const staffPage = await staffContext.newPage();
    const staff = await register(staffPage);
    await callFixture("promote", staff.email);
    const seed = (await callFixture("seedPagination", {
      studentEmail: student.email,
      operatorEmail: staff.email,
    })) as {
      documentCount: number;
      learningCount: number;
      pastCount: number;
      availableCount: number;
      activeBookingId: string;
    };
    const total =
      seed.pastCount +
      seed.availableCount * 2 +
      1 +
      seed.learningCount +
      seed.documentCount -
      1;
    await page.bringToFront();
    await page.reload();
    await chooseView(page, "Updates");
    const panel = updates(page);
    const rows = panel.locator(".workspace-updates-row");
    await expect(rows).toHaveCount(25);
    await expect(
      panel.getByRole("button", {
        name: `Unread updates (${total})`,
        exact: true,
      }),
    ).toBeVisible();
    let interrupted = false;
    const cursors: string[] = [];
    await page.route("**/api/updates?*", async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor) {
        cursors.push(cursor);
        if (!interrupted) {
          interrupted = true;
          return route.abort("connectionfailed");
        }
      }
      await route.fallback();
    });
    await panel
      .getByRole("button", { name: "Load more updates", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(
      "previously loaded updates are still shown",
    );
    await expect(rows).toHaveCount(25);
    await panel
      .getByRole("button", { name: "Retry loading more updates", exact: true })
      .click();
    await expect(rows).toHaveCount(50);
    expect(cursors[0]).toBe(cursors[1]);
    await page.unroute("**/api/updates?*");

    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const requestIds: string[] = [];
    await page.route("**/api/updates/read-all", async (route) => {
      const input = route.request().postDataJSON() as { requestId: string };
      requestIds.push(input.requestId);
      if (requestIds.length === 1) {
        started?.();
        await held;
        const committed = await route.fetch({
          url: `${apiOrigin}/api/updates/read-all`,
        });
        expect(committed.ok()).toBe(true);
        await route.abort("connectionfailed");
      } else await route.fallback();
    });
    try {
      const markAll = panel.getByRole("button", {
        name: "Mark all as read",
        exact: true,
      });
      await expect(markAll).toBeEnabled();
      await markAll.evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
      await ready;
      expect(requestIds).toHaveLength(1);
      release?.();
      await expect(panel.getByRole("alert")).toContainText(
        "read status has not been confirmed",
      );
      const later = await page.evaluate(async (bookingId) => {
        const session = (await (
          await fetch("/api/session", { credentials: "same-origin" })
        ).json()) as {
          csrfToken: string;
          session: { uid: string };
        };
        const saved = await fetch(`/api/appointments/${bookingId}/cancel`, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
            "X-TALA-User": session.session.uid,
          },
          body: JSON.stringify({ requestId: crypto.randomUUID() }),
        });
        return saved.status;
      }, seed.activeBookingId);
      expect(later).toBe(200);
      await panel
        .getByRole("button", { name: "Retry saving read status", exact: true })
        .click();
      await expect(
        panel.getByRole("button", { name: /^Unread updates \(1\)$/ }),
      ).toBeVisible();
      expect(requestIds).toHaveLength(2);
      expect(requestIds[0]).toBe(requestIds[1]);
      await panel
        .getByRole("button", { name: /^Unread updates \(1\)$/ })
        .click();
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText("Meeting reservation cancelled");
      await expect(rows).toHaveAttribute("data-unread", "true");
    } finally {
      release?.();
    }
  } finally {
    await staffContext.close();
  }
});

test("parent updates remain read-only and revoked family access immediately hides cached content", async ({
  page,
  browser,
}) => {
  const student = await register(page);
  await bookMeeting(page, "Private synthetic family meeting label");
  const privateNote =
    "Private synthetic preparation retained only while family access is authorized.";
  const preparation = await page.evaluate(async (note) => {
    const session = (await (
      await fetch("/api/session", { credentials: "same-origin" })
    ).json()) as { csrfToken: string; session: { uid: string } };
    const workspace = (await (
      await fetch("/api/workspace", { credentials: "same-origin" })
    ).json()) as { activeAppointments: Array<{ id: string }> };
    const bookingId = workspace.activeAppointments[0]!.id;
    const response = await fetch(`/api/appointments/${bookingId}/preparation`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
        "X-TALA-User": session.session.uid,
      },
      body: JSON.stringify({
        note,
        goalId: null,
        ready: false,
        version: 0,
        requestId: crypto.randomUUID(),
      }),
    });
    return { bookingId, status: response.status };
  }, privateNote);
  expect(preparation.status).toBe(200);
  const parentContext = await browser.newContext({
    baseURL: webOrigin,
    timezoneId: "America/Phoenix",
  });
  try {
    await isolate(parentContext);
    const parentPage = await parentContext.newPage();
    const parent = await register(parentPage, "parent");
    const studentUid = await callFixture("findUid", student.email);
    const parentUid = await callFixture("findUid", parent.email);
    await callFixture("linkFamily", {
      studentUid,
      parentUid,
      consentReference: "Synthetic read-only browser fixture consent.",
    });
    await parentPage.reload();
    await chooseView(parentPage, "Updates");
    const panel = updates(parentPage);
    await expect(panel).toContainText(
      "Read status follows the student’s account",
    );
    await expect(panel.locator(".workspace-updates-row")).toContainText(
      "Private synthetic family meeting label",
    );
    await expect(
      panel.getByRole("button", { name: "Mark all as read", exact: true }),
    ).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /^Mark “/ })).toHaveCount(0);
    await expect(panel.getByText(privateNote, { exact: true })).toHaveCount(0);
    await callFixture("revokeFamily", { studentUid, parentUid });
    const denied = parentPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/updates" &&
        response.status() === 403,
    );
    await panel
      .getByRole("button", { name: "Refresh updates", exact: true })
      .click();
    await denied;
    await expect(
      parentPage
        .locator(".workspace-updates-summary")
        .filter({ hasText: "Private synthetic family meeting label" }),
    ).not.toBeVisible({ timeout: 3_000 });
    await expect(panel).not.toBeVisible();
    await expect(
      parentPage
        .getByRole("alert")
        .filter({ hasText: /permission|access|not available/i })
        .first(),
    ).toBeVisible();
    await page.bringToFront();
    await chooseView(page, "Updates");
    await expect(
      updates(page).getByRole("button", { name: /^Unread updates \(1\)$/ }),
    ).toBeVisible();

    // A second, explicitly restored synthetic relationship exercises the
    // private modal's fresh export check separately from the feed denial.
    await callFixture("linkFamily", {
      studentUid,
      parentUid,
      consentReference:
        "Synthetic restored relationship for a private modal regression.",
    });
    await parentPage.bringToFront();
    await parentPage.reload();
    await chooseView(parentPage, "Updates");
    await updates(parentPage)
      .getByRole("button", { name: /^Open “Meeting reservation saved”$/ })
      .click();
    const detail = parentPage.getByRole("dialog", {
      name: "Meeting details",
      exact: true,
    });
    await expect(detail.getByText(privateNote, { exact: true })).toBeVisible();
    let downloads = 0;
    parentPage.on("download", () => {
      downloads++;
    });
    await callFixture("disableStudent", student.email);
    const missingStudent = parentPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/appointments/${preparation.bookingId}` &&
        response.status() === 404,
    );
    await detail
      .getByRole("button", { name: "Save to calendar", exact: true })
      .click();
    await missingStudent;
    await expect(detail).not.toBeVisible({ timeout: 3_000 });
    await expect(
      parentPage.getByText(privateNote, { exact: true }),
    ).not.toBeVisible();
    await expect(
      parentPage
        .getByRole("alert")
        .filter({ hasText: /permission|access|not available/i })
        .first(),
    ).toBeVisible();
    expect(downloads).toBe(0);
  } finally {
    await parentContext.close();
  }
});

test("updates support keyboard use and calm readable layouts on mobile, tablet, and desktop", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await register(page);
  await bookMeeting(page);
  const navigation = page
    .getByRole("navigation", { name: "Workspace sections", exact: true })
    .getByRole("button", { name: /^Updates(?:\s|$)/ });
  await navigation.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#updates-heading")).toBeFocused();
  const panel = updates(page);
  await expect(panel.locator(".workspace-updates-row")).toHaveCount(1);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    if (width !== 768) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`workspace-updates-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await panel.getByRole("button", { name: /^Unread updates \(1\)$/ }).focus();
  await page.keyboard.press("Enter");
  const markRead = panel.getByRole("button", {
    name: /^Mark “Meeting reservation saved” as read$/,
  });
  await markRead.focus();
  await page.keyboard.press("Space");
  await expect(
    panel.getByRole("heading", { name: "You’re up to date.", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#updates-heading")).toBeFocused();
});
