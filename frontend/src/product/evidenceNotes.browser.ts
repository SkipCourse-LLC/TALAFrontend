import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webOrigin = "http://127.0.0.1:5192";
const apiOrigin = "http://127.0.0.1:8802";
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
        TALA_BROWSER_TEST_API_PORT: "8802",
        TALA_BROWSER_TEST_WEB_PORT: "5192",
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
          new Error("The isolated reflection evidence server did not start."),
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
      reject(new Error("The isolated reflection evidence server exited."));
    });
  });
}

async function isolate(context: BrowserContext) {
  const recordPageError = (page: Page) =>
    page.on("pageerror", () =>
      runtimeErrors.push("Unhandled reflection evidence runtime error"),
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
    "Reflection evidence must not contact Firebase or external services",
  ).toEqual([]);
});

async function register(page: Page, role: "student" | "parent" = "student") {
  const suffix = randomUUID();
  const account = {
    name: `Synthetic reflection evidence ${role}`,
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

async function chooseView(page: Page, name: "Meetings" | "Evidence") {
  const control = page
    .getByRole("navigation", { name: "Workspace sections", exact: true })
    .getByRole("button", { name, exact: true });
  await control.click();
  await expect(control).toHaveAttribute("aria-current", "page");
  await expect(
    page.locator(
      name === "Meetings" ? "#meetings-heading" : "#evidence-heading",
    ),
  ).toBeVisible();
}

async function prepareReflectionBooking(page: Page, email: string) {
  const starts = Date.now() + 86_400_000;
  const slot = (await callFixture("addAvailability", {
    startsAt: new Date(starts).toISOString(),
    endsAt: new Date(starts + 1_800_000).toISOString(),
    label: "Synthetic reflection meeting fixture",
  })) as { id: string };
  await chooseView(page, "Meetings");
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  await page
    .getByLabel("Available meeting time", { exact: true })
    .selectOption(slot.id);
  await page.getByRole("button", { name: "Book meeting", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your booking was saved to the server." }),
  ).toBeVisible();
  await callFixture("endBooking", email);
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  await chooseView(page, "Evidence");
}

async function writeReflection(page: Page, title: string, note: string) {
  await page.getByLabel("Evidence title", { exact: true }).fill(title);
  const write = page.getByRole("radio", {
    name: /^Write a reflection(?:\s|$)/,
  });
  await write.focus();
  await page.keyboard.press("Space");
  await expect(write).toBeChecked();
  const reflection = page.getByLabel("Your reflection", { exact: true });
  await reflection.focus();
  await page.keyboard.insertText(note);
  await expect(reflection).toHaveValue(note);
}

async function expectPrivateDownload(
  page: Page,
  title: string,
  content: string,
) {
  const pendingDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: `Download ${title}`, exact: true })
    .click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toMatch(/^evidence-[a-f0-9-]+\.txt$/);
  const filename = await download.path();
  expect(filename).not.toBeNull();
  expect(await readFile(filename!, "utf8")).toBe(content);
  await download.delete();
}

test("a keyboard-written reflection saves real UTF-8 evidence, protects draft switching, and can be downloaded after signing in again", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const account = await register(page);
  await prepareReflectionBooking(page, account.email);
  const title = "A reflection from a small experiment";
  const note =
    "  I tried two approaches.\nI learned by sketching a solution — then checking it.\nNext, I will explain one example.  ";
  await page.getByLabel("Evidence title", { exact: true }).fill(title);
  await page
    .getByRole("radio", { name: /^Write a reflection(?:\s|$)/ })
    .check();
  const reflection = page.getByLabel("Your reflection", { exact: true });
  await expect(reflection).toHaveAttribute("maxlength", "5000");
  await expect(
    page.getByText("0 of 5,000 characters", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit evidence", exact: true }),
  ).toBeDisabled();
  await reflection.fill("   ");
  await expect(reflection).toHaveAttribute("aria-invalid", "true");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Write a short reflection before submitting." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit evidence", exact: true }),
  ).toBeDisabled();
  await reflection.fill("");
  await expect(reflection).toHaveAttribute("aria-invalid", "false");
  await reflection.focus();
  await page.keyboard.insertText(note);
  await expect(reflection).toHaveValue(note);
  await page.getByRole("radio", { name: /^Upload a file(?:\s|$)/ }).click();
  await page.getByRole("button", { name: "Keep draft", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: /^Write a reflection(?:\s|$)/ }),
  ).toBeChecked();
  await expect(reflection).toHaveValue(note);
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
        path: testInfo.outputPath(`reflection-evidence-${width}.png`),
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
  await page
    .getByRole("button", { name: "Submit evidence", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
  await chooseView(page, "Evidence");
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toHaveCount(1);
  let previews = 0;
  const capturePreview = "**/api/evidence/*/content";
  await page.route(capturePreview, async (route) => {
    previews++;
    await route.fallback();
  });
  await page
    .getByRole("button", {
      name: `Version history for ${title}`,
      exact: true,
    })
    .click();
  const history = page.getByRole("dialog", {
    name: "Document history",
    exact: true,
  });
  const read = history.getByText("Read submitted text", { exact: true });
  await expect(read).toBeVisible();
  expect(previews).toBe(0);
  await read.focus();
  await page.keyboard.press("Enter");
  const preview = history.getByRole("region", {
    name: "Submitted text",
    exact: true,
  });
  await expect(preview).toBeVisible();
  expect(await preview.textContent()).toBe(`${note}\n`);
  await expect(preview).toHaveAttribute("tabindex", "0");
  await preview.focus();
  await expect(preview).toBeFocused();
  const previewAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(previewAccessibility.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("reflection-preview-320.png"),
  });
  expect(previews).toBe(1);
  await read.click();
  await expect(preview).toHaveCount(0);
  await read.click();
  await expect(preview).toBeVisible();
  expect(await preview.textContent()).toBe(`${note}\n`);
  expect(previews).toBe(2);
  await history
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await page.unroute(capturePreview);
  await expectPrivateDownload(page, title, `${note}\n`);
});

