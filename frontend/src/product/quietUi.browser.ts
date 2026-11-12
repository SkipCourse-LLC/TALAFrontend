import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import type { ApiPendingUploads, ApiWorkspace } from "../api";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webOrigin = "http://127.0.0.1:5197";
const apiOrigin = "http://127.0.0.1:8807";
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
        TALA_BROWSER_TEST_API_PORT: "8807",
        TALA_BROWSER_TEST_WEB_PORT: "5197",
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
      () => reject(new Error("The isolated operations server did not start.")),
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
      reject(new Error("The isolated operations server exited."));
    });
  });
}

async function isolate(context: BrowserContext) {
  const recordPageError = (page: Page) =>
    page.on("pageerror", () =>
      runtimeErrors.push("Unhandled operations runtime error"),
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

type Account = { name: string; email: string; password: string };

test("eight-character passwords work for registration, password changes and sign-in", async ({
  page,
}) => {
  const account = {
    name: "Password policy test",
    email: `${randomUUID()}@example.test`,
    password: "abcdefgh",
    replacement: "ijklmnop",
  };
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/#/register");
  await page.getByLabel("Name", { exact: true }).fill(account.name);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("minlength", "8");
  await expect(password).toHaveAttribute("maxlength", "128");
  await password.fill("abcdefg");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.locator("#product-access-password-error")).toHaveText(
    "Use 8–128 characters.",
  );
  await expect(page.locator("#product-password-help")).toHaveCount(0);
  await password.fill(account.password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: `Hello, ${account.name}.`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Account security", exact: true })
    .click();
  await page
    .getByLabel("Current password", { exact: true })
    .fill(account.password);
  const next = page.getByLabel("New password", { exact: true });
  const confirmation = page.getByLabel("Confirm new password", { exact: true });
  await expect(next).toHaveAttribute("minlength", "8");
  await next.fill("ijklmno");
  await confirmation.fill("ijklmno");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.locator("#account-password-next-error")).toHaveText(
    "Use 8–128 characters.",
  );
  await expect(page.locator("#account-password-next-help")).toHaveCount(0);
  await next.fill(account.replacement);
  await confirmation.fill(account.replacement);
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.locator(".account-security-success")).toContainText(
    "Password changed.",
  );
  await page
    .getByRole("link", { name: "Back to workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.replacement);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: `Hello, ${account.name}.`, exact: true }),
  ).toBeVisible();
});

async function register(page: Page, role: "student" | "parent" = "student") {
  const suffix = randomUUID();
  const account: Account = {
    name: role === "student" ? "Test student" : "Test parent",
    email: `${suffix}@example.test`,
    password: `Synthetic-only-${suffix}`,
  };
  await page.goto("/#/register");
  await page.getByLabel("Name", { exact: true }).fill(account.name);
  await page
    .getByRole("radio", {
      name: role === "student" ? "Student" : "Parent or guardian",
      exact: true,
    })
    .check();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: `Hello, ${account.name}.`, exact: true }),
  ).toBeVisible();
  return account;
}

async function navigationControl(page: Page, label: string) {
  const menu = page.locator("details.server-dashboard-mobile-nav");
  const mobile = await menu.isVisible();
  const navigation = page.locator(
    mobile ? ".server-dashboard-mobile-links" : ".server-dashboard-desktop-nav",
  );
  const control = navigation.getByRole("button", {
    name: label,
    exact: true,
    includeHidden: true,
  });
  if (!(await control.isVisible())) {
    const summary = menu.locator(":scope > summary");
    await summary.focus();
    await summary.press("Enter");
    await expect(control).toBeVisible();
  }
  return control;
}

async function choose(page: Page, label: string) {
  const control = await navigationControl(page, label);
  await control.click();
  await expect(control).toHaveAttribute("aria-current", "page");
}

async function savedWorkspace(page: Page): Promise<ApiWorkspace> {
  return page.evaluate(async () => {
    const response = await fetch("/api/workspace", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Synthetic workspace read failed.");
    return response.json();
  });
}

async function expectAccessible(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function visibleCopy(page: Page, selector: string) {
  return page.locator(selector).evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    let next: Node | null;
    while ((next = walker.nextNode())) {
      const element = next.parentElement;
      if (
        !element ||
        element.closest(".sr-only") ||
        !element.getClientRects().length
      )
        continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const value = next.textContent?.replace(/\s+/g, " ").trim();
      if (value) parts.push(value);
    }
    return parts.join(" ");
  });
}

const views = [
  ["Overview", "overview-heading"],
  ["Updates", "updates-heading"],
  ["Learning plan", "plan-heading"],
  ["Meetings", "meetings-heading"],
  ["Learning records", "records-heading"],
  ["Evidence", "evidence-heading"],
  ["Progress", "progress-heading"],
] as const;

async function expectDefaultOverview(page: Page, submittedCount = "0") {
  await expect(
    page
      .getByRole("complementary", { name: "Student hub", exact: true })
      .getByText("Student hub", { exact: true }),
  ).toBeVisible();
  const overview = page.locator(".learning-overview");
  await expect(page.locator("#overview-heading")).toHaveText("Overview");
  await expect(overview.locator(".learning-overview-focus")).toBeVisible();
  await expect(overview.locator(".learning-overview-meeting")).toBeVisible();
  await expect(
    overview.getByRole("heading", { name: "Your saved activity", exact: true }),
  ).toBeVisible();
  await expect(overview.locator(".learning-overview-follow-ups")).toBeVisible();
  const submitted = overview
    .locator(".learning-overview-activity dl > div")
    .filter({ has: page.getByText("Evidence submitted", { exact: true }) });
  await expect(submitted.locator("dd")).toHaveText(submittedCount);
  await expect(
    overview.locator("summary").filter({ hasText: /^More$/ }),
  ).toHaveCount(0);
  expect(await visibleCopy(page, ".learning-overview")).not.toMatch(
    /\bsample\b|\bdemo learner\b|\bdemo preview\b/i,
  );
}

