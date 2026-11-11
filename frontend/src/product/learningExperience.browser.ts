import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { LearningGoal } from "../api";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webOrigin = "http://127.0.0.1:5196";
const apiOrigin = "http://127.0.0.1:8806";
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
        TALA_BROWSER_TEST_API_PORT: "8806",
        TALA_BROWSER_TEST_WEB_PORT: "5196",
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
      () => reject(new Error("The isolated experience server did not start.")),
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
      reject(new Error("The isolated experience server exited."));
    });
  });
}

async function isolate(context: BrowserContext) {
  const recordPageError = (page: Page) =>
    page.on("pageerror", () =>
      runtimeErrors.push("Unhandled experience runtime error"),
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
    "Learning experience must not contact Firebase or external services",
  ).toEqual([]);
});

async function register(
  page: Page,
  role: "student" | "parent" = "student",
  displayName?: string,
) {
  const suffix = randomUUID();
  const account = {
    name: displayName ?? `Synthetic learning experience ${role}`,
    email: `${suffix}@example.test`,
    password: `Synthetic-only-${suffix}`,
  };
  await page.goto("/#/register");
  await page.getByLabel("Name", { exact: true }).fill(account.name);
  await page
    .getByRole("radio", {
      name: role === "parent" ? "Parent or guardian" : "Student",
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

type PrivateReflection = {
  ownerUid: string;
  title: string;
  text: string;
  status: "empty" | "saved";
  version: number;
  updatedAt: string | null;
};

function draftPanel(page: Page): Locator {
  return page.getByRole("region", {
    name: "Private reflection draft",
    exact: true,
  });
}

async function openDisclosure(scope: Locator, name: string) {
  const summary = scope.locator("summary").filter({ hasText: name });
  const details = summary.locator("..");
  if (!(await details.evaluate((element) => element.hasAttribute("open"))))
    await summary.click();
}

async function chooseView(
  page: Page,
  name: "Today" | "Evidence" | "Meetings" | "Learning plan",
) {
  const control = page
    .getByRole("navigation", { name: "Workspace sections", exact: true })
    .getByRole("button", { name, exact: true });
  await control.click();
  await expect(control).toHaveAttribute("aria-current", "page");
}

async function reflectionEditor(page: Page) {
  await chooseView(page, "Evidence");
  await page
    .getByRole("radio", { name: /^Write a reflection(?:\s|$)/ })
    .check();
  await expect(
    page.getByLabel("Your reflection", { exact: true }),
  ).toBeVisible();
}

async function writeReflection(page: Page, title: string, text: string) {
  await reflectionEditor(page);
  await page.getByLabel("Evidence title", { exact: true }).fill(title);
  await page.getByLabel("Your reflection", { exact: true }).fill(text);
}

async function readDraft(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/reflection-draft", {
      credentials: "same-origin",
    });
    return {
      status: response.status,
      body: (await response.json()) as PrivateReflection,
    };
  });
}

async function saveDraftViaApi(
  page: Page,
  title: string,
  text: string,
  version = 0,
) {
  return page.evaluate(
    async (input) => {
      const session = (await (
        await fetch("/api/session", { credentials: "same-origin" })
      ).json()) as { csrfToken: string; session: { uid: string } };
      const response = await fetch("/api/reflection-draft", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "X-TALA-User": session.session.uid,
        },
        body: JSON.stringify({ ...input, requestId: crypto.randomUUID() }),
      });
      if (response.status !== 200)
        throw new Error(
          `Synthetic reflection save failed: ${response.status}.`,
        );
      return (await response.json()) as PrivateReflection;
    },
    { title, text, version },
  );
}

async function savePrivateDraft(page: Page) {
  await draftPanel(page)
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await confirmSavedReplacementIfShown(page);
  await expect(
    draftPanel(page).getByText("Draft saved.", { exact: true }),
  ).toBeVisible();
}

async function confirmSavedReplacementIfShown(page: Page) {
  const confirmation = page.getByRole("dialog", {
    name: "Replace your saved reflection?",
    exact: true,
  });
  if (await confirmation.isVisible())
    await confirmation
      .getByRole("button", { name: "Replace saved reflection", exact: true })
      .click();
}