test("a committed reflection with a lost submit response keeps an immutable draft and retries one evidence receipt", async ({
  page,
}) => {
  const account = await register(page);
  await prepareReflectionBooking(page, account.email);
  const title = "A reflection with an interrupted response";
  const note =
    "Synthetic reflection: I compared two examples.\nMy next step is to explain the difference.";
  await writeReflection(page, title, note);
  let creates = 0;
  const submissions: Array<{ path: string; requestId: string }> = [];
  await page.route("**/api/evidence/uploads", async (route) => {
    if (route.request().method() === "POST") creates++;
    await route.fallback();
  });
  await page.route("**/api/evidence/uploads/*/submit", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const input = route.request().postDataJSON() as { requestId: string };
    submissions.push({ path, requestId: input.requestId });
    if (submissions.length === 1) {
      const committed = await route.fetch({ url: `${apiOrigin}${path}` });
      expect(committed.ok()).toBe(true);
      await route.abort("connectionfailed");
    } else await route.fallback();
  });
  const submit = page.getByRole("button", {
    name: "Submit evidence",
    exact: true,
  });
  await expect(submit).toBeEnabled();
  await submit.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(
    page.getByRole("alert").filter({ hasText: /could not be reached/i }),
  ).toBeVisible();
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    note,
  );
  await expect(
    page.getByLabel("Your reflection", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Evidence title", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("radio", { name: /^Upload a file(?:\s|$)/ }),
  ).toBeDisabled();
  expect(creates).toBe(1);
  expect(submissions).toHaveLength(1);
  await page
    .getByRole("button", { name: "Retry this upload", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toHaveCount(1);
  expect(creates).toBe(1);
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toHaveCount(1);
  await expectPrivateDownload(page, title, `${note}\n`);
});

test("a previously readable family reflection is cleared when access is revoked during a new private preview request", async ({
  page,
  browser,
}) => {
  const student = await register(page);
  await prepareReflectionBooking(page, student.email);
  const title = "Private synthetic family reflection";
  const note =
    "Private synthetic text: this reflection is only for an authorized linked family account.";
  await writeReflection(page, title, note);
  await page
    .getByRole("button", { name: "Submit evidence", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: `Version history for ${title}`,
      exact: true,
    }),
  ).toBeVisible();
  const parentContext = await browser.newContext({
    baseURL: webOrigin,
    timezoneId: "America/Phoenix",
  });
  let release: (() => void) | undefined;
  try {
    await isolate(parentContext);
    const parentPage = await parentContext.newPage();
    const parent = await register(parentPage, "parent");
    const studentUid = await callFixture("findUid", student.email);
    const parentUid = await callFixture("findUid", parent.email);
    await callFixture("linkFamily", {
      studentUid,
      parentUid,
      consentReference: "Synthetic text-preview privacy fixture consent.",
    });
    await parentPage.reload();
    await chooseView(parentPage, "Evidence");
    await expect(
      parentPage.getByRole("button", {
        name: "Submit evidence",
        exact: true,
      }),
    ).toHaveCount(0);
    await parentPage
      .getByRole("button", {
        name: `Version history for ${title}`,
        exact: true,
      })
      .click();
    const history = parentPage.getByRole("dialog", {
      name: "Document history",
      exact: true,
    });
    const read = history.getByText("Read submitted text", { exact: true });
    const preview = history.getByRole("region", {
      name: "Submitted text",
      exact: true,
    });
    await read.click();
    await expect(preview).toBeVisible();
    expect(await preview.textContent()).toBe(`${note}\n`);
    await read.click();
    await expect(preview).toHaveCount(0);
    let started: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    await parentPage.route("**/api/evidence/*/content", async (route) => {
      started?.();
      await held;
      await route.fallback();
    });
    let downloads = 0;
    parentPage.on("download", () => {
      downloads++;
    });
    await read.click();
    await ready;
    await expect(preview).toHaveCount(0);
    await callFixture("revokeFamily", { studentUid, parentUid });
    const denied = parentPage.waitForResponse(
      (response) =>
        /^\/api\/evidence\/[^/]+\/content$/.test(
          new URL(response.url()).pathname,
        ) && response.status() === 403,
    );
    release?.();
    await denied;
    await expect(history).not.toBeVisible({ timeout: 3_000 });
    await expect(
      parentPage.getByRole("region", { name: "Submitted text", exact: true }),
    ).toHaveCount(0);
    await expect(parentPage.getByText(note, { exact: true })).toHaveCount(0);
    await expect(
      parentPage
        .getByRole("alert")
        .filter({ hasText: /permission|access|not available/i })
        .first(),
    ).toBeVisible();
    expect(downloads).toBe(0);
  } finally {
    release?.();
    await parentContext.close();
  }
});