test("one independent workspace opens its sidebar and real Overview cards after registration, reload and sign-in, with accessible desktop and mobile navigation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.route(
    "**/api/session",
    (route) => route.abort("connectionfailed"),
    { times: 1 },
  );
  await page.goto("/#/register");
  await expect(
    page.getByRole("heading", { name: "TALA is unavailable.", exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({
    path: testInfo.outputPath("connection-retry-320.png"),
  });
  await page
    .getByRole("button", { name: "Retry connection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create account", exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath("register-320.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/");
  await expect(page.locator("main h1")).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath("home-1440.png") });
  const account = await register(page);
  await expect(page).toHaveURL(`${webOrigin}/#/dashboard`);
  await expectDefaultOverview(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "tala.today.display.v1",
      JSON.stringify({
        version: 1,
        focus: true,
        textSize: "default",
        spacing: "default",
      }),
    ),
  );
  await page.reload();
  await expectDefaultOverview(page);
  await page.route(
    "**/api/auth/logout",
    async (route) => {
      const response = await route.fetch({
        url: `${apiOrigin}/api/auth/logout`,
      });
      expect(response.ok()).toBe(true);
      await route.abort("connectionfailed");
    },
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await page.goto("/#/login");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${webOrigin}/#/dashboard`);
  await expectDefaultOverview(page);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [label, headingId] of views) {
      const button = await navigationControl(page, label);
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-current", "page");
      await expect(page.locator(`#${headingId}`)).toBeFocused();
      if (label === "Overview") {
        await expectDefaultOverview(page);
        await page.screenshot({
          path: testInfo.outputPath(`workspace-overview-${width}.png`),
        });
        if (width === 320) {
          const menu = page.locator("details.server-dashboard-mobile-nav");
          await expect(menu).not.toHaveAttribute("open", "");
          const summary = menu.locator(":scope > summary");
          await summary.focus();
          await summary.press("Enter");
          await expect(menu).toHaveAttribute("open", "");
          await expectAccessible(page);
          await page.screenshot({
            path: testInfo.outputPath("workspace-menu-320.png"),
          });
          await summary.press("Enter");
        }
      }
      if (label === "Learning records") {
        const region = page.getByRole("region", {
          name: "Learning records",
          exact: true,
        });
        await expect(
          region.getByText("Your learning, in one place.", { exact: true }),
        ).toBeVisible();
        await expect(
          region.getByPlaceholder("Search notes", { exact: true }),
        ).toBeVisible();
        expect(
          (await visibleCopy(page, "#learning-records")).split(/\s+/).length,
        ).toBeLessThan(20);
        if (width === 320)
          await page.screenshot({
            path: testInfo.outputPath("learning-empty-320.png"),
          });
      }
      const copy = await visibleCopy(page, "main");
      expect(copy).not.toMatch(/\b0 [^.!]{0,50}loaded\b/);
      expect(copy).not.toContain("Make room for what you want to learn next.");
      expect(copy).not.toContain(
        "Saved learning notes, written and published by your TALA team.",
      );
      expect(copy).not.toContain("A record of the work you’ve saved.");
      await expectAccessible(page);
    }
  }
  const accountPanel = page.locator("details.student-account");
  await accountPanel.locator(":scope > summary").click();
  await accountPanel
    .getByLabel("Workspace text size", { exact: true })
    .selectOption("larger");
  await accountPanel
    .getByLabel("Workspace spacing", { exact: true })
    .selectOption("comfortable");
  const workspaceRoot = page.locator(".student-workspace.server-dashboard");
  await expect(workspaceRoot).toHaveAttribute("data-text-size", "larger");
  await expect(workspaceRoot).toHaveAttribute("data-spacing", "comfortable");
  await accountPanel.locator(":scope > summary").click();
  await choose(page, "Evidence");
  await expect(page.getByLabel("Search documents", { exact: true })).toHaveCSS(
    "font-size",
    "18.4px",
  );
  await expectAccessible(page);
  await page.reload();
  await expect(workspaceRoot).toHaveAttribute("data-text-size", "larger");
  await expect(workspaceRoot).toHaveAttribute("data-spacing", "comfortable");
  await choose(page, "Overview");
  await expectDefaultOverview(page);
  const options = page.locator(".today-view-options");
  await options.locator(":scope > summary").click();
  await options
    .getByLabel("Text size", { exact: true })
    .selectOption("default");
  await options.getByLabel("Spacing", { exact: true }).selectOption("default");
  await expect(workspaceRoot).toHaveAttribute("data-text-size", "default");
  await expect(workspaceRoot).toHaveAttribute("data-spacing", "default");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("link", { name: "Account security", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Account security", exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath("security-1440.png") });
});

test("the unified sidebar and Overview keep saved records, Evidence drafts, meeting safeguards and parent read-only access", async ({
  page,
  browser,
}, testInfo) => {
  const student = await register(page);
  const operatorContext = await browser.newContext({
    baseURL: webOrigin,
    timezoneId: "America/Phoenix",
  });
  let seed: {
    oldLearningId: string;
    oldLearningSummary: string;
    activeBookingId: string;
  };
  try {
    await isolate(operatorContext);
    const operator = await register(await operatorContext.newPage());
    await callFixture("promote", operator.email);
    seed = (await callFixture("seedPagination", {
      studentEmail: student.email,
      operatorEmail: operator.email,
    })) as typeof seed;
  } finally {
    await operatorContext.close();
  }
  await page.reload();
  // Reading a task from Overview returns to that context when its detail closes.
  await page
    .locator(".learning-overview-follow-ups")
    .getByRole("button")
    .filter({ hasText: "New notes to read" })
    .click();
  const overviewSummary = page.getByRole("dialog", {
    name: "Learning summary",
    exact: true,
  });
  await expect(overviewSummary).toBeVisible();
  await expect(
    overviewSummary.locator(".workspace-detail-outcomes"),
  ).toBeVisible();
  await overviewSummary
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await expect(page.locator("#overview-heading")).toBeFocused();
  expect(new URL(page.url()).hash).toContain("view=overview");
  expect(new URL(page.url()).hash).not.toContain("record=");
  expect(new URL(page.url()).hash).not.toContain("from=");
  await choose(page, "Learning records");
  await page
    .getByLabel("Search learning records", { exact: true })
    .fill(seed.oldLearningSummary);
  const row = page
    .getByRole("list", { name: "Saved learning records", exact: true })
    .locator(":scope > li")
    .filter({ hasText: seed.oldLearningSummary });
  await expect(row).toHaveCount(1);
  await expect(
    row.getByText(seed.oldLearningSummary, { exact: true }),
  ).toBeVisible();
  await row
    .getByRole("button", {
      name: "Mark as read — I have read this summary",
      exact: true,
    })
    .click();
  await expect(
    row.locator(".learning-records-reviewed").filter({ hasText: "Read" }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({
    path: testInfo.outputPath("learning-populated-1440.png"),
  });
  await row.getByRole("button", { name: "Add Evidence", exact: true }).click();
  await expect(
    page.getByLabel("Your reflection", { exact: true }),
  ).toBeFocused();
  const writing =
    "Synthetic private reflection. Preserve this exact text across navigation.";
  await page.getByLabel("Your reflection", { exact: true }).fill(writing);
  await page
    .getByLabel("Evidence title", { exact: true })
    .fill("Synthetic current work");
  await choose(page, "Learning records");
  await row.getByRole("button", { name: "Add Evidence", exact: true }).click();
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    writing,
  );
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    "Synthetic current work",
  );

  await choose(page, "Learning plan");
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  await page
    .getByLabel("Goal", { exact: true })
    .fill("Synthetic quiet learning goal");
  await page
    .getByRole("button", { name: "Add notes or a target date", exact: true })
    .click();
  await page
    .getByLabel("Notes (optional)", { exact: true })
    .fill("Synthetic notes remain visible and unchanged.");
  await page
    .getByLabel("Target date (optional)", { exact: true })
    .fill("2027-05-21");
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page
    .getByLabel("Step 1", { exact: true })
    .fill("Keep one meaningful step");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic quiet learning goal",
      exact: true,
    }),
  ).toBeVisible();
  await choose(page, "Overview");
  await expectDefaultOverview(page, "131");
  await expect(
    page.locator(".learning-overview-focus").getByRole("heading", {
      name: "Synthetic quiet learning goal",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(".learning-overview-meeting")
      .getByRole("heading", { name: "Next meeting", exact: true }),
  ).toBeVisible();
  expect((await savedWorkspace(page)).activeAppointments[0]?.id).toBe(
    seed.activeBookingId,
  );
  const submitted = page
    .locator(".learning-overview-activity dl > div")
    .filter({ has: page.getByText("Evidence submitted", { exact: true }) });
  await expect(submitted.locator("dd")).toHaveText("131");
  await expectAccessible(page);
  await page.screenshot({
    path: testInfo.outputPath("workspace-overview-saved-1440.png"),
  });
  await choose(page, "Learning plan");
  await page.setViewportSize({ width: 320, height: 1000 });
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath("plan-320.png") });
  await page
    .getByRole("button", {
      name: /^Evidence \d+ for “Synthetic quiet learning goal”/,
    })
    .click();
  await page
    .getByRole("button", { name: "Link saved evidence", exact: true })
    .click();
  await expect(
    page.getByLabel("Search saved evidence", { exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  await page
    .getByRole("button", { name: "Cancel linking", exact: true })
    .click();
  await choose(page, "Progress");
  await expect(
    page.getByRole("progressbar", {
      name: "Personal learning goals completed",
      exact: true,
    }),
  ).toHaveAttribute("max", "1");
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath("progress-320.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await choose(page, "Meetings");
  await page
    .getByRole("button", { name: "Prepare for meeting", exact: true })
    .click();
  await expect(page.locator("#meeting-preparation")).toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator("#meeting-preparation-heading")).toBeFocused();
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath("meeting-1440.png") });
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  const cancel = page.getByRole("dialog", {
    name: "Cancel this booking?",
    exact: true,
  });
  await expect(
    cancel.getByRole("button", { name: "Confirm cancellation", exact: true }),
  ).toBeEnabled();
  await expectAccessible(page);
  await cancel
    .getByRole("button", { name: "Keep booking", exact: true })
    .click();
  expect((await savedWorkspace(page)).activeAppointments[0]?.id).toBe(
    seed.activeBookingId,
  );
  await choose(page, "Evidence");
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    writing,
  );

  const parentContext = await browser.newContext({
    baseURL: webOrigin,
    viewport: { width: 320, height: 1000 },
  });
  try {
    await isolate(parentContext);
    const parentPage = await parentContext.newPage();
    const parent = await register(parentPage, "parent");
    const studentUid = await callFixture("findUid", student.email);
    const parentUid = await callFixture("findUid", parent.email);
    if (typeof studentUid !== "string" || typeof parentUid !== "string")
      throw new Error("Synthetic family accounts are required.");
    await callFixture("linkFamily", {
      studentUid,
      parentUid,
      consentReference: "Synthetic isolated UI validation only",
    });
    await parentPage.reload();
    await expect(
      parentPage.getByLabel("Student workspace", { exact: true }),
    ).toHaveValue(studentUid);
    await choose(parentPage, "Learning records");
    await expect(
      parentPage.getByText("Read-only.", { exact: true }),
    ).toBeVisible();
    await expect(
      parentPage.getByRole("button", { name: "Add Evidence", exact: true }),
    ).toHaveCount(0);
    await expect(
      parentPage.getByRole("button", {
        name: "Mark as read — I have read this summary",
        exact: true,
      }),
    ).toHaveCount(0);
    await expectAccessible(parentPage);
  } finally {
    await parentContext.close();
  }
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
    "Learning operations must not contact Firebase or external services",
  ).toEqual([]);
});

