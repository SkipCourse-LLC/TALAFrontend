import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface TestApplication {
  operator: {
    addAvailability(input: {
      startsAt: string;
      endsAt: string;
      label: string;
    }): Promise<{ id: string }>;
    linkFamily(input: {
      studentUid: string;
      parentUid: string;
      consentReference: string;
    }): Promise<unknown>;
    promote(email: string): Promise<unknown>;
  };
  findUid(email: string): Promise<string>;
  endBooking(email: string): Promise<{ appointmentId: string }>;
  close(): Promise<void>;
}
let application: TestApplication;
let dataDir = "";
let unexpectedHosts: string[] = [];
let runtimeFailures: string[] = [];
const evidenceBytes = Buffer.from(
  "Synthetic product test reflection only. A learner explained one solution. No real personal data.",
);

async function startIsolatedApplication(
  directory: string,
): Promise<TestApplication> {
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
        NODE_OPTIONS: "",
        NODE_ENV: "test",
        TALA_BROWSER_TEST_DATA_DIR: directory,
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const requests = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  let ready: (() => void) | undefined;
  let startupTimeout: ReturnType<typeof setTimeout> | undefined;
  const started = new Promise<void>((resolve, reject) => {
    ready = resolve;
    startupTimeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("The isolated Node test server did not become ready."));
    }, 10_000);
    child.once("error", reject);
    child.once("exit", () => {
      const failure = new Error("The isolated Node test server exited.");
      reject(failure);
      for (const request of requests.values()) {
        clearTimeout(request.timeout);
        request.reject(failure);
      }
      requests.clear();
    });
  });
  child.on(
    "message",
    (message: {
      ready?: boolean;
      id?: string;
      result?: unknown;
      error?: string;
    }) => {
      if (message.ready) ready?.();
      if (!message.id) return;
      const request = requests.get(message.id);
      requests.delete(message.id);
      if (request) clearTimeout(request.timeout);
      if (message.error) request?.reject(new Error(message.error));
      else request?.resolve(message.result);
    },
  );
  const call = (action: string, input: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (!child.connected) {
        reject(new Error("The isolated fixture server is unavailable."));
        return;
      }
      const id = randomUUID();
      const timeout = setTimeout(() => {
        requests.delete(id);
        reject(new Error("The isolated fixture operation timed out."));
      }, 10_000);
      requests.set(id, { resolve, reject, timeout });
      child.send({ id, action, input });
    });
  try {
    await started;
  } finally {
    clearTimeout(startupTimeout);
  }
  return {
    operator: {
      addAvailability: async (input) =>
        (await call("addAvailability", input)) as { id: string },
      linkFamily: (input) => call("linkFamily", input),
      promote: (email) => call("promote", email),
    },
    endBooking: async (email) =>
      (await call("endBooking", email)) as { appointmentId: string },
    findUid: async (email) => {
      const value = await call("findUid", email);
      if (typeof value !== "string")
        throw new Error("The generated fixture account was not found.");
      return value;
    },
    close: async () => {
      if (child.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      });
    },
  };
}