async function resumePrivateDraft(page: Page, title: string, text: string) {
  await chooseView(page, "Evidence");
  await draftPanel(page)
    .getByRole("button", { name: "Resume saved reflection", exact: true })
    .click();
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    title,
  );
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    text,
  );
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Keep your unsent work?",
    exact: true,
  });
  if (await confirmation.isVisible())
    await confirmation
      .getByRole("button", {
        name: "Sign out and clear unsent work",
        exact: true,
      })
      .click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
}

async function signIn(
  page: Page,
  account: { email: string; password: string },
) {
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
}

test("a new student without bookings saves a private Unicode reflection and explicitly resumes it after refresh and a new sign-in", async ({
  page,
}, testInfo) => {
  const account = await register(page);
  const title = "  My private reflection — 森 🌿  ";
  const text =
    "  I tried a new pattern — café.\n\n我学会了比较。 🌱\nNext, I will explain one example.  ";
  await writeReflection(page, title, text);
  await expect(
    page.getByRole("button", { name: "Submit evidence", exact: true }),
  ).toBeDisabled();
  await savePrivateDraft(page);
  const saved = await readDraft(page);
  expect(saved.status).toBe(200);
  expect(saved.body).toMatchObject({
    title,
    text,
    status: "saved",
    version: 1,
  });
  expect(saved.body.updatedAt).not.toBeNull();
  const workspace = (await page.evaluate(async () =>
    (await fetch("/api/workspace", { credentials: "same-origin" })).json(),
  )) as { evidence: unknown[]; activeAppointments: unknown[] };
  expect(workspace.evidence).toEqual([]);
  expect(workspace.activeAppointments).toEqual([]);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width === 320) {
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(result.violations).toEqual([]);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`draft-saved-${width}.png`),
      fullPage: true,
    });
  }
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await reflectionEditor(page);
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    "",
  );
  await resumePrivateDraft(page, title, text);
  await signOut(page);
  await signIn(page, account);
  await resumePrivateDraft(page, title, text);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain(title);
  expect(stored).not.toContain(text);
});

test("a stale tab keeps its unsent writing after a version conflict until the student explicitly replaces it", async ({
  page,
  context,
}) => {
  await register(page);
  const title = "A shared-tab private draft";
  const first = "First saved synthetic paragraph.";
  const newer = "A newer paragraph saved in the original tab.";
  const alternate =
    "My unsent alternate paragraph stays here after the conflict.";
  await writeReflection(page, title, first);
  await savePrivateDraft(page);
  const other = await context.newPage();
  await other.goto("/#/dashboard?view=evidence");
  await resumePrivateDraft(other, title, first);
  await page.bringToFront();
  await page.getByLabel("Your reflection", { exact: true }).fill(newer);
  await savePrivateDraft(page);
  await other.bringToFront();
  await other.getByLabel("Your reflection", { exact: true }).fill(alternate);
  const conflict = other.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/reflection-draft" &&
      response.request().method() === "POST" &&
      response.status() === 409,
  );
  await draftPanel(other)
    .getByRole("button", { name: "Save private draft", exact: true })
    .click();
  await confirmSavedReplacementIfShown(other);
  await conflict;
  await expect(draftPanel(other).getByRole("alert")).toBeVisible();
  await expect(
    other.getByLabel("Your reflection", { exact: true }),
  ).toHaveValue(alternate);
  expect((await readDraft(other)).body).toMatchObject({
    text: newer,
    version: 2,
  });
  await draftPanel(other)
    .getByRole("button", { name: "Use saved version", exact: true })
    .click();
  await other
    .getByRole("button", { name: "Keep my writing", exact: true })
    .click();
  await expect(
    other.getByLabel("Your reflection", { exact: true }),
  ).toHaveValue(alternate);
  await draftPanel(other)
    .getByRole("button", { name: "Resume saved reflection", exact: true })
    .click();
  await other
    .getByRole("button", { name: "Replace with saved draft", exact: true })
    .click();
  await expect(
    other.getByLabel("Your reflection", { exact: true }),
  ).toHaveValue(newer);
  expect((await readDraft(other)).body.version).toBe(2);
});

