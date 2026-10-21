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
  };
  findUid(email: string): Promise<string>;
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
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  let ready: (() => void) | undefined;
  const started = new Promise<void>((resolve, reject) => {
    ready = resolve;
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0)
        reject(new Error("The isolated Node test server could not start."));
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
      if (message.error) request?.reject(new Error(message.error));
      else request?.resolve(message.result);
    },
  );
  const call = (action: string, input: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = randomUUID();
      requests.set(id, { resolve, reject });
      child.send({ id, action, input });
    });
  await started;
  return {
    operator: {
      addAvailability: async (input) =>
        (await call("addAvailability", input)) as { id: string },
      linkFamily: (input) => call("linkFamily", input),
    },
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
    await application.close();
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
async function book(page: Page) {
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
async function submitEvidence(page: Page) {
  await fillEvidence(page);
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
async function downloadEvidence(page: Page) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Download Synthetic persisted reflection",
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
    (await readFile(path!)).equals(evidenceBytes),
    "Private download should match the submitted bytes",
  ).toBe(true);
  await download.delete();
}
async function login(page: Page, account: { email: string; password: string }) {
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
}

test("student registration, booking changes, private file persistence and mobile keyboard access use the independent server", async ({
  page,
  context,
}) => {
  const account = await register(page);
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
  await submitEvidence(page);
  const progress = page
    .locator(".product-stats > div")
    .filter({ hasText: "Evidence submitted" })
    .locator("dd");
  await expect(progress).toHaveText("1");
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
  await expect(progress).toHaveText("1");
  await page.goto("/#/register");
  await expect(page).toHaveURL(/#\/dashboard$/);
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
  await page.screenshot({
    path: join(tmpdir(), "tala-product-desktop-qa.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
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
  await page.screenshot({
    path: join(tmpdir(), "tala-product-mobile-qa.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await login(page, account);
  await expect(
    page.getByRole("heading", {
      name: "Synthetic persisted reflection",
      exact: true,
    }),
  ).toBeVisible();
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
  await expect(
    page.getByText("Family access is read-only.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic persisted reflection",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel booking", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Evidence title", { exact: true }),
  ).toBeDisabled();
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