test.beforeEach(async ({ context, page }) => {
  dataDir = await mkdtemp(join(tmpdir(), "tala-product-browser-"));
  application = await startIsolatedApplication(dataDir);
  unexpectedHosts = [];
  runtimeFailures = [];
  page.on("pageerror", () =>
    runtimeFailures.push("Unhandled product runtime error"),
  );
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
    )
      await route.continue();
    else {
      unexpectedHosts.push(url.hostname);
      await route.abort();
    }
  });
});
test.afterEach(async ({ page }) => {
  await page.close();
  try {
    await application?.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
  expect(runtimeFailures).toEqual([]);
  expect(
    [...new Set(unexpectedHosts)],
    "Independent product must not contact Firebase or external providers",
  ).toEqual([]);
});

async function register(
  page: Page,
  role: "student" | "parent" = "student",
  loseSavedResponse = false,
) {
  const suffix = randomUUID();
  const account = {
    name: `Synthetic ${role}`,
    email: `${suffix}@example.test`,
    password: `Synthetic-only-${suffix}`,
  };
  await page.goto("/#/register");
  await page.getByLabel("Name", { exact: true }).fill(account.name);
  await page
    .getByRole("combobox", { name: /^Account type/ })
    .selectOption(role);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(account.password);
  if (loseSavedResponse)
    await page.route("**/api/auth/register", async (route) => {
      // Complete the real server write/cookie rotation, then lose its browser
      // response. Recovery must inspect the saved session, not register twice.
      const saved = await route.fetch();
      expect(saved.ok()).toBe(true);
      await route.abort("connectionfailed");
    });
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  if (loseSavedResponse) {
    await expect(page.getByRole("alert")).toContainText("could not be reached");
    await page.unroute("**/api/auth/register");
    await page
      .getByRole("button", { name: "Check saved session", exact: true })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: `Hello, ${account.name}.`, exact: true }),
  ).toBeVisible();
  return account;
}
async function publishTimes() {
  for (let offset = 0; offset < 3; offset++) {
    const start = new Date(Date.now() + 86_400_000 + offset * 3_600_000);
    await application.operator.addAvailability({
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 1_800_000).toISOString(),
      label: `Published test time ${offset + 1}`,
    });
  }
}
type WorkspaceView =
  "overview" | "meetings" | "learning" | "evidence" | "progress";
async function chooseView(page: Page, view: WorkspaceView) {
  const names: Record<WorkspaceView, string> = {
    overview: "Overview",
    meetings: "Meetings",
    learning: "Learning records",
    evidence: "Evidence",
    progress: "Progress",
  };
  const button = page
    .getByRole("navigation", { name: "Workspace sections", exact: true })
    .getByRole("button", { name: names[view], exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
  expect(new URL(page.url()).hash).toContain(`view=${view}`);
}
async function capture(page: Page, filename: string) {
  await page.evaluate(() =>
    window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
  );
  await page.screenshot({ path: join(tmpdir(), filename), fullPage: true });
}
async function book(page: Page) {
  await chooseView(page, "meetings");
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  const select = page.getByLabel("Available meeting time", { exact: true });
  await expect(select).toBeEnabled();
  const id = await select.locator("option").nth(1).getAttribute("value");
  expect(Boolean(id)).toBe(true);
  await select.selectOption(id!);
  await page.getByRole("button", { name: "Book meeting", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your booking was saved to the server." }),
  ).toBeVisible();
}
async function fillEvidence(page: Page) {
  await page
    .getByLabel("Evidence title", { exact: true })
    .fill("Synthetic persisted reflection");
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "synthetic-reflection.txt",
    mimeType: "text/plain",
    buffer: evidenceBytes,
  });
}
async function submitEvidence(page: Page, refill = true) {
  if (refill) await fillEvidence(page);
  await page
    .getByRole("button", { name: "Submit evidence", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Evidence and its private file were saved to the server.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic persisted reflection",
      exact: true,
    }),
  ).toBeVisible();
}
async function downloadEvidence(
  page: Page,
  buttonName = "Download Synthetic persisted reflection",
  expectedBytes = evidenceBytes,
) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: buttonName,
      exact: true,
    })
    .click();
  const download = await pending;
  expect(/^evidence-[a-f0-9-]+\.txt$/.test(download.suggestedFilename())).toBe(
    true,
  );
  const path = await download.path();
  expect(Boolean(path)).toBe(true);
  expect(
    (await readFile(path!)).equals(expectedBytes),
    "Private download should match the submitted bytes",
  ).toBe(true);
  await download.delete();
}
async function login(
  page: Page,
  account: { email: string; password: string },
  operator = false,
) {
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: operator ? "Learning operations" : /^Hello,/,
    }),
  ).toBeVisible();
}
async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
}

