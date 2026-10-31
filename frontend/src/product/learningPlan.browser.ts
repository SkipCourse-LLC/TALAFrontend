import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webOrigin = "http://127.0.0.1:5184";
const apiOrigin = "http://127.0.0.1:8794";
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
        TALA_BROWSER_TEST_API_PORT: "8794",
        TALA_BROWSER_TEST_WEB_PORT: "5184",
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
        reject(new Error("The isolated learning plan server did not start.")),
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
      reject(new Error("The isolated learning plan server exited."));
    });
  });
}

async function isolate(context: BrowserContext) {
  const recordPageError = (page: Page) =>
    page.on("pageerror", () =>
      runtimeErrors.push("Unhandled learning plan runtime error"),
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
    "Learning plan must not contact Firebase or external services",
  ).toEqual([]);
});

async function register(page: Page, role: "student" | "parent" = "student") {
  const suffix = randomUUID();
  const account = {
    name: `Synthetic learning plan ${role}`,
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

async function choosePlan(page: Page) {
  const navigation = page.getByRole("navigation", {
    name: "Workspace sections",
    exact: true,
  });
  const plan = navigation.getByRole("button", {
    name: "Learning plan",
    exact: true,
  });
  await plan.click();
  await expect(plan).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#plan-heading")).toBeVisible();
}

async function addGoal(
  page: Page,
  title: string,
  notes = "A synthetic personal learning intention, without private records.",
) {
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  await page.getByLabel("Goal", { exact: true }).fill(title);
  await page.getByLabel("Notes (optional)", { exact: true }).fill(notes);
  await page
    .getByLabel("Target date (optional)", { exact: true })
    .fill("2027-05-21");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}

function goalRow(page: Page, title: string): Locator {
  return page.locator("li").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

test("a personal goal persists through navigation, refresh, and signing in again", async ({
  page,
}) => {
  const account = await register(page);
  await choosePlan(page);
  await addGoal(page, "Explain one solution in my own words");
  await page
    .getByRole("navigation", { name: "Workspace sections", exact: true })
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await choosePlan(page);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Explain one solution in my own words",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
  await choosePlan(page);
  await expect(
    goalRow(page, "Explain one solution in my own words"),
  ).toHaveCount(1);
  await goalRow(page, "Explain one solution in my own words")
    .getByRole("button", { name: /^Edit / })
    .click();
  await expect(
    page.getByLabel("Notes (optional)", { exact: true }),
  ).toHaveValue(
    "A synthetic personal learning intention, without private records.",
  );
  await expect(
    page.getByLabel("Target date (optional)", { exact: true }),
  ).toHaveValue("2027-05-21");
});

test("a failed save keeps the draft, and rapid retries create one saved goal", async ({
  page,
}) => {
  await register(page);
  await choosePlan(page);
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  const title = page.getByLabel("Goal", { exact: true });
  const notes = page.getByLabel("Notes (optional)", { exact: true });
  const save = page.getByRole("button", { name: /^(Save goal|Retry save)$/ });
  await save.click();
  await expect(title).toBeFocused();
  expect(
    await title.evaluate(
      (input: HTMLInputElement) => input.validity.valueMissing,
    ),
  ).toBe(true);
  await title.fill("Finish my practice reflection");
  await notes.fill("Keep this draft if the connection is interrupted.");
  await page.route("**/api/learning-goals", async (route) => {
    if (route.request().method() === "POST")
      await route.abort("connectionfailed");
    else await route.fallback();
  });
  await save.click();
  await expect(page.getByRole("alert")).toContainText(/could not be reached/i);
  await expect(title).toHaveValue("Finish my practice reflection");
  await expect(notes).toHaveValue(
    "Keep this draft if the connection is interrupted.",
  );
  await expect(save).toBeEnabled();
  const leaving = page.waitForEvent("dialog");
  const refresh = page.reload({ timeout: 2_000 }).catch(() => {});
  const warning = await leaving;
  expect(warning.type()).toBe("beforeunload");
  await warning.dismiss();
  await refresh;
  await expect(title).toHaveValue("Finish my practice reflection");
  await expect(notes).toHaveValue(
    "Keep this draft if the connection is interrupted.",
  );
  await page.unroute("**/api/learning-goals");

  let started: (() => void) | undefined;
  let release: (() => void) | undefined;
  let attempts = 0;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/learning-goals", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    attempts++;
    if (attempts === 1) {
      started?.();
      await held;
      // Commit the real write, then lose only the response. A second explicit
      // save must reuse the request receipt instead of inserting another goal.
      const saved = await route.fetch({
        url: `${apiOrigin}/api/learning-goals`,
      });
      expect(saved.ok()).toBe(true);
      await route.abort("connectionfailed");
    } else await route.fallback();
  });
  try {
    await title
      .locator("xpath=ancestor::form")
      .evaluate((form: HTMLFormElement) => {
        form.requestSubmit();
        form.requestSubmit();
      });
    await ready;
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    expect(attempts).toBe(1);
    release?.();
    await expect(page.getByRole("alert")).toContainText(
      /could not be reached/i,
    );
    await expect(title).toHaveValue("Finish my practice reflection");
    await expect(notes).toHaveValue(
      "Keep this draft if the connection is interrupted.",
    );
    await save.click();
    await expect(goalRow(page, "Finish my practice reflection")).toHaveCount(1);
    expect(attempts).toBe(2);
    await page.reload();
    await expect(goalRow(page, "Finish my practice reflection")).toHaveCount(1);
  } finally {
    release?.();
  }
});

test("concurrent edits protect the saved version, with completion and reopen reflected after refresh", async ({
  page,
  context,
}) => {
  await register(page);
  await choosePlan(page);
  await addGoal(page, "Choose one question to explore");
  await goalRow(page, "Choose one question to explore")
    .getByRole("button", { name: /^Edit / })
    .click();
  await page
    .getByLabel("Goal", { exact: true })
    .fill("My unsaved revision stays here");
  const other = await context.newPage();
  try {
    await other.goto("/#/dashboard?view=plan");
    await goalRow(other, "Choose one question to explore")
      .getByRole("button", { name: /^Edit / })
      .click();
    await other
      .getByLabel("Goal", { exact: true })
      .fill("A newer question from another tab");
    await other
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      goalRow(other, "A newer question from another tab"),
    ).toHaveCount(1);
    await page.bringToFront();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      /changed|conflict|latest|updated/i,
    );
    await expect(page.getByLabel("Goal", { exact: true })).toHaveValue(
      "My unsaved revision stays here",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
    const row = goalRow(page, "A newer question from another tab");
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /^Complete / }).click();
    await page.getByRole("button", { name: /^Completed goals \(1\)$/ }).click();
    await expect(row).toHaveCount(1);
    await page.reload();
    await page.getByRole("button", { name: /^Completed goals \(1\)$/ }).click();
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /^Reopen / }).click();
    await page.getByRole("button", { name: /^Active goals \(1\)$/ }).click();
    await expect(row).toHaveCount(1);
  } finally {
    await other.close();
  }
});

