import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webOrigin = "http://127.0.0.1:5190";
const apiOrigin = "http://127.0.0.1:8800";
let directory = "";
let closeFixture: (() => Promise<void>) | undefined;
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
        TALA_BROWSER_TEST_API_PORT: "8800",
        TALA_BROWSER_TEST_WEB_PORT: "5190",
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const pending = new Map<
    string,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
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
        reject(new Error("Synthetic fixture request timed out."));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      child.send({ id, action, input });
    });
  closeFixture = async () => {
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
  child.on(
    "message",
    (message: { id?: string; result?: unknown; error?: string }) => {
      if (!message.id) return;
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    },
  );
  child.once("exit", () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error("Synthetic fixture stopped."));
    }
    pending.clear();
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error("Synthetic editor-recovery server did not start.")),
      10_000,
    );
    child.on("message", (message: { ready?: boolean }) => {
      if (message.ready) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Synthetic editor-recovery server exited."));
    });
  });
}

test.beforeEach(async ({ context }) => {
  directory = "";
  closeFixture = undefined;
  unexpectedHosts.length = runtimeErrors.length = 0;
  const observe = (page: Page) =>
    page.on("pageerror", () =>
      runtimeErrors.push("Editor recovery runtime error"),
    );
  context.pages().forEach(observe);
  context.on("page", observe);
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
    } else if (
      url.origin === webOrigin ||
      ["data:", "blob:"].includes(url.protocol)
    )
      await route.continue();
    else {
      unexpectedHosts.push(url.host);
      await route.abort("blockedbyclient");
    }
  });
  await startFixture();
});
test.afterEach(async ({ context }) => {
  for (const page of context.pages()) await page.close();
  try {
    await closeFixture?.();
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
  expect(runtimeErrors).toEqual([]);
  expect(
    [...new Set(unexpectedHosts)],
    "Only the isolated loopback backend is allowed",
  ).toEqual([]);
});

async function register(page: Page) {
  const suffix = randomUUID();
  const account = {
    email: `${suffix}@example.test`,
    password: `Synthetic-only-${suffix}`,
  };
  await page.goto("/#/register");
  await page
    .getByLabel("Name", { exact: true })
    .fill("Synthetic editor recovery student");
  await page
    .getByLabel("Account type", { exact: true })
    .selectOption("student");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(account.password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Hello, Synthetic editor recovery student.",
      exact: true,
    }),
  ).toBeVisible();
  return account;
}
async function chooseView(
  page: Page,
  name: "Learning plan" | "Meetings" | "Overview",
) {
  const button = page
    .getByRole("navigation", { name: "Workspace sections", exact: true })
    .getByRole("button", { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
}
async function publishTimes() {
  for (let index = 0; index < 2; index++) {
    const start = Date.now() + 86_400_000 + index * 3_600_000;
    await callFixture("addAvailability", {
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 1_800_000).toISOString(),
      label: `Synthetic recovery time ${index + 1}`,
    });
  }
}

test("an actual committed goal with a lost response freezes its draft and retries the exact request once", async ({
  page,
}) => {
  const account = await register(page);
  await chooseView(page, "Learning plan");
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  const title = page.getByLabel("Goal", { exact: true });
  await title.fill("Keep one question to explore");
  await page
    .getByLabel("Notes (optional)", { exact: true })
    .fill("Synthetic recovery notes with no private records.");
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  const step = page.getByLabel("Step 1", { exact: true });
  await step.fill("Write one example");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const signOut = page.getByRole("dialog", {
    name: "Keep your unsent work?",
    exact: true,
  });
  await expect(signOut).toBeVisible();
  await expect(
    signOut.getByRole("button", { name: "Keep working", exact: true }),
  ).toBeFocused();
  await signOut
    .getByRole("button", { name: "Keep working", exact: true })
    .click();
  await expect(title).toHaveValue("Keep one question to explore");
  await expect(step).toHaveValue("Write one example");
  const attempts: Record<string, unknown>[] = [];
  let release: () => void = () => {};
  let committed: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved = new Promise<void>((resolve) => {
    committed = resolve;
  });
  await page.route("**/api/learning-goals", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    attempts.push(route.request().postDataJSON() as Record<string, unknown>);
    const response = await route.fetch({
      url: `${apiOrigin}/api/learning-goals`,
    });
    expect(response.ok()).toBe(true);
    if (attempts.length === 1) {
      committed();
      await held;
      await route.abort("connectionfailed");
    } else await route.fulfill({ response });
  });
  try {
    await title
      .locator("xpath=ancestor::form")
      .evaluate((form: HTMLFormElement) => {
        form.requestSubmit();
        form.requestSubmit();
      });
    await saved;
    expect(attempts).toHaveLength(1);
    release();
    const retry = page.getByRole("button", { name: "Retry save", exact: true });
    await expect(retry).toBeEnabled();
    await expect(title).toHaveValue("Keep one question to explore");
    await expect(title).toHaveJSProperty("readOnly", true);
    await expect(step).toHaveJSProperty("readOnly", true);
    await expect(
      page.getByRole("button", { name: "Add step", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Remove step 1", exact: true }),
    ).toBeDisabled();
    await retry.click();
    await expect(
      page.getByRole("heading", { name: "New goal", exact: true }),
    ).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await page.reload();
    await expect(
      page
        .getByRole("list", { name: "Saved learning goals", exact: true })
        .locator(":scope > li"),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", {
        name: "Keep one question to explore",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add goal", exact: true }).click();
    await page
      .getByLabel("Goal", { exact: true })
      .fill("An unsent second goal");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await signOut
      .getByRole("button", {
        name: "Sign out and clear unsent work",
        exact: true,
      })
      .click();
    await page.goto("/#/login");
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await chooseView(page, "Learning plan");
    await expect(
      page
        .getByRole("list", { name: "Saved learning goals", exact: true })
        .locator(":scope > li"),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", {
        name: "Keep one question to explore",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "An unsent second goal", exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});

test("uncertain preparation is kept across views and blocks rescheduling until a real read or explicit discard confirms the draft", async ({
  page,
}) => {
  await register(page);
  await publishTimes();
  await chooseView(page, "Meetings");
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  const slot = page.getByLabel("Available meeting time", { exact: true });
  const firstSlot = await slot.locator("option").nth(1).getAttribute("value");
  expect(firstSlot).toBeTruthy();
  await slot.selectOption(firstSlot!);
  let reads = 0;
  let holdReads = false;
  let releaseRead: () => void = () => {};
  let readStarted: () => void = () => {};
  const returningRead = new Promise<void>((resolve) => {
    readStarted = resolve;
  });
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/appointments/*/preparation", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") {
      reads++;
      if (holdReads) {
        readStarted();
        await readGate;
      }
      const response = await route.fetch({
        url: `${apiOrigin}${url.pathname}`,
      });
      await route.fulfill({ response });
    } else if (route.request().method() === "PATCH") {
      writes.push(route.request().postDataJSON() as Record<string, unknown>);
      const response = await route.fetch({
        url: `${apiOrigin}${url.pathname}`,
      });
      expect(response.ok()).toBe(true);
      await route.abort("connectionfailed");
    } else await route.fallback();
  });
  await page.getByRole("button", { name: "Book meeting", exact: true }).click();
  await expect(page.locator(".meeting-preparation > summary")).toBeVisible();
  expect(reads).toBe(0);
  await page.locator(".meeting-preparation > summary").click();
  const note = page.getByLabel("Learning notes (optional)", { exact: true });
  await expect(note).toBeEditable();
  const original = "A synthetic question to discuss, without private details.";
  await note.fill(original);
  await page
    .getByLabel("My learning materials are ready", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Save preparation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry preparation save", exact: true }),
  ).toBeEnabled();
  await expect(note).toHaveJSProperty("readOnly", true);
  expect(writes).toHaveLength(1);
  const replacement = await slot.locator("option").nth(1).getAttribute("value");
  await slot.selectOption(replacement!);
  await page
    .getByRole("button", { name: "Change booking", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Change this booking?",
    exact: true,
  });
  await expect(confirmation.getByRole("alert")).toContainText(
    "meeting preparation has unsaved changes",
  );
  await expect(
    confirmation.getByRole("button", { name: "Confirm change", exact: true }),
  ).toBeDisabled();
  await confirmation
    .getByRole("button", { name: "Keep booking", exact: true })
    .click();
  holdReads = true;
  try {
    await chooseView(page, "Overview");
    await chooseView(page, "Meetings");
    await returningRead;
    await expect(note).toHaveValue(original);
    releaseRead();
    await expect(note).toBeEditable();
    await expect(
      page.getByRole("button", { name: "Retry preparation save", exact: true }),
    ).toHaveCount(0);
    expect(writes).toHaveLength(1);
    await note.fill("A different unsent draft that must not disappear.");
    await page
      .getByRole("button", { name: "Reload saved notes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Keep my draft", exact: true })
      .click();
    await expect(note).toHaveValue(
      "A different unsent draft that must not disappear.",
    );
    await page
      .getByRole("button", { name: "Reload saved notes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Replace with saved notes", exact: true })
      .click();
    await expect(note).toHaveValue(original);
    await expect(note).toBeEditable();
    await slot.selectOption(replacement!);
    await page
      .getByRole("button", { name: "Change booking", exact: true })
      .click();
    await expect(
      confirmation.getByRole("button", { name: "Confirm change", exact: true }),
    ).toBeEnabled();
    await confirmation
      .getByRole("button", { name: "Keep booking", exact: true })
      .click();
    expect(writes).toHaveLength(1);
  } finally {
    releaseRead();
  }
});