test("student registration, booking changes, private file persistence and mobile keyboard access use the independent server", async ({
  page,
  context,
}) => {
  const account = await register(page);
  await chooseView(page, "meetings");
  await expect(
    page.getByText("No meeting times are available.", { exact: false }),
  ).toBeVisible();
  await publishTimes();
  await book(page);
  const select = page.getByLabel("Available meeting time", { exact: true });
  await select.selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "Change booking", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your booking was changed on the server." }),
  ).toBeVisible();
  await chooseView(page, "evidence");
  await fillEvidence(page);
  await chooseView(page, "progress");
  await expect(
    page.getByLabel("Evidence title", { exact: true }),
  ).not.toBeVisible();
  await chooseView(page, "evidence");
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    "Synthetic persisted reflection",
  );
  expect(
    await page
      .getByLabel("File", { exact: true })
      .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe("synthetic-reflection.txt");
  await submitEvidence(page, false);
  await chooseView(page, "progress");
  const progress = page
    .locator(".product-stats > div")
    .filter({ hasText: "Evidence submitted" })
    .locator("dd");
  await expect(progress).toHaveText("1");
  await chooseView(page, "evidence");
  await downloadEvidence(page);
  await page.getByText("My account", { exact: true }).click();
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Updated synthetic student");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your profile was saved" }),
  ).toBeVisible();
  await page.reload();
  expect(new URL(page.url()).hash).toContain("view=evidence");
  await expect(
    page.getByRole("heading", {
      name: "Hello, Updated synthetic student.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic persisted reflection",
      exact: true,
    }),
  ).toBeVisible();
  await chooseView(page, "progress");
  await expect(progress).toHaveText("1");
  await page.goBack();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic persisted reflection",
      exact: true,
    }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toContain("view=evidence");
  await capture(page, "tala-evidence-desktop-qa.png");
  await page.goto("/#/register");
  await expect(page).toHaveURL(/#\/dashboard(?:\?|$)/);
  await expect(
    page.getByRole("button", { name: "Create account", exact: true }),
  ).toHaveCount(0);
  const cookie = (await context.cookies()).find(
    (entry) => entry.name === "tala_session",
  );
  expect(Boolean(cookie?.httpOnly && cookie.sameSite === "Strict")).toBe(true);
  expect(
    await page.evaluate(() =>
      [localStorage, sessionStorage]
        .flatMap((storage) => Object.keys(storage))
        .filter((key) => /tala|firebase|session|token|auth/i.test(key)),
    ),
  ).toEqual([]);
  await capture(page, "tala-product-desktop-qa.png");
  await capture(page, "tala-overview-desktop-qa.png");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await capture(page, "tala-overview-mobile-qa.png");
  const progressButton = page
    .getByRole("navigation", { name: "Workspace sections", exact: true })
    .getByRole("button", { name: "Progress", exact: true });
  await progressButton.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/dashboard\?view=progress$/);
  await expect(
    page.getByRole("heading", { name: "Your progress", exact: true }),
  ).toBeFocused();
  const violations = (
    await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze()
  ).violations;
  expect(
    violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await capture(page, "tala-product-mobile-qa.png");
  await chooseView(page, "evidence");
  await capture(page, "tala-evidence-mobile-qa.png");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await login(page, account);
  await chooseView(page, "evidence");
  await expect(
    page.getByRole("heading", {
      name: "Synthetic persisted reflection",
      exact: true,
    }),
  ).toBeVisible();
  await chooseView(page, "meetings");
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your booking was cancelled on the server." }),
  ).toBeVisible();
});