test("an interrupted committed draft save freezes editing and retries one exact operation without increasing the version twice", async ({
  page,
}) => {
  await register(page);
  const title = "One private draft save";
  const text = "This synthetic paragraph must be saved once — not duplicated.";
  await writeReflection(page, title, text);
  const writes: unknown[] = [];
  await page.route("**/api/reflection-draft", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    writes.push(route.request().postDataJSON());
    if (writes.length === 1) {
      const committed = await route.fetch({
        url: `${apiOrigin}/api/reflection-draft`,
      });
      expect(committed.status()).toBe(200);
      await route.abort("connectionfailed");
    } else await route.fallback();
  });
  const save = draftPanel(page).getByRole("button", {
    name: "Save private draft",
    exact: true,
  });
  await expect(save).toBeEnabled();
  await save.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(draftPanel(page).getByRole("alert")).toBeVisible();
  await expect(
    page.getByLabel("Evidence title", { exact: true }),
  ).not.toBeEditable();
  await expect(
    page.getByLabel("Your reflection", { exact: true }),
  ).not.toBeEditable();
  expect(writes).toHaveLength(1);
  expect((await readDraft(page)).body).toMatchObject({
    title,
    text,
    version: 1,
  });
  await draftPanel(page)
    .getByRole("button", { name: "Retry draft save", exact: true })
    .click();
  await expect(
    draftPanel(page).getByText("Draft saved.", { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  expect((await readDraft(page)).body).toMatchObject({
    title,
    text,
    status: "saved",
    version: 1,
  });
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    text,
  );
});

test("writing entered while Resume is checking the server is kept until the student explicitly chooses a replacement", async ({
  page,
}) => {
  await register(page);
  const savedTitle = "Previously saved private reflection";
  const savedText = "This paragraph was saved before the new writing began.";
  await saveDraftViaApi(page, savedTitle, savedText);
  await page.reload();
  await reflectionEditor(page);
  await expect(page.getByLabel("Evidence title", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    "",
  );
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  let captured = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/reflection-draft", async (route) => {
    if (captured || route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    captured = true;
    const response = await route.fetch({
      url: `${apiOrigin}/api/reflection-draft`,
    });
    expect(response.status()).toBe(200);
    started?.();
    await held;
    await route
      .fulfill({ response })
      .catch(() => route.abort().catch(() => {}));
  });
  const title = "New local writing typed during the request";
  const text =
    "Synthetic new paragraphs must not be replaced by an older in-flight response.";
  try {
    await draftPanel(page)
      .getByRole("button", { name: "Resume saved reflection", exact: true })
      .click();
    await ready;
    await page.getByLabel("Evidence title", { exact: true }).fill(title);
    await page.getByLabel("Your reflection", { exact: true }).fill(text);
    release?.();
    const confirmation = page.getByRole("dialog", {
      name: "Replace the writing in this tab?",
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await expect(
      page.getByLabel("Evidence title", { exact: true }),
    ).toHaveValue(title);
    await expect(
      page.getByLabel("Your reflection", { exact: true }),
    ).toHaveValue(text);
    await confirmation
      .getByRole("button", { name: "Keep my writing", exact: true })
      .click();
    await expect(
      page.getByLabel("Your reflection", { exact: true }),
    ).toHaveValue(text);
    expect((await readDraft(page)).body).toMatchObject({
      title: savedTitle,
      text: savedText,
      version: 1,
    });
    await draftPanel(page)
      .getByRole("button", { name: "Save private draft", exact: true })
      .click();
    const replaceSaved = page.getByRole("dialog", {
      name: "Replace your saved reflection?",
      exact: true,
    });
    await expect(replaceSaved).toBeVisible();
    expect((await readDraft(page)).body.version).toBe(1);
    await replaceSaved
      .getByRole("button", { name: "Replace saved reflection", exact: true })
      .click();
    await expect(
      draftPanel(page).getByText("Draft saved.", {
        exact: true,
      }),
    ).toBeVisible();
    expect((await readDraft(page)).body).toMatchObject({
      title,
      text,
      status: "saved",
      version: 2,
    });
  } finally {
    release?.();
  }
});

test("clearing a saved draft requires confirmation and does not clear the current editor or resurrect the saved draft after sign-in", async ({
  page,
}) => {
  const account = await register(page);
  const title = "A draft to clear explicitly";
  const text =
    "Current synthetic writing is retained until the student leaves this tab.";
  await writeReflection(page, title, text);
  await savePrivateDraft(page);
  await draftPanel(page)
    .getByRole("button", { name: "Clear saved draft", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Keep saved draft", exact: true })
    .click();
  expect((await readDraft(page)).body).toMatchObject({
    status: "saved",
    version: 1,
  });
  await draftPanel(page)
    .getByRole("button", { name: "Clear saved draft", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Clear saved draft", exact: true })
    .click();
  await expect
    .poll(async () => (await readDraft(page)).body.status)
    .toBe("empty");
  expect((await readDraft(page)).body).toMatchObject({
    title: "",
    text: "",
    status: "empty",
    version: 2,
  });
  await expect(page.getByLabel("Your reflection", { exact: true })).toHaveValue(
    text,
  );
  await signOut(page);
  await signIn(page, account);
  await chooseView(page, "Evidence");
  await expect(
    draftPanel(page).getByRole("button", {
      name: "Resume saved reflection",
      exact: true,
    }),
  ).toHaveCount(0);
  expect((await readDraft(page)).body).toMatchObject({
    title: "",
    text: "",
    status: "empty",
    version: 2,
  });
});

test("a linked parent can read permitted student records but cannot request or see the student's private reflection draft", async ({
  page,
  browser,
}) => {
  const student = await register(page);
  const title = "Private student reflection, not a family record";
  const text =
    "Synthetic private writing is never shared by a parent relationship.";
  await saveDraftViaApi(page, title, text);
  const parentContext = await browser.newContext({
    baseURL: webOrigin,
    timezoneId: "America/Phoenix",
  });
  try {
    await isolate(parentContext);
    const parentPage = await parentContext.newPage();
    const parent = await register(parentPage, "parent");
    await callFixture("linkFamily", {
      studentUid: await callFixture("findUid", student.email),
      parentUid: await callFixture("findUid", parent.email),
      consentReference: "Synthetic draft-isolation family fixture consent.",
    });
    await parentPage.reload();
    await chooseView(parentPage, "Evidence");
    await expect(draftPanel(parentPage)).toHaveCount(0);
    await expect(
      parentPage.getByRole("button", {
        name: "Save private draft",
        exact: true,
      }),
    ).toHaveCount(0);
    const denied = await readDraft(parentPage);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain(title);
    expect(JSON.stringify(denied.body)).not.toContain(text);
    await expect(parentPage.getByText(title, { exact: true })).toHaveCount(0);
    await expect(parentPage.getByText(text, { exact: true })).toHaveCount(0);
    expect((await readDraft(page)).body).toMatchObject({
      title,
      text,
      status: "saved",
    });
  } finally {
    await parentContext.close();
  }
});

test("a delayed old-account draft read cannot reappear after another tab signs into a different student account", async ({
  page,
  context,
  browser,
}) => {
  const first = await register(page);
  const title = "The previous student's private draft";
  const text =
    "These synthetic private paragraphs belong only to the previous account.";
  await saveDraftViaApi(page, title, text);
  const secondContext = await browser.newContext({
    baseURL: webOrigin,
    timezoneId: "America/Phoenix",
  });
  let second: Awaited<ReturnType<typeof register>>;
  try {
    await isolate(secondContext);
    second = await register(
      await secondContext.newPage(),
      "student",
      "Synthetic second student",
    );
  } finally {
    await secondContext.close();
  }
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  let ended: (() => void) | undefined;
  let captured = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const drained = new Promise<void>((resolve) => {
    ended = resolve;
  });
  await page.route("**/api/reflection-draft", async (route) => {
    if (captured || route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    captured = true;
    const response = await route.fetch({
      url: `${apiOrigin}/api/reflection-draft`,
    });
    expect(response.status()).toBe(200);
    started?.();
    await held;
    try {
      await route.fulfill({ response });
    } catch {
      await route.abort().catch(() => {});
    } finally {
      ended?.();
    }
  });
  try {
    await page.reload();
    await ready;
    const controller = await context.newPage();
    await controller.goto("/#/dashboard");
    await expect(
      controller.getByRole("heading", {
        name: `Hello, ${first.name}.`,
        exact: true,
      }),
    ).toBeVisible();
    await signOut(controller);
    await signIn(controller, second!);
    await page.bringToFront();
    await expect(
      page.getByRole("heading", {
        name: `Hello, ${second!.name}.`,
        exact: true,
      }),
    ).toBeVisible();
    release?.();
    await drained;
    await reflectionEditor(page);
    await expect(
      page.getByLabel("Evidence title", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByLabel("Your reflection", { exact: true }),
    ).toHaveValue("");
    await expect(
      draftPanel(page).getByRole("button", {
        name: "Resume saved reflection",
        exact: true,
      }),
    ).toHaveCount(0);
    const current = await readDraft(page);
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({
      title: "",
      text: "",
      status: "empty",
      version: 0,
    });
    expect(current.body.ownerUid).not.toBe(
      await callFixture("findUid", first.email),
    );
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  } finally {
    release?.();
  }
});

async function createTodayGoal(page: Page): Promise<LearningGoal> {
  return page.evaluate(async () => {
    const session = (await (
      await fetch("/api/session", { credentials: "same-origin" })
    ).json()) as { csrfToken: string; session: { uid: string } };
    const response = await fetch("/api/learning-goals", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
        "X-TALA-User": session.session.uid,
      },
      body: JSON.stringify({
        title: "Explain one saved learning example",
        notes: "Synthetic planning notes only.",
        dueDate: null,
        steps: [
          {
            id: crypto.randomUUID(),
            title: "Try the first example",
            completed: false,
          },
        ],
        requestId: crypto.randomUUID(),
      }),
    });
    if (response.status !== 201)
      throw new Error(`Synthetic Today goal failed: ${response.status}.`);
    return response.json();
  });
}

test("Today opens the actual saved meeting and goal, resumes a private draft, and keeps revision writing out of private draft saves", async ({
  page,
  browser,
}) => {
  const student = await register(page);
  const goal = await createTodayGoal(page);
  const title = "A saved reflection waiting in Today";
  const text = "Synthetic reflection to resume from the saved next-step list.";
  await saveDraftViaApi(page, title, text);
  const operatorContext = await browser.newContext({
    baseURL: webOrigin,
    timezoneId: "America/Phoenix",
  });
  try {
    await isolate(operatorContext);
    const operator = await register(await operatorContext.newPage());
    await callFixture("promote", operator.email);
    const seed = (await callFixture("seedPagination", {
      studentEmail: student.email,
      operatorEmail: operator.email,
    })) as {
      activeBookingId: string;
      revisionEvidenceId: string;
      revisionTitle: string;
    };
    await page.bringToFront();
    await page.reload();
    await chooseView(page, "Today");
    const tasks = page.locator(".today-workspace");
    await tasks
      .getByRole("button", { name: "Prepare for meeting", exact: true })
      .click();
    await expect(page.locator("#meeting-preparation")).toHaveAttribute(
      "open",
      "",
    );
    await expect(page.locator("#meeting-preparation-heading")).toBeFocused();
    expect(new URLSearchParams(page.url().split("?")[1]).get("view")).toBe(
      "meetings",
    );
    expect(
      new URLSearchParams(page.url().split("?")[1]).get("booking"),
    ).toBeNull();
    await chooseView(page, "Today");
    await openDisclosure(tasks, "Next up");
    await tasks
      .getByRole("button", { name: "Continue learning goal", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Learning plan", exact: true })
        .getByRole("heading", { name: goal.title, exact: true }),
    ).toBeFocused();
    expect(new URLSearchParams(page.url().split("?")[1]).get("goal")).toBe(
      goal.id,
    );
    await expect(
      page.getByRole("checkbox", {
        name: "Complete step “Try the first example”",
        exact: true,
      }),
    ).not.toBeChecked();
    await chooseView(page, "Today");
    await openDisclosure(tasks, "Next up");
    await tasks
      .getByRole("button", { name: "Resume reflection draft", exact: true })
      .click();
    await expect(
      page.getByLabel("Evidence title", { exact: true }),
    ).toHaveValue(title);
    await expect(
      page.getByLabel("Your reflection", { exact: true }),
    ).toHaveValue(text);
    await page.getByRole("radio", { name: /^Upload a file(?:\s|$)/ }).click();
    await page
      .getByRole("button", { name: "Discard draft and switch", exact: true })
      .click();
    await expect(
      draftPanel(page).getByRole("button", {
        name: "Save private draft",
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByLabel("Show documents", { exact: true })
      .selectOption("needs_revision");
    await page
      .getByRole("button", {
        name: `Prepare revision of ${seed.revisionTitle}`,
        exact: true,
      })
      .click();
    await page
      .getByRole("radio", { name: /^Write a reflection(?:\s|$)/ })
      .check();
    await expect(
      page.getByLabel("Submission type", { exact: true }),
    ).toHaveValue(seed.revisionEvidenceId);
    await expect(
      draftPanel(page).getByRole("button", {
        name: "Save private draft",
        exact: true,
      }),
    ).toHaveCount(0);
    expect((await readDraft(page)).body).toMatchObject({
      title,
      text,
      status: "saved",
      version: 1,
    });
  } finally {
    await operatorContext.close();
  }
});

test("Today Focus, larger text and comfortable spacing stay keyboard-accessible and readable across device sizes", async ({
  page,
}, testInfo) => {
  const account = await register(page);
  const goal = await createTodayGoal(page);
  await page.reload();
  await chooseView(page, "Today");
  const overview = page.locator(".learning-overview");
  await expect(
    overview
      .locator(".today-primary-task")
      .getByRole("heading", { name: goal.title, exact: true }),
  ).toBeVisible();
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width === 320) {
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(result.violations).toEqual([]);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`today-default-${width}.png`),
      fullPage: true,
    });
  }
  await openDisclosure(overview, "View options");
  const focus = overview.getByRole("button", {
    name: "Focus view",
    exact: true,
  });
  const full = overview.getByRole("button", { name: "Full view", exact: true });
  await expect(full).toHaveAttribute("aria-pressed", "true");
  await focus.focus();
  await page.keyboard.press("Enter");
  await expect(focus).toHaveAttribute("aria-pressed", "true");
  await expect(focus).toBeFocused();
  await overview
    .getByLabel("Text size", { exact: true })
    .selectOption("larger");
  await overview
    .getByLabel("Spacing", { exact: true })
    .selectOption("comfortable");
  await expect(overview).toHaveAttribute("data-focus", "true");
  await expect(overview).toHaveAttribute("data-text-size", "larger");
  await expect(overview).toHaveAttribute("data-spacing", "comfortable");
  await expect(overview.locator(".learning-overview-full")).toBeHidden();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    await expect(full).toBeVisible();
    if (width !== 768) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`today-focus-${width}.png`),
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
  const stored = await page.evaluate(() =>
    localStorage.getItem("tala.today.display.v1"),
  );
  expect(JSON.parse(stored!)).toEqual({
    version: 1,
    focus: true,
    textSize: "larger",
    spacing: "comfortable",
  });
  expect(stored).not.toContain(account.email);
  expect(stored).not.toContain(goal.title);
  await page.reload();
  await openDisclosure(overview, "View options");
  await expect(focus).toHaveAttribute("aria-pressed", "true");
  await expect(overview.getByLabel("Text size", { exact: true })).toHaveValue(
    "larger",
  );
  await expect(overview.getByLabel("Spacing", { exact: true })).toHaveValue(
    "comfortable",
  );
  await full.focus();
  await page.keyboard.press("Enter");
  await expect(full).toBeFocused();
  await expect(full).toHaveAttribute("aria-pressed", "true");
  await openDisclosure(overview, "More");
  await expect(overview.locator(".learning-overview-full")).toBeVisible();
});