test("an uploaded reflection interrupted before submission can be recovered within its expiry after refresh and a new sign-in", async ({
  page,
}) => {
  const account = await register(page);
  await prepareReflectionBooking(page, account.email);
  const title = "An interrupted reflection recovered before expiry";
  const note =
    "  Synthetic reflection: I checked my first example.\nNext, I will explain why it worked.  ";
  await writeReflection(page, title, note);
  let creates = 0;
  let files = 0;
  const submissions: string[] = [];
  await page.route("**/api/evidence/uploads", async (route) => {
    if (route.request().method() === "POST") creates++;
    await route.fallback();
  });
  await page.route("**/api/evidence/uploads/*/content", async (route) => {
    if (route.request().method() === "PUT") files++;
    await route.fallback();
  });
  await page.route("**/api/evidence/uploads/*/submit", async (route) => {
    submissions.push(new URL(route.request().url()).pathname);
    // The real server has confirmed the file PUT, but this request never
    // reaches its submission handler. This is not a saved Evidence record.
    if (submissions.length === 1) await route.abort("connectionfailed");
    else await route.fallback();
  });
  await page
    .getByRole("button", { name: "Submit evidence", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: /could not be reached/i }),
  ).toBeVisible();
  expect(creates).toBe(1);
  expect(files).toBe(1);
  expect(submissions).toHaveLength(1);
  await expect(
    page.getByRole("button", {
      name: `Version history for ${title}`,
      exact: true,
    }),
  ).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  const uploads = page.getByRole("list", {
    name: "Your unfinished Evidence uploads",
    exact: true,
  });
  const savedUpload = uploads.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
  await expect(
    savedUpload.getByText("File saved", { exact: true }),
  ).toBeVisible();
  await expect(savedUpload.getByText(/Available until/)).toBeVisible();
  const expiry = await savedUpload.locator("time").getAttribute("datetime");
  expect(Date.parse(expiry!)).toBeGreaterThan(Date.now());
  expect(Date.parse(expiry!) - Date.now()).toBeLessThanOrEqual(20 * 60_000);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
  await chooseView(page, "Evidence");
  await expect(
    savedUpload.getByText("File saved", { exact: true }),
  ).toBeVisible();
  await expect(savedUpload.locator("time")).toHaveAttribute(
    "datetime",
    expiry!,
  );
  await expect(
    page.getByRole("button", {
      name: `Version history for ${title}`,
      exact: true,
    }),
  ).toHaveCount(0);
  expect(submissions).toHaveLength(1);
  await savedUpload
    .getByRole("button", { name: "Finish submission", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: `Version history for ${title}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(savedUpload).toHaveCount(0);
  expect(creates).toBe(1);
  expect(files).toBe(1);
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toBe(submissions[1]);
  await expectPrivateDownload(page, title, `${note}\n`);
});
