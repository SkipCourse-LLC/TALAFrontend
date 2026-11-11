import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import type { ApiWorkspace } from "../api";
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

async function register(page: Page, role: "student" | "parent" = "student") {
  const suffix = randomUUID();
  const account: Account = {
    name: `Synthetic simple ${role}`,
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

async function choose(page: Page, label: string) {
  const control = page
    .getByRole("navigation", { name: "Workspace sections", exact: true })
    .getByRole("button", { name: label, exact: true });
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

test("one password and native role controls create real student and parent sessions; failed sign-in exposes explicit recovery", async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 860 });
  await page.goto("/#/register");
  await expect(
    page.getByRole("radio", { name: "Student", exact: true }),
  ).toBeChecked();
  await expect(page.locator('input[name="password"]')).toHaveCount(1);
  await expect(
    page.getByLabel("Confirm password", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Check saved session", exact: true }),
  ).toHaveCount(0);
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("Synthetic-only-keyboard");
  await password.press("Tab");
  await expect(
    page.getByRole("button", { name: "Show password", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "text");
  await expect(
    page.getByRole("button", { name: "Hide password", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(password).toHaveAttribute("type", "password");
  await expectAccessible(page);
  await page.screenshot({
    path: testInfo.outputPath("registration-320.png"),
    fullPage: true,
  });
  await register(page);
  expect((await savedWorkspace(page)).activeAppointments).toEqual([]);

  const parentContext = await browser.newContext({
    baseURL: webOrigin,
    viewport: { width: 320, height: 860 },
  });
  try {
    await isolate(parentContext);
    const parentPage = await parentContext.newPage();
    await register(parentPage, "parent");
    const role = await parentPage.evaluate(
      async () => (await (await fetch("/api/session")).json()).session.role,
    );
    expect(role).toBe("parent");
    await expect(
      parentPage.getByRole("button", { name: "Submit evidence", exact: true }),
    ).toHaveCount(0);
  } finally {
    await parentContext.close();
  }

  const signedOut = await browser.newContext({
    baseURL: webOrigin,
    viewport: { width: 320, height: 860 },
  });
  try {
    await isolate(signedOut);
    const login = await signedOut.newPage();
    let loginRequests = 0;
    login.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/auth/login"
      )
        loginRequests++;
    });
    await login.goto("/#/login");
    await expect(
      login.getByRole("button", { name: "Check saved session", exact: true }),
    ).toHaveCount(0);
    await login
      .getByLabel("Email", { exact: true })
      .fill(`${randomUUID()}@example.test`);
    await login
      .getByLabel("Password", { exact: true })
      .fill("Synthetic-only-incorrect");
    await login
      .getByRole("button", { name: "Show password", exact: true })
      .click();
    await login.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(login.getByRole("alert")).toBeFocused();
    await expect(login.getByLabel("Password", { exact: true })).toHaveValue("");
    await expect(login.getByLabel("Password", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
    await login
      .getByRole("button", { name: "Check saved session", exact: true })
      .click();
    await expect(login.getByRole("alert")).toContainText(
      "No active session was found",
    );
    expect(loginRequests).toBe(1);
    await expectAccessible(login);
  } finally {
    await signedOut.close();
  }
});

test("direct times save a real booking; change is explicit and cancellation preserves unfinished Evidence", async ({
  page,
}, testInfo) => {
  for (let index = 0; index < 4; index++) {
    const start = Date.now() + 86_400_000 + index * 3_600_000;
    await callFixture("addAvailability", {
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 1_800_000).toISOString(),
      label: `Synthetic simple time ${index + 1}`,
    });
  }
  await register(page);
  await choose(page, "Meetings");
  const meeting = page.getByRole("region", { name: "Meetings", exact: true });
  await expect(meeting.getByRole("radio")).toHaveCount(3);
  await meeting.getByRole("radio").first().focus();
  await page.keyboard.press("Space");
  await expect(meeting.getByRole("radio").first()).toBeChecked();
  await meeting
    .getByRole("button", { name: "Book meeting", exact: true })
    .click();
  await expect(
    meeting.getByRole("heading", { name: "Your current booking", exact: true }),
  ).toBeVisible();
  const original = (await savedWorkspace(page)).activeAppointments[0];
  if (!original) throw new Error("Synthetic reservation was not saved.");
  expect(original.status).toBe("reserved");
  await expect(meeting.getByRole("radio")).toHaveCount(0);
  await choose(page, "Today");
  await page
    .locator(".today-workspace")
    .getByRole("button", { name: "Prepare for meeting", exact: true })
    .click();
  await expect(page.locator("#meeting-preparation")).toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator("#meeting-preparation-heading")).toBeFocused();
  await meeting
    .getByRole("button", { name: "Change booking", exact: true })
    .click();
  await meeting.getByRole("radio").first().check();
  await meeting
    .getByRole("button", { name: "Change booking", exact: true })
    .click();
  const change = page.getByRole("dialog", {
    name: "Change this booking?",
    exact: true,
  });
  await expect(change).toBeVisible();
  expect((await savedWorkspace(page)).activeAppointments[0]?.id).toBe(
    original.id,
  );
  await change
    .getByRole("button", { name: "Keep booking", exact: true })
    .click();
  expect((await savedWorkspace(page)).activeAppointments[0]?.id).toBe(
    original.id,
  );
  await meeting
    .getByRole("button", { name: "Change booking", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Change this booking?", exact: true })
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect
    .poll(async () => (await savedWorkspace(page)).activeAppointments[0]?.id)
    .not.toBe(original.id);
  const changed = (await savedWorkspace(page)).activeAppointments[0];
  if (!changed) throw new Error("Synthetic replacement was not saved.");
  await expect(meeting.getByRole("radio")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 860 });
  await expectAccessible(page);
  await page.screenshot({
    path: testInfo.outputPath("saved-meeting-320.png"),
    fullPage: true,
  });

  await choose(page, "Evidence");
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: "Synthetic-prepared.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic learning file, no real user data."),
  });
  await choose(page, "Meetings");
  await meeting
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  const cancel = page.getByRole("dialog", {
    name: "Cancel this booking?",
    exact: true,
  });
  await expect(
    cancel.getByRole("button", { name: "Confirm cancellation", exact: true }),
  ).toBeDisabled();
  await expect(cancel.getByRole("alert")).toContainText("Evidence file");
  expect((await savedWorkspace(page)).activeAppointments[0]?.id).toBe(
    changed.id,
  );
  await cancel
    .getByRole("button", { name: "Keep booking", exact: true })
    .click();
  await choose(page, "Evidence");
  await page.getByLabel("File", { exact: true }).setInputFiles([]);
  await choose(page, "Meetings");
  await meeting
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await cancel
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect
    .poll(async () => (await savedWorkspace(page)).activeAppointments.length)
    .toBe(0);
  await expect(meeting.getByRole("radio")).toHaveCount(3);
  const all = meeting.locator("summary").filter({ hasText: "All times" });
  await all.click();
  await expect(
    meeting
      .getByLabel("Available meeting time", { exact: true })
      .locator("option"),
  ).toHaveCount(5);
  const otherTime = meeting.getByLabel("Available meeting time", {
    exact: true,
  });
  await otherTime.selectOption({ index: 4 });
  const selectedSlot = await otherTime.inputValue();
  await all.click();
  await expect(
    meeting.getByRole("status").filter({ hasText: "Selected:" }),
  ).toBeVisible();
  await meeting
    .getByRole("button", { name: "Book meeting", exact: true })
    .click();
  await expect
    .poll(
      async () => (await savedWorkspace(page)).activeAppointments[0]?.slotId,
    )
    .toBe(selectedSlot);
});

test("learning summaries open Evidence with saved context, preserve existing writing, and auto-title files without overwriting a manual title", async ({
  page,
  browser,
}, testInfo) => {
  const student = await register(page);
  const operatorContext = await browser.newContext({
    baseURL: webOrigin,
    timezoneId: "America/Phoenix",
  });
  let seed: { oldLearningId: string; oldLearningSummary: string };
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
  const contextBookingId = await page.evaluate(async (recordId) => {
    const response = await fetch(`/api/learning/${recordId}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Synthetic learning record read failed.");
    return (await response.json()).appointmentId as string;
  }, seed.oldLearningId);
  expect(
    (await savedWorkspace(page)).appointments.some(
      (booking) => booking.id === contextBookingId,
    ),
  ).toBe(false);
  await choose(page, "Learning records");
  await page
    .getByLabel("Search learning records", { exact: true })
    .fill(seed.oldLearningSummary);
  const row = page
    .getByRole("list", { name: "Saved learning records", exact: true })
    .locator(":scope > li")
    .filter({ hasText: seed.oldLearningSummary });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Add Evidence", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: /^Write a reflection(?:\s|$)/ }),
  ).toBeChecked();
  await expect(page.getByLabel("Related booking", { exact: true })).toHaveValue(
    contextBookingId,
  );
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    "Reflection",
  );
  await expect(
    page.getByLabel("Your reflection", { exact: true }),
  ).toBeFocused();
  const writing = "Synthetic current writing must stay exactly as typed.";
  await page.getByLabel("Your reflection", { exact: true }).fill(writing);
  await page
    .getByLabel("Evidence title", { exact: true })
    .fill("My current reflection");
  await choose(page, "Learning records");
  await row.getByRole("button", { name: "Add Evidence", exact: true }).click();
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    writing,
  );
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    "My current reflection",
  );
  await expect(
    page.getByRole("status").filter({
      hasText:
        "Your current Evidence is kept. Finish it before starting another.",
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 860 });
  await expectAccessible(page);
  await page.screenshot({
    path: testInfo.outputPath("context-reflection-320.png"),
    fullPage: true,
  });

  await page.getByLabel("Your reflection", { exact: true }).fill("");
  await page.getByLabel("Evidence title", { exact: true }).fill("");
  await page.getByRole("radio", { name: /^Upload a file(?:\s|$)/ }).check();
  const file = page.getByLabel("File", { exact: true });
  await file.setInputFiles({
    name: "Synthetic-one.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic file one."),
  });
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    "Synthetic-one",
  );
  await file.setInputFiles({
    name: "Synthetic-two.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic file two."),
  });
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    "Synthetic-two",
  );
  await page
    .getByLabel("Evidence title", { exact: true })
    .fill("Keep my own title");
  await file.setInputFiles({
    name: "Synthetic-three.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic file three."),
  });
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    "Keep my own title",
  );
  await choose(page, "Learning records");
  await row.getByRole("button", { name: "Add Evidence", exact: true }).click();
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    "Keep my own title",
  );
  await expect(
    page.getByRole("radio", { name: /^Upload a file(?:\s|$)/ }),
  ).toBeChecked();
  await expect(page.getByText(/Selected: Synthetic-three\.txt/)).toBeVisible();
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