test("a disabled linked student immediately conceals the parent's cached learning plan", async ({
  page,
  browser,
}) => {
  const student = await register(page);
  await choosePlan(page);
  const title = "Synthetic private student learning goal";
  const notes =
    "Private synthetic notes visible only while family access is valid.";
  await addGoal(page, title, notes);
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
    expect(typeof studentUid).toBe("string");
    expect(typeof parentUid).toBe("string");
    await callFixture("linkFamily", {
      studentUid,
      parentUid,
      consentReference: "Synthetic consent for isolated browser test only.",
    });
    await parentPage.reload();
    await choosePlan(parentPage);
    await expect(
      parentPage.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(parentPage.getByText(notes, { exact: true })).toBeVisible();
    await expect(
      parentPage.getByRole("button", { name: "Add goal", exact: true }),
    ).toHaveCount(0);

    await callFixture("disableStudent", student.email);
    const deniedRead = parentPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/workspace" &&
        response.status() === 404,
    );
    await parentPage
      .getByRole("button", { name: "Refresh records", exact: true })
      .click();
    await deniedRead;
    await expect(
      parentPage.getByRole("heading", { name: title, exact: true }),
    ).not.toBeVisible({ timeout: 3_000 });
    await expect(
      parentPage.getByText(notes, { exact: true }),
    ).not.toBeVisible();
    await expect(parentPage.locator("#plan-heading")).not.toBeVisible();
    await expect(
      parentPage
        .getByRole("alert")
        .filter({ hasText: /permission|not.*found|not available|could not/i })
        .first(),
    ).toBeVisible();
  } finally {
    await parentContext.close();
  }
});

test("the plan supports keyboard use and readable mobile, tablet, and desktop layouts", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await register(page);
  const plan = page
    .getByRole("navigation", { name: "Workspace sections", exact: true })
    .getByRole("button", { name: "Learning plan", exact: true });
  await plan.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#plan-heading")).toBeFocused();
  const add = page.getByRole("button", { name: "Add goal", exact: true });
  await add.focus();
  await page.keyboard.press("Enter");
  const title = page.getByLabel("Goal", { exact: true });
  await expect(title).toBeFocused();
  await page.keyboard.type("Make a clear explanation using one example");
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel("Notes (optional)", { exact: true }),
  ).toBeFocused();
  await page.keyboard.type("A small step with room to learn at my own pace.");
  await page.getByRole("button", { name: "Save goal", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    goalRow(page, "Make a clear explanation using one example"),
  ).toHaveCount(1);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    if (width !== 768) {
      await page.screenshot({
        path: testInfo.outputPath(`learning-plan-${width}.png`),
        fullPage: true,
      });
    }
    await page
      .getByRole("navigation", { name: "Workspace sections", exact: true })
      .getByRole("button", { name: "Overview", exact: true })
      .click();
    await expect(page.locator("#overview-heading")).toBeFocused();
    await expect(
      page.getByRole("heading", {
        name: "Make a clear explanation using one example",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const overview = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(overview.violations).toEqual([]);
    if (width !== 768) {
      await page.screenshot({
        path: testInfo.outputPath(`learning-overview-${width}.png`),
        fullPage: true,
      });
    }
    await choosePlan(page);
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
});