test("lost auth responses and rejected upload drafts recover safely, while linked parent access stays read-only", async ({
  page,
}) => {
  const student = await register(page, "student", true);
  await publishTimes();
  await book(page);
  await chooseView(page, "evidence");
  await fillEvidence(page);
  await page.route("**/api/evidence/uploads", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "CONFLICT", message: "Synthetic rejected intent" },
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Submit evidence", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic persisted reflection",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Clear local upload draft", exact: true })
    .click();
  await expect(
    page.getByLabel("Evidence title", { exact: true }),
  ).toBeEnabled();
  await page.unroute("**/api/evidence/uploads");
  await submitEvidence(page);
  await page.getByText("My account", { exact: true }).click();
  const name = page.getByLabel("Display name", { exact: true });
  await name.fill("Unsaved synthetic draft");
  await page.route("**/api/workspace", (route) =>
    route.abort("connectionfailed"),
  );
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("could not be reached");
  await expect(name).toHaveValue("Unsaved synthetic draft");
  await page.unroute("**/api/workspace");
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  const parent = await register(page, "parent");
  await expect(
    page.getByText("No student is linked to this account.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic persisted reflection",
      exact: true,
    }),
  ).toHaveCount(0);
  const studentUid = await application.findUid(student.email);
  const parentUid = await application.findUid(parent.email);
  await application.operator.linkFamily({
    studentUid,
    parentUid,
    consentReference: "Explicit synthetic consent fixture, read-only access",
  });
  await page.reload();
  await chooseView(page, "evidence");
  await expect(
    page.getByText("Family access is read-only.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic persisted reflection",
      exact: true,
    }),
  ).toBeVisible();
  await chooseView(page, "meetings");
  await expect(
    page.getByRole("button", { name: "Cancel booking", exact: true }),
  ).toBeDisabled();
  await chooseView(page, "evidence");
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Submit evidence", exact: true }),
  ).toHaveCount(0);
  await downloadEvidence(page);
  await page.goto("/#/two-factor");
  await expect(
    page.getByText(
      "Multi-factor authentication and recovery are not connected",
      { exact: false },
    ),
  ).toBeVisible();
  await page.goto("/#/payment");
  await expect(
    page.getByRole("heading", {
      name: "Payment service not connected",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(
      "input[autocomplete='cc-number'], input[autocomplete='cc-csc']",
    ),
  ).toHaveCount(0);
});