test("learning journey, editable goal ideas and day-first booking keep real saved state", async ({
  page,
}, testInfo) => {
  const starts = [
    Date.now() + 2 * 86_400_000,
    Date.now() + 3 * 86_400_000,
  ] as const;
  for (const [index, start] of starts.entries()) {
    await callFixture("addAvailability", {
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 1_800_000).toISOString(),
      label: `Synthetic calendar choice ${index + 1}`,
    });
  }
  await register(page);
  const journey = page.getByRole("region", {
    name: "Your learning journey",
    exact: true,
  });
  await expect(journey.getByRole("button")).toHaveCount(4);
  await journey.getByRole("button", { name: /^Your goals:/ }).click();
  await page
    .getByRole("button", { name: "Practice a skill", exact: false })
    .click();
  await expect(page.getByLabel("Goal", { exact: true })).toHaveValue(
    "Practice a skill",
  );
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByLabel("Step 1", { exact: true }).fill("Try one exercise");
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByLabel("Step 2", { exact: true }).fill("Write one short note");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  const meter = page.getByRole("progressbar", {
    name: "Checklist progress for “Practice a skill”",
    exact: true,
  });
  await expect(meter).toHaveAttribute("value", "0");
  await choose(page, "Overview");
  const primary = page.locator(".today-primary-task");
  await expect(
    primary.getByRole("heading", { name: "Try one exercise", exact: true }),
  ).toBeVisible();
  let stepUpdates = 0;
  await page.route("**/api/learning-goals/*", async (route) => {
    if (route.request().method() === "PATCH") stepUpdates++;
    await route.fallback();
  });
  const quickStep = primary.getByRole("button", {
    name: "Mark step done",
    exact: true,
  });
  await quickStep.focus();
  await quickStep.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(
    primary.getByRole("heading", { name: "Write one short note", exact: true }),
  ).toBeVisible();
  await expect(quickStep).toBeEnabled();
  await expect(quickStep).toBeFocused();
  expect(stepUpdates).toBe(1);
  await quickStep.click();
  const completedStep = primary.getByRole("button", {
    name: "Step done",
    exact: true,
  });
  await expect(completedStep).toBeDisabled();
  await expect(completedStep).toBeFocused();
  await expect(primary.getByRole("status")).toContainText(
    "All steps checked. Open goal to review.",
  );
  expect(stepUpdates).toBe(2);
  await primary.getByRole("button", { name: "Open goal", exact: true }).click();
  await expect(meter).toHaveAttribute("value", "2");
  // A checked step never silently completes its parent goal.
  await expect(
    page.getByRole("button", {
      name: "Complete “Practice a skill”",
      exact: true,
    }),
  ).toBeVisible();
  await choose(page, "Meetings");
  const days = page.getByRole("group", {
    name: "Available meeting days",
    exact: true,
  });
  await expect(days.getByRole("button")).toHaveCount(2);
  const times = page.getByRole("group", {
    name: "Available meeting times",
    exact: true,
  });
  await times.getByRole("radio").first().check();
  await days.getByRole("button").nth(1).click();
  await expect(times.getByRole("radio").first()).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Book meeting", exact: true }),
  ).toBeDisabled();
  await times.getByRole("radio").first().focus();
  await page.keyboard.press("Space");
  await expectAccessible(page);
  await page.screenshot({
    path: testInfo.outputPath("calendar-upgrade-1440.png"),
  });
  await page.getByRole("button", { name: "Book meeting", exact: true }).click();
  await expect
    .poll(async () => (await savedWorkspace(page)).activeAppointments.length)
    .toBe(1);
  expect((await savedWorkspace(page)).activeAppointments[0]?.startsAt).toBe(
    new Date(starts[1]).toISOString(),
  );
  await choose(page, "Evidence");
  await page
    .getByRole("radio", { name: "Write a reflection", exact: true })
    .check();
  await page
    .getByLabel("Your reflection", { exact: true })
    .fill("Synthetic writing kept through the upgraded learning navigation.");
  await choose(page, "Overview");
  await expect(
    journey.getByRole("button", { name: /^Meetings: 1 reserved/ }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({
    path: testInfo.outputPath("learning-upgrade-1440.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAccessible(page);
  await page.screenshot({
    path: testInfo.outputPath("learning-upgrade-390.png"),
    fullPage: true,
  });
  await choose(page, "Evidence");
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    "Synthetic writing kept through the upgraded learning navigation.",
  );
  await expectAccessible(page);
});

// Append to quietUi.browser.ts. Uses only its isolated synthetic fixture.
async function threeHourDrop(
  page: Page,
  files: Array<{ name: string; type: string; text: string }>,
) {
  await page
    .locator("#evidence-composer .evidence-file-dropzone")
    .evaluate((zone, values) => {
      const transfer = new DataTransfer();
      for (const value of values)
        transfer.items.add(
          new File([value.text], value.name, { type: value.type }),
        );
      zone.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    }, files);
}

test("upgraded Evidence keeps a valid drop through invalid replacements and navigation, then confirms one submission and resets filters", async ({
  page,
  browser,
}) => {
  const student = await register(page);
  const operatorContext = await browser.newContext({
    baseURL: webOrigin,
    timezoneId: "America/Phoenix",
  });
  try {
    await isolate(operatorContext);
    const operator = await register(await operatorContext.newPage());
    await callFixture("promote", operator.email);
    await callFixture("seedPagination", {
      studentEmail: student.email,
      operatorEmail: operator.email,
    });
  } finally {
    await operatorContext.close();
  }
  await page.reload();
  await choose(page, "Evidence");
  const library = page.locator(".evidence-library");
  await page
    .getByLabel("Show documents", { exact: true })
    .selectOption("reviewed");
  await page
    .getByLabel("Search documents", { exact: true })
    .fill("Reviewed reflection");
  await expect(
    library.getByRole("heading", { name: /^Reviewed reflection/ }).first(),
  ).toBeVisible();
  await library.getByRole("button", { name: "Add work", exact: true }).click();
  const composer = page.locator("#evidence-composer");
  const filename =
    "Synthetic learning reflection with a deliberately long filename ".repeat(
      3,
    ) + ".txt";
  const content =
    "Synthetic dropped Evidence only. No real learner or payment information.";
  await threeHourDrop(page, [
    { name: filename, type: "text/plain", text: content },
  ]);
  await expect(composer.getByText(filename, { exact: true })).toBeVisible();
  const title = "Synthetic dropped work confirmed once";
  await page.getByLabel("Evidence title", { exact: true }).fill(title);
  await threeHourDrop(page, [
    {
      name: "unsupported.png",
      type: "image/png",
      text: "synthetic invalid type",
    },
  ]);
  await expect(composer.getByRole("alert")).toContainText(
    "Choose a supported text or PDF file.",
  );
  await expect(composer.getByText(filename, { exact: true })).toBeVisible();
  await threeHourDrop(page, [
    { name: "one.txt", type: "text/plain", text: "synthetic one" },
    { name: "two.txt", type: "text/plain", text: "synthetic two" },
  ]);
  await expect(composer.getByRole("alert")).toContainText(
    "Choose one file at a time.",
  );
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    title,
  );
  await choose(page, "Overview");
  await choose(page, "Evidence");
  await expect(composer.getByText(filename, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    title,
  );
  await page.context().setOffline(true);
  try {
    await expect(
      page.locator(".workspace-sync").getByText("Offline", { exact: true }),
    ).toBeVisible();
    await expect(composer.getByText(filename, { exact: true })).toBeVisible();
    await expect(
      page.getByLabel("Evidence title", { exact: true }),
    ).toHaveValue(title);
  } finally {
    await page.context().setOffline(false);
  }
  await expect(page.locator(".workspace-sync")).not.toHaveAttribute(
    "data-offline",
    "true",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAccessible(page);
  let creates = 0,
    submissions = 0;
  await page.route("**/api/evidence/uploads", async (route) => {
    if (route.request().method() === "POST") creates++;
    await route.fallback();
  });
  await page.route("**/api/evidence/uploads/*/submit", async (route) => {
    if (route.request().method() === "POST") submissions++;
    await route.fallback();
  });
  const submit = page.getByRole("button", {
    name: "Submit evidence",
    exact: true,
  });
  await page
    .getByLabel("Evidence title", { exact: true })
    .fill("Synthetic\u0007unsupported title");
  await expect(
    page.getByLabel("Evidence title", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#evidence-title-problem")).toHaveText(
    "Remove unsupported characters from the title.",
  );
  await expect(submit).toBeDisabled();
  expect(creates).toBe(0);
  expect(submissions).toBe(0);
  await page.getByLabel("Evidence title", { exact: true }).fill(title);
  await expect(submit).toBeEnabled();
  await composer
    .getByRole("button", { name: "Clear form", exact: true })
    .click();
  await expect(submit).toBeDisabled();
  await expect(
    page.getByLabel("Evidence title", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Keep editing", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Clear unsent work?", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    title,
  );
  await expect(composer.getByText(filename, { exact: true })).toBeVisible();
  await expect(submit).toBeEnabled();
  expect(creates).toBe(0);
  await submit.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.locator(".student-evidence-receipt")).toContainText(title);
  await expect(page.getByLabel("Show documents", { exact: true })).toHaveValue(
    "current",
  );
  await expect(
    page.getByLabel("Search documents", { exact: true }),
  ).toHaveValue("");
  await expect(
    library.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const saved = await savedWorkspace(page);
  expect(saved.progress.submittedEvidenceCount).toBe(132);
  expect(saved.evidence.find((item) => item.title === title)).toMatchObject({
    contentType: "text/plain",
    size: Buffer.byteLength(content),
  });
  expect(creates).toBe(1);
  expect(submissions).toBe(1);
});

test("an unconfirmed private-draft clear blocks drops and checking its real empty receipt keeps the selected file and title", async ({
  page,
}) => {
  await register(page);
  await choose(page, "Evidence");
  await page
    .getByRole("radio", { name: "Write a reflection", exact: true })
    .check();
  await page
    .getByLabel("Your reflection", { exact: true })
    .fill("Synthetic saved private writing for a clear-recovery check.");
  const draft = page.getByRole("region", {
    name: "Private reflection draft",
    exact: true,
  });
  await draft
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await expect(
    draft.getByRole("status").filter({ hasText: "Draft saved." }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Upload a file", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard draft and switch", exact: true })
    .click();
  const filename = "synthetic-original-kept.txt";
  await page.getByLabel("Choose a file", { exact: true }).setInputFiles({
    name: filename,
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Synthetic selected file kept after an uncertain clear.",
    ),
  });
  const title = "Synthetic unsent file title";
  await page.getByLabel("Evidence title", { exact: true }).fill(title);
  let cleared = 0;
  await page.route("**/api/reflection-draft/clear", async (route) => {
    cleared++;
    const committed = await route.fetch({
      url: `${apiOrigin}/api/reflection-draft/clear`,
    });
    expect(committed.ok()).toBe(true);
    await route.abort("connectionfailed");
  });
  await draft
    .getByRole("button", { name: "Clear saved draft", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Clear your saved draft?", exact: true })
    .getByRole("button", { name: "Clear saved draft", exact: true })
    .click();
  await expect(draft.getByRole("alert")).toContainText(
    "may have reached the server",
  );
  await expect(
    page.getByLabel("Choose a file", { exact: true }),
  ).toBeDisabled();
  await threeHourDrop(page, [
    {
      name: "blocked-replacement.txt",
      type: "text/plain",
      text: "This synthetic replacement must be ignored.",
    },
  ]);
  const composer = page.locator("#evidence-composer");
  await expect(composer.getByText(filename, { exact: true })).toBeVisible();
  await expect(
    composer.getByText("blocked-replacement.txt", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    title,
  );
  await draft
    .getByRole("button", { name: "Check saved draft", exact: true })
    .click();
  // No saved draft is left, so the file-mode draft receipt becomes hidden.
  await expect(page.locator(".reflection-draft")).toBeHidden();
  await expect(page.getByLabel("Choose a file", { exact: true })).toBeEnabled();
  await expect(
    page.getByRole("dialog", {
      name: "Replace the writing in this tab?",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(composer.getByText(filename, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    title,
  );
  expect(cleared).toBe(1);
  const checked = await page.evaluate(async () => {
    const response = await fetch("/api/reflection-draft", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Synthetic draft confirmation failed.");
    return response.json();
  });
  expect(checked).toMatchObject({
    status: "empty",
    title: "",
    text: "",
    version: 2,
  });
});

// Append to quietUi.browser.ts for the final targeted validation phase.
// These cases use the real isolated API/database and synthetic fixture accounts.
// Do not run this fragment as a standalone test module.

test("ended reservation retains exact unsent preparation for copy, selection and explicit local discard", async ({
  page,
  context,
}) => {
  const start = Date.now() + 2 * 86_400_000;
  await callFixture("addAvailability", {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 1_800_000).toISOString(),
    label: "Synthetic preparation reservation",
  });
  const student = await register(page);
  await choose(page, "Meetings");
  await page
    .getByRole("group", { name: "Available meeting times", exact: true })
    .getByRole("radio")
    .first()
    .check();
  await page.getByRole("button", { name: "Book meeting", exact: true }).click();
  await expect
    .poll(async () => (await savedWorkspace(page)).activeAppointments.length)
    .toBe(1);
  const booking = (await savedWorkspace(page)).activeAppointments[0];
  if (!booking) throw new Error("A synthetic saved reservation is required.");
  await page
    .getByRole("button", { name: "Prepare for meeting", exact: true })
    .click();
  const preparation = page.locator("#meeting-preparation");
  const notes = preparation.getByLabel("Learning notes (optional)", {
    exact: true,
  });
  const savedNote = "Synthetic saved preparation stays on the server.";
  await notes.fill(savedNote);
  await preparation
    .getByRole("button", { name: "Save notes", exact: true })
    .click();
  await expect(preparation.locator(".meeting-preparation-status")).toHaveText(
    "Your meeting preparation was saved.",
  );
  const readSavedPreparation = () =>
    page.evaluate(async (appointmentId) => {
      const response = await fetch(
        `/api/appointments/${appointmentId}/preparation`,
        {
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("Synthetic preparation read failed.");
      return response.json() as Promise<{
        appointmentId: string;
        ownerUid: string;
        note: string;
        goalId: string | null;
        ready: boolean;
        version: number;
        updatedAt: string;
      }>;
    }, booking.id);
  const savedBefore = await readSavedPreparation();
  expect(savedBefore.note).toBe(savedNote);
  expect(savedBefore.version).toBe(1);

  const unsent = "Synthetic unsent first line.\nSecond line remains exact.";
  await notes.fill(unsent);
  await preparation
    .getByRole("checkbox", {
      name: "My learning materials are ready",
      exact: true,
    })
    .check();
  let subsequentWrites = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      new URL(request.url()).pathname ===
        `/api/appointments/${booking.id}/preparation`
    )
      subsequentWrites++;
  });

  // The IPC fixture moves this synthetic booking across its real API boundary;
  // no frontend response is fabricated and no production account is involved.
  await callFixture("endBooking", student.email);
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  await expect(page.locator(".student-preparation-retained")).toBeVisible();
  await expect
    .poll(async () => (await savedWorkspace(page)).activeAppointments.length)
    .toBe(0);
  const unsentNotes = preparation.getByLabel("Unsent learning notes", {
    exact: true,
  });
  await expect(unsentNotes).toHaveValue(unsent);
  await expect(unsentNotes).toHaveAttribute("readonly", "");
  await expect(
    preparation.getByRole("button", { name: "Save notes", exact: true }),
  ).toHaveCount(0);
  await expect(
    preparation
      .locator(".meeting-preparation-unsent-choices > div")
      .filter({
        has: page.getByText("Unsent materials", { exact: true }),
      })
      .locator("dd"),
  ).toHaveText("Ready");

  // The manual selection path works without relying on clipboard permissions.
  await preparation
    .getByRole("button", { name: "Select text", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(unsentNotes).toBeFocused();
  expect(
    await unsentNotes.evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      return input.value.slice(input.selectionStart, input.selectionEnd);
    }),
  ).toBe(unsent);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: webOrigin,
  });
  await preparation
    .getByRole("button", { name: "Copy notes", exact: true })
    .click();
  await expect(
    preparation.locator(".meeting-preparation-copy-status"),
  ).toHaveText("Copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    unsent,
  );
  expect(await readSavedPreparation()).toEqual(savedBefore);

  await preparation
    .getByRole("button", { name: "Discard local draft", exact: true })
    .click();
  const confirm = preparation.getByRole("group", {
    name: "Discard this local draft?",
    exact: true,
  });
  await expect(
    confirm.getByRole("button", { name: "Keep draft", exact: true }),
  ).toBeFocused();
  await confirm
    .getByRole("button", { name: "Keep draft", exact: true })
    .click();
  await expect(unsentNotes).toHaveValue(unsent);
  await preparation
    .getByRole("button", { name: "Discard local draft", exact: true })
    .click();
  await confirm
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(preparation).toHaveCount(0);
  await expect(page.locator("#meetings-heading")).toBeFocused();
  expect(await readSavedPreparation()).toEqual(savedBefore);
  expect(
    subsequentWrites,
    "Copy, selection and local discard never PATCH saved notes",
  ).toBe(0);
  await expectAccessible(page);
});

test("mobile day navigation separates keyboard browsing from choosing and books the selected published time", async ({
  page,
}) => {
  const firstStart = Date.now() + 2 * 86_400_000;
  const secondStart = firstStart + 86_400_000;
  for (const [index, startsAt] of [firstStart, secondStart].entries()) {
    await callFixture("addAvailability", {
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + 1_800_000).toISOString(),
      label: `Synthetic keyboard time ${index + 1}`,
    });
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await register(page);
  await choose(page, "Meetings");
  const days = page.getByRole("group", {
    name: "Available meeting days",
    exact: true,
  });
  const first = days.getByRole("button").nth(0);
  const second = days.getByRole("button").nth(1);
  await expect(days.getByRole("button")).toHaveCount(2);
  await expect(first).toHaveAttribute("tabindex", "0");
  await expect(second).toHaveAttribute("tabindex", "-1");
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(second).toBeFocused();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(second).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(second).toHaveAttribute("tabindex", "0");
  await expect(first).toHaveAttribute("tabindex", "-1");
  const times = page.getByRole("group", {
    name: "Available meeting times",
    exact: true,
  });
  await expect(times.getByRole("radio")).toHaveCount(1);
  await expect(times.locator(".meeting-slot-check")).toBeHidden();
  await times.getByRole("radio").focus();
  await page.keyboard.press("Space");
  await expect(times.getByRole("radio")).toBeChecked();
  await expect(times.locator(".meeting-slot-check")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Quick navigation", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".meeting-selection-summary")).toContainText(
    "Synthetic keyboard time 2",
  );
  await expectAccessible(page);
  await page.getByRole("button", { name: "Book meeting", exact: true }).click();
  await expect
    .poll(
      async () => (await savedWorkspace(page)).activeAppointments[0]?.startsAt,
    )
    .toBe(new Date(secondStart).toISOString());
  await expect(page.locator("#current-booking-heading")).toBeFocused();
  await expect(page.locator(".meeting-current-time")).not.toBeEmpty();
  await expect(page.locator(".meeting-connection-note")).toContainText(
    "Live link not connected",
  );
  await expectAccessible(page);
});

// Append to quietUi.browser.ts; uses the suite's temporary real server only.
// Hold a genuine pre-rotation workspace read, then deliver its obsolete body.
// Client API fences remain enabled; only the root's authoritative re-check
// decides whether the same identity's in-memory forms and File may survive.

test("a delayed pre-password workspace response rechecks the same account without discarding unsent goal and File", async ({
  page,
}) => {
  const account = await register(page);
  const startsAt = new Date(Date.now() + 86_400_000);
  const slot = (await callFixture("addAvailability", {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 1_800_000).toISOString(),
    label: "Synthetic session-continuity meeting",
  })) as { id: string };
  const booking = await page.evaluate(async (slotId) => {
    const session = (await (
      await fetch("/api/session", {
        credentials: "same-origin",
        cache: "no-store",
      })
    ).json()) as { csrfToken: string; session: { uid: string } };
    const response = await fetch("/api/appointments", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
        "X-TALA-User": session.session.uid,
      },
      body: JSON.stringify({ slotId, requestId: crypto.randomUUID() }),
    });
    if (!response.ok) throw new Error("Synthetic continuity booking failed.");
    return response.json() as Promise<{ id: string; ownerUid: string }>;
  }, slot.id);
  await page.reload();
  await choose(page, "Learning plan");
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  const goalDraft = "Synthetic unsent goal survives same-account rotation";
  await page.getByLabel("Goal", { exact: true }).fill(goalDraft);
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page
    .getByLabel("Step 1", { exact: true })
    .fill("Keep this unsent checklist item");
  await page
    .getByRole("checkbox", { name: "Step 1 completed", exact: true })
    .check();
  await choose(page, "Evidence");
  await page.getByRole("radio", { name: "Upload a file", exact: true }).check();
  const fileName = "synthetic-session-private.txt";
  await page.locator("#evidence-file").setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Synthetic private file: do not discard or submit on a session re-check.",
    ),
  });
  const evidenceTitle = "Synthetic unsent file retained";
  await page.getByLabel("Evidence title", { exact: true }).fill(evidenceTitle);
  await page
    .getByLabel("Related booking", { exact: true })
    .selectOption(booking.id);
  await expect(page.locator(".evidence-file-picker-copy strong")).toHaveText(
    fileName,
  );
  let release = () => {};
  let captured = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let intercepted = false;
  const workspacePattern = "**/api/workspace";
  await page.route(workspacePattern, async (route) => {
    if (intercepted || route.request().method() !== "GET")
      return route.fallback();
    intercepted = true;
    const response = await route.fetch({ url: `${apiOrigin}/api/workspace` });
    expect(response.ok()).toBe(true);
    captured();
    await held;
    await route.fulfill({ response });
  });
  let released = false;
  let sessionReadsAfterRelease = 0;
  page.on("request", (request) => {
    if (released && new URL(request.url()).pathname === "/api/session")
      sessionReadsAfterRelease++;
  });
  try {
    await page
      .getByRole("button", { name: "Refresh records", exact: true })
      .click();
    await ready;
    await page
      .getByRole("link", { name: "Account security", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Account security", exact: true }),
    ).toBeVisible();
    const replacement = `Synthetic-rotated-${randomUUID()}`;
    await page
      .getByLabel("Current password", { exact: true })
      .fill(account.password);
    await page.getByLabel("New password", { exact: true }).fill(replacement);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(replacement);
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(page.locator(".account-security-success")).toContainText(
      "Password changed.",
    );
    released = true;
    release();
    await expect.poll(() => sessionReadsAfterRelease).toBeGreaterThan(0);
    await expect(
      page.getByRole("heading", { name: "Account security", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Welcome back.", exact: true }),
    ).toHaveCount(0);
    const currentUid = await page.evaluate(
      async () =>
        (
          (await (
            await fetch("/api/session", {
              credentials: "same-origin",
              cache: "no-store",
            })
          ).json()) as { session: { uid: string } }
        ).session.uid,
    );
    expect(currentUid).toBe(booking.ownerUid);
    await page
      .getByRole("link", { name: "Back to workspace", exact: true })
      .click();
    await expect(
      page.getByLabel("Evidence title", { exact: true }),
    ).toHaveValue(evidenceTitle);
    await expect(page.locator(".evidence-file-picker-copy strong")).toHaveText(
      fileName,
    );
    await expect(
      page.getByLabel("Related booking", { exact: true }),
    ).toHaveValue(booking.id);
    await expect(page).toHaveTitle("Evidence | TALA");
    await choose(page, "Learning plan");
    await expect(page.getByLabel("Goal", { exact: true })).toHaveValue(
      goalDraft,
    );
    await expect(page.getByLabel("Step 1", { exact: true })).toHaveValue(
      "Keep this unsent checklist item",
    );
    await expect(
      page.getByRole("checkbox", { name: "Step 1 completed", exact: true }),
    ).toBeChecked();
    await expect(page).toHaveTitle("Learning plan | TALA");
    const count = await page.evaluate(
      async () =>
        (
          (await (
            await fetch("/api/learning-goals", {
              credentials: "same-origin",
              cache: "no-store",
            })
          ).json()) as { goals: unknown[] }
        ).goals.length,
    );
    expect(count).toBe(0);
    expect((await savedWorkspace(page)).progress.submittedEvidenceCount).toBe(
      0,
    );
    await expectAccessible(page);
  } finally {
    release();
    await page.unroute(workspacePattern);
  }
});

// Append to quietUi.browser.ts: uses its isolated real-server fixture and helpers.
// No external services, shared data, screenshots or additional suite lifecycle.

test("goal checklist order survives saving and reload while dirty cancellation preserves its draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await register(page);
  await choose(page, "Learning plan");
  const planRegion = page.getByRole("region", {
    name: "Learning plan",
    exact: true,
  });
  await expect(
    planRegion.getByRole("heading", {
      name: "Start with one small goal.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    planRegion.getByLabel("Search learning goals", { exact: true }),
  ).toHaveCount(0);
  await expect(
    planRegion.getByRole("button", { name: "Active goals (0)", exact: true }),
  ).toHaveCount(0);
  await planRegion
    .getByRole("button", { name: "Add goal", exact: true })
    .click();
  const goalTitle = "A small synthetic practice plan";
  await page.getByLabel("Goal", { exact: true }).fill(goalTitle);
  const titles = [
    "Choose one example",
    "Practice explaining it",
    "Write a reflection",
  ];
  for (let index = 0; index < titles.length; index++) {
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    await page
      .getByLabel(`Step ${index + 1}`, { exact: true })
      .fill(titles[index]!);
  }
  await page
    .getByRole("checkbox", { name: "Step 2 completed", exact: true })
    .check();
  await page
    .getByLabel("Move step 3 to position", { exact: true })
    .selectOption("0");
  await expect(
    page.getByLabel("Move step 1 to position", { exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Step 1", { exact: true })).toHaveValue(
    titles[2]!,
  );
  await expect(page.getByLabel("Step 2", { exact: true })).toHaveValue(
    titles[0]!,
  );
  await expect(page.getByLabel("Step 3", { exact: true })).toHaveValue(
    titles[1]!,
  );
  await expect(
    page.getByRole("checkbox", { name: "Step 3 completed", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  const goalRow = planRegion
    .getByRole("list", { name: "Saved learning goals", exact: true })
    .locator(":scope > li")
    .filter({
      has: page.getByRole("heading", { name: goalTitle, exact: true }),
    });
  await expect(goalRow).toHaveCount(1);
  const readGoals = () =>
    page.evaluate(async () => {
      const response = await fetch("/api/learning-goals", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Synthetic goal read failed.");
      return response.json() as Promise<{
        goals: Array<{
          id: string;
          version: number;
          steps: Array<{ id: string; title: string; completed: boolean }>;
        }>;
      }>;
    });
  const original = (await readGoals()).goals[0]!;
  expect(original.steps.map((step) => step.title)).toEqual([
    titles[2],
    titles[0],
    titles[1],
  ]);
  expect(original.steps.map((step) => step.completed)).toEqual([
    false,
    false,
    true,
  ]);
  expect(new Set(original.steps.map((step) => step.id)).size).toBe(3);
  await goalRow
    .getByRole("button", { name: `Edit “${goalTitle}”`, exact: true })
    .click();
  await page
    .getByLabel("Move step 1 to position", { exact: true })
    .selectOption("2");
  await expect(page.getByLabel("Step 3", { exact: true })).toHaveValue(
    titles[2]!,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Discard unsaved changes?",
      exact: true,
    }),
  ).toBeFocused();
  // Enter cannot silently save while the discard decision is open.
  await page.getByLabel("Goal", { exact: true }).press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "Discard unsaved changes?",
      exact: true,
    }),
  ).toBeVisible();
  expect((await readGoals()).goals[0]!.version).toBe(original.version);
  // Escape keeps the local order and returns to the same editable goal.
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Goal", { exact: true })).toBeFocused();
  await expect(
    page.getByRole("heading", {
      name: "Discard unsaved changes?",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Goal", { exact: true })).toHaveValue(goalTitle);
  await expect(page.getByLabel("Step 3", { exact: true })).toHaveValue(
    titles[2]!,
  );
  expect((await readGoals()).goals[0]!.steps).toEqual(original.steps);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Edit goal", exact: true }),
  ).toHaveCount(0);
  expect((await readGoals()).goals[0]!.steps).toEqual(original.steps);
  await goalRow
    .getByRole("button", { name: `Edit “${goalTitle}”`, exact: true })
    .click();
  await page
    .getByLabel("Move step 1 to position", { exact: true })
    .selectOption("2");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Edit goal", exact: true }),
  ).toHaveCount(0);
  const expectedSteps = [...original.steps.slice(1), original.steps[0]!];
  const changed = (await readGoals()).goals[0]!;
  expect(changed.id).toBe(original.id);
  expect(changed.version).toBe(original.version + 1);
  expect(changed.steps).toEqual(expectedSteps);
  await page.reload();
  await expect(goalRow).toHaveCount(1);
  expect((await readGoals()).goals[0]!.steps).toEqual(expectedSteps);
  await expect(
    goalRow.getByRole("checkbox", {
      name: `Reopen step “${titles[1]}”`,
      exact: true,
    }),
  ).toBeChecked();
  await choose(page, "Progress");
  await expect(
    page.getByRole("progressbar", {
      name: "Personal learning steps completed",
      exact: true,
    }),
  ).toHaveAttribute("value", "1");
  await expect(
    page.getByRole("progressbar", {
      name: "Personal learning goals completed",
      exact: true,
    }),
  ).toHaveAttribute("value", "0");
  await expectAccessible(page);
});

test("learning note read acknowledgements keep exact outcome errors and never reclaim search focus", async ({
  page,
  browser,
}) => {
  const student = await register(page);
  const operatorContext = await browser.newContext({
    baseURL: webOrigin,
    timezoneId: "America/Phoenix",
  });
  let record: { id: string; outcomes: Array<{ id: string; summary: string }> };
  try {
    await isolate(operatorContext);
    const operatorPage = await operatorContext.newPage();
    const operator = await register(operatorPage);
    await callFixture("promote", operator.email);
    const seeded = (await callFixture("seedPagination", {
      studentEmail: student.email,
      operatorEmail: operator.email,
    })) as { oldBookingId: string };
    record = await operatorPage.evaluate(async (appointmentId) => {
      const session = (await (
        await fetch("/api/session", {
          credentials: "same-origin",
          cache: "no-store",
        })
      ).json()) as { session: { uid: string }; csrfToken: string };
      const response = await fetch("/api/outcomes", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "X-TALA-User": session.session.uid,
        },
        body: JSON.stringify({
          appointmentId,
          requestId: crypto.randomUUID(),
          outcomes: [
            {
              id: crypto.randomUUID(),
              summary: "Synthetic first outcome: describe one observation.",
            },
            {
              id: crypto.randomUUID(),
              summary: "Synthetic second outcome: explain a useful example.",
            },
          ],
        }),
      });
      if (!response.ok)
        throw new Error("Synthetic multi-outcome publication failed.");
      return response.json();
    }, seeded.oldBookingId);
  } finally {
    await operatorContext.close();
  }
  await page.reload();
  await choose(page, "Learning records");
  const recordRow = page
    .getByRole("list", { name: "Saved learning records", exact: true })
    .locator(":scope > li")
    .filter({ hasText: record!.outcomes[0]!.summary });
  await expect(recordRow).toHaveCount(1);
  const outcomes = recordRow.locator(".learning-records-outcomes > li");
  const first = outcomes.filter({ hasText: record!.outcomes[0]!.summary });
  const second = outcomes.filter({ hasText: record!.outcomes[1]!.summary });
  const readLabel = "Mark as read — I have read this summary";
  await expect(
    first.getByRole("button", { name: readLabel, exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole("button", { name: readLabel, exact: true }),
  ).toBeVisible();
  const attempts: Array<{ outcomeId: string; requestId: string }> = [];
  let release = () => {};
  let started = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const ackPattern = `**/api/outcomes/${record!.id}/acknowledge`;
  await page.route(ackPattern, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    attempts.push(
      route.request().postDataJSON() as {
        outcomeId: string;
        requestId: string;
      },
    );
    if (attempts.length === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "UNAVAILABLE" } }),
      });
    if (attempts.length === 3) {
      const response = await route.fetch({
        url: `${apiOrigin}${new URL(route.request().url()).pathname}`,
      });
      expect(response.ok()).toBe(true);
      started();
      await held;
      return route.fulfill({ response });
    }
    return route.fallback();
  });
  try {
    await first.getByRole("button", { name: readLabel, exact: true }).click();
    await expect(first.getByRole("alert")).toHaveText(
      "Read status not confirmed. Try again.",
    );
    await expect(second.getByRole("alert")).toHaveCount(0);
    await expect(second.locator(".learning-records-reviewed")).toHaveCount(0);
    await first.getByRole("button", { name: readLabel, exact: true }).click();
    await expect(first.locator(".learning-records-reviewed")).toHaveText(
      "Read",
    );
    await expect(first.locator(".learning-records-reviewed")).toBeFocused();
    expect(attempts[1]!.outcomeId).toBe(record!.outcomes[0]!.id);
    expect(attempts[1]!.requestId).toBe(attempts[0]!.requestId);
    await expect(
      second.getByRole("button", { name: readLabel, exact: true }),
    ).toBeVisible();
    await second.getByRole("button", { name: readLabel, exact: true }).click();
    await ready;
    const search = page.getByLabel("Search learning records", { exact: true });
    await search.fill("no-synthetic-outcome-matches-this-query");
    release();
    await expect(
      page.getByRole("heading", { name: "No matching notes.", exact: true }),
    ).toBeVisible();
    await expect(search).toBeFocused();
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    await expect(recordRow.locator(".learning-records-reviewed")).toHaveCount(
      2,
    );
    await expect(
      page.getByLabel("Search learning records", { exact: true }),
    ).toBeFocused();
    expect(attempts.map((attempt) => attempt.outcomeId)).toEqual([
      record!.outcomes[0]!.id,
      record!.outcomes[0]!.id,
      record!.outcomes[1]!.id,
    ]);
    await expectAccessible(page);
  } finally {
    release();
    await page.unroute(ackPattern);
  }
});

test("refresh recovery submits the same original Evidence file once after an interrupted upload", async ({
  page,
}) => {
  const startsAt = Date.now() + 2 * 86_400_000;
  await callFixture("addAvailability", {
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + 1_800_000).toISOString(),
    label: "Synthetic recovery meeting",
  });
  await register(page);
  await choose(page, "Meetings");
  await page
    .getByRole("group", { name: "Available meeting times", exact: true })
    .getByRole("radio")
    .check();
  await page.getByRole("button", { name: "Book meeting", exact: true }).click();
  await expect
    .poll(async () => (await savedWorkspace(page)).activeAppointments.length)
    .toBe(1);
  const booking = (await savedWorkspace(page)).activeAppointments[0]!;
  await choose(page, "Evidence");
  const title = "Synthetic original file recovered after refresh";
  const original = {
    name: "synthetic-refresh-original.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic refresh recovery. No real learner data."),
  };
  await page
    .getByLabel("Choose a file", { exact: true })
    .setInputFiles(original);
  await page.getByLabel("Evidence title", { exact: true }).fill(title);
  let creates = 0,
    submissions = 0,
    interrupted = 0;
  await page.route("**/api/evidence/uploads", async (route) => {
    if (route.request().method() === "POST") creates++;
    await route.fallback();
  });
  await page.route("**/api/evidence/uploads/*/submit", async (route) => {
    if (route.request().method() === "POST") submissions++;
    await route.fallback();
  });
  const contentRoute = "**/api/evidence/uploads/*/content";
  await page.route(contentRoute, async (route) => {
    interrupted++;
    await route.abort("connectionfailed");
  });
  await page
    .getByRole("button", { name: "Submit evidence", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry this upload", exact: true }),
  ).toBeEnabled();
  const readPending = () =>
    page.evaluate(async () => {
      const response = await fetch("/api/evidence/uploads", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Synthetic upload read failed.");
      return response.json() as Promise<ApiPendingUploads>;
    });
  const staged = (await readPending()).uploads;
  expect(staged).toHaveLength(1);
  expect(staged[0]).toMatchObject({
    title,
    appointmentId: booking.id,
    status: "pending",
    size: original.buffer.length,
    contentType: original.mimeType,
  });
  expect(creates).toBe(1);
  expect(submissions).toBe(0);
  expect(interrupted).toBe(1);
  expect((await savedWorkspace(page)).evidence).toHaveLength(0);
  await page.unroute(contentRoute);
  let acceptedReload = false;
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    acceptedReload = true;
    await dialog.accept();
  });
  await page.reload();
  expect(acceptedReload).toBe(true);
  await choose(page, "Evidence");
  const recovery = page
    .getByRole("list", {
      name: "Your unfinished Evidence uploads",
      exact: true,
    })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(recovery).toHaveCount(1);
  await expect(
    recovery.getByText("File needed", { exact: true }),
  ).toBeVisible();
  await recovery
    .getByLabel(`Choose original file for ${title}`, { exact: true })
    .setInputFiles(original);
  await expect(
    recovery.getByText(original.name, { exact: true }),
  ).toBeVisible();
  await recovery
    .getByRole("button", { name: "Upload and submit", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    page.locator(".evidence-library").getByRole("heading", {
      name: title,
      exact: true,
    }),
  ).toBeVisible();
  await expect(recovery).toHaveCount(0);
  const saved = await savedWorkspace(page);
  expect(saved.evidence).toHaveLength(1);
  expect(saved.evidence[0]).toMatchObject({
    id: staged[0]!.uploadId,
    ownerUid: booking.ownerUid,
    appointmentId: booking.id,
    title,
    size: original.buffer.length,
    sha256: staged[0]!.sha256,
    contentType: original.mimeType,
    status: "submitted",
  });
  expect(saved.progress.submittedEvidenceCount).toBe(1);
  expect((await readPending()).uploads).toHaveLength(0);
  expect(creates).toBe(1);
  expect(submissions).toBe(1);
  await page
    .getByRole("button", { name: "Dismiss upload confirmation", exact: true })
    .click();
  await expect(
    page.locator(".evidence-library").getByRole("heading", {
      name: "Submitted documents",
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Unfinished uploads", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".pending-uploads")).toHaveCount(0);
});