test("operator review, availability controls and learning summaries lead to a private student revision history", async ({
  page,
}) => {
  const student = await register(page);
  await publishTimes();
  await book(page);
  await chooseView(page, "evidence");
  await submitEvidence(page);
  await application.endBooking(student.email);
  await signOut(page);
  const operator = await register(page);
  await signOut(page);
  await application.operator.promote(operator.email);
  await login(page, operator, true);
  const reviewTab = page.getByRole("tab", { name: /^Review evidence/ });
  const meetingsTab = page.getByRole("tab", { name: "Meetings", exact: true });
  const learningTab = page.getByRole("tab", {
    name: "Learning summaries",
    exact: true,
  });
  await page.getByLabel("Review queue", { exact: true }).selectOption("all");
  const staffNote =
    "Synthetic staff feedback: explain how you checked the final step.";
  await page
    .getByRole("textbox", { name: "Review note", exact: true })
    .fill(staffNote);
  await meetingsTab.click();
  await expect(meetingsTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("textbox", { name: "Review note", exact: true }),
  ).not.toBeVisible();
  await reviewTab.click();
  await expect(
    page.getByRole("textbox", { name: "Review note", exact: true }),
  ).toHaveValue(staffNote);
  await capture(page, "tala-operator-desktop-qa.png");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const operatorViolations = (
    await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze()
  ).violations;
  expect(
    operatorViolations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await capture(page, "tala-operator-mobile-qa.png");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await meetingsTab.click();
  await page
    .getByLabel("Meeting label", { exact: true })
    .fill("Operator cross-midnight test");
  await page.getByLabel("Starts at", { exact: true }).fill("2099-10-21T23:30");
  await page.getByLabel("Ends at", { exact: true }).fill("2099-10-22T00:00");
  await page
    .getByRole("button", { name: "Publish availability", exact: true })
    .click();
  const crossMidnight = page
    .getByRole("list", { name: "Upcoming meeting times", exact: true })
    .getByRole("listitem")
    .filter({ hasText: "Operator cross-midnight test" });
  await expect(crossMidnight).toContainText("Oct 21, 2099");
  await expect(crossMidnight).toContainText("Oct 22, 2099");
  await crossMidnight
    .getByRole("button", { name: "Withdraw time", exact: true })
    .click();
  await expect(
    crossMidnight.getByRole("button", { name: "Publish again", exact: true }),
  ).toBeVisible();
  await crossMidnight
    .getByRole("button", { name: "Publish again", exact: true })
    .click();
  await expect(
    crossMidnight.getByRole("button", { name: "Withdraw time", exact: true }),
  ).toBeVisible();
  await reviewTab.click();
  await expect(
    page.getByRole("textbox", { name: "Review note", exact: true }),
  ).toHaveValue(staffNote);
  const apiOrigin = new URL(page.url()).origin;
  const operatorSession = (await (
    await page.request.get(`${apiOrigin}/api/session`)
  ).json()) as {
    session: { uid: string };
    csrfToken: string;
  };
  const beforeReview = (await (
    await page.request.get(`${apiOrigin}/api/operations`)
  ).json()) as {
    evidence: { id: string; reviewVersion: number }[];
  };
  const competingReview = await page.request.post(
    `${apiOrigin}/api/evidence/${beforeReview.evidence[0]!.id}/review`,
    {
      headers: {
        Origin: apiOrigin,
        "X-CSRF-Token": operatorSession.csrfToken,
        "X-TALA-User": operatorSession.session.uid,
      },
      data: {
        status: "reviewed",
        note: "Synthetic feedback saved in another operator window.",
        expectedReviewVersion: beforeReview.evidence[0]!.reviewVersion,
        requestId: randomUUID(),
      },
    },
  );
  expect(competingReview.status()).toBe(200);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Use latest review version",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Review note", exact: true }),
  ).toHaveValue(staffNote);
  await expect(
    page.getByRole("button", { name: "Save manual review", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Use latest review version", exact: true })
    .click();
  await page
    .getByLabel("Review status", { exact: true })
    .selectOption("needs_revision");
  await page
    .getByRole("button", { name: "Save manual review", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Review saved" }),
  ).toBeVisible();
  await learningTab.click();
  const summary =
    "Synthetic staff learning summary: the student explained a checked solution.";
  await page
    .getByLabel("Reviewed learning summary", { exact: true })
    .fill(summary);
  await page
    .getByRole("button", { name: "Publish reviewed summary", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Learning summary published" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Publish reviewed summary", exact: true }),
  ).toHaveCount(0);
  await signOut(page);
  await login(page, student);
  await chooseView(page, "learning");
  await expect(page.getByText(summary, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "I have reviewed this summary", exact: true })
    .click();
  await expect(
    page.getByText("Reviewed by student", { exact: true }),
  ).toBeVisible();
  await chooseView(page, "evidence");
  await expect(page.getByText(staffNote, { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: "Prepare revision of Synthetic persisted reflection",
      exact: true,
    })
    .click();
  const revisedBytes = Buffer.from(
    "Synthetic revised reflection adds the requested explanation; no real personal data.",
  );
  await page
    .getByLabel("Evidence title", { exact: true })
    .fill("Synthetic revised reflection");
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "synthetic-revision.txt",
    mimeType: "text/plain",
    buffer: revisedBytes,
  });
  await page
    .getByRole("button", { name: "Submit revision", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic revised reflection",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic persisted reflection",
      exact: true,
    }),
  ).toHaveCount(0);
  await downloadEvidence(
    page,
    "Download Synthetic revised reflection",
    revisedBytes,
  );
  await chooseView(page, "progress");
  const stats = page.locator("#progress .product-stats");
  await expect(
    stats
      .locator("div")
      .filter({ hasText: "Evidence submitted" })
      .locator("dd"),
  ).toHaveText("2");
  await expect(
    stats
      .locator("div")
      .filter({ hasText: "Revisions submitted" })
      .locator("dd"),
  ).toHaveText("1");
  await expect(
    stats
      .locator("div")
      .filter({ hasText: "Summaries acknowledged" })
      .locator("dd"),
  ).toHaveText("1");
  await chooseView(page, "evidence");
  await page
    .getByRole("button", {
      name: "Version history for Synthetic revised reflection",
      exact: true,
    })
    .click();
  const history = page.getByRole("dialog", {
    name: "Document history",
    exact: true,
  });
  await expect(history).toContainText("Version 2");
  await history
    .getByRole("button", { name: "Previous version", exact: true })
    .click();
  await expect(history).toContainText("Version 1");
  await expect(history).toContainText(staffNote);
  await downloadEvidence(page, "Download this version", evidenceBytes);
  await page.reload();
  await expect(history).toBeVisible();
  await expect(history).toContainText("Version 1");
  await history
    .getByRole("button", { name: "Next version", exact: true })
    .click();
  await expect(history).toContainText("Version 2");
  const dialogViolations = (
    await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze()
  ).violations;
  expect(dialogViolations.map(({ id }) => id)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(history).toHaveCount(0);
  expect(new URL(page.url()).hash).toContain("view=evidence");
});
