import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { meetingRange } from "./meetingHelpers";

type Seed = {
  documentCount: number;
  learningCount: number;
  pastCount: number;
  availableCount: number;
  oldBookingId: string;
  oldBookingStartsAt: string;
  oldBookingEndsAt: string;
  revisionEvidenceId: string;
  revisionTitle: string;
  unreviewedEvidenceId: string;
  unreviewedTitle: string;
  oldLearningSummary: string;
  lastAvailableSlotId: string;
  activeBookingId: string;
};
let directory = "";
let closeServer: (() => Promise<void>) | undefined;
let rpc: (action: string, input: unknown) => Promise<unknown>;
const externalHosts: string[] = [],
  runtimeErrors: string[] = [];

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
  let ready: () => void = () => {};
  child.on(
    "message",
    (message: {
      ready?: boolean;
      id?: string;
      result?: unknown;
      error?: string;
    }) => {
      if (message.ready) ready();
      if (!message.id) return;
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    },
  );
  closeServer = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The isolated pagination server did not start.")),
      10_000,
    );
    ready = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("error", reject);
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("The isolated pagination server exited."));
    });
  });
  rpc = (action, input) =>
    new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The synthetic fixture operation timed out."));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      child.send({ id, action, input });
    });
}
async function restrict(context: BrowserContext) {
  context.on("page", (page) =>
    page.on("pageerror", () =>
      runtimeErrors.push("Unhandled application error"),
    ),
  );
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      ["blob:", "data:"].includes(url.protocol)
    )
      await route.continue();
    else {
      externalHosts.push(url.hostname);
      await route.abort();
    }
  });
}
async function register(page: Page, name: string) {
  const email = `${randomUUID()}@example.test`;
  const password = `Synthetic-only-${randomUUID()}`;
  await page.goto("/#/register");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: `Hello, ${name}.`, exact: true }),
  ).toBeVisible();
  return { email, password };
}
async function chooseView(page: Page, name: string) {
  const button = page
    .getByRole("navigation", { name: "Workspace sections", exact: true })
    .getByRole("button", { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
}
async function loadAll(
  scope: Locator,
  label: string,
  total: number,
  batch: number,
) {
  for (let count = batch; count < total; count += batch) {
    const expected = Math.min(total, count + batch);
    await scope
      .getByRole("button", { name: `Load more ${label}`, exact: true })
      .click();
    await expect(
      scope
        .getByRole("status")
        .filter({ hasText: new RegExp(`^${expected} ${label} loaded`) }),
    ).toBeVisible();
  }
}

test.beforeEach(async ({ context, page }) => {
  externalHosts.length = runtimeErrors.length = 0;
  page.on("pageerror", () => runtimeErrors.push("Unhandled application error"));
  await restrict(context);
  await startFixture();
});
test.afterEach(async ({ page }) => {
  await page.close();
  try {
    await closeServer?.();
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
  expect(runtimeErrors).toEqual([]);
  expect([...new Set(externalHosts)]).toEqual([]);
});

test("older student records and operator work remain discoverable across real paginated data and an interrupted page", async ({
  page,
  browser,
}) => {
  const student = await register(page, "Synthetic pagination learner");
  const staffContext = await browser.newContext({
    baseURL: "http://127.0.0.1:5180",
    timezoneId: "America/Phoenix",
  });
  try {
    await restrict(staffContext);
    const staffPage = await staffContext.newPage();
    const staff = await register(staffPage, "Synthetic pagination operator");
    await rpc("promote", staff.email);
    const seed = (await rpc("seedPagination", {
      studentEmail: student.email,
      operatorEmail: staff.email,
    })) as Seed;
    await page.bringToFront();
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "Hello, Synthetic pagination learner.",
        exact: true,
      }),
    ).toBeVisible();
    await chooseView(page, "Evidence");
    const evidence = page.locator("#evidence");
    const newest = evidence.getByRole("heading", {
      name: "Reviewed reflection 130",
      exact: true,
    });
    await expect(newest).toBeVisible();
    await expect(
      evidence.getByRole("heading", { name: seed.revisionTitle, exact: true }),
    ).toHaveCount(0);
    const cursors: string[] = [];
    let interrupted = false;
    await page.route("**/api/evidence?*", async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor) {
        cursors.push(cursor);
        if (!interrupted) {
          interrupted = true;
          await route.abort("connectionfailed");
          return;
        }
      }
      await route.continue();
    });
    await evidence
      .getByRole("button", { name: "Load more documents", exact: true })
      .click();
    await expect(
      evidence.getByRole("button", { name: "Retry documents", exact: true }),
    ).toBeVisible();
    await expect(newest).toBeVisible();
    await evidence
      .getByRole("button", { name: "Retry documents", exact: true })
      .click();
    await expect(
      evidence.getByRole("status").filter({ hasText: /^100 documents loaded/ }),
    ).toBeVisible();
    expect(cursors[0]).toBe(cursors[1]);
    await evidence
      .getByRole("button", { name: "Load more documents", exact: true })
      .click();
    await expect(
      evidence.getByRole("heading", { name: seed.revisionTitle, exact: true }),
    ).toBeVisible();
    await expect(newest).toHaveCount(1);
    await expect(
      evidence.getByRole("status").filter({
        hasText: new RegExp(`^${seed.documentCount} documents loaded`),
      }),
    ).toBeVisible();

    await evidence
      .getByLabel("Search documents", { exact: true })
      .fill(seed.revisionTitle);
    await expect(newest).toHaveCount(0);
    await expect(
      evidence.getByRole("heading", { name: seed.revisionTitle, exact: true }),
    ).toBeVisible();
    const pinnedBookingRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/appointments/${seed.oldBookingId}` && response.ok(),
    );
    await evidence
      .getByRole("button", {
        name: `Prepare revision of ${seed.revisionTitle}`,
        exact: true,
      })
      .click();
    await pinnedBookingRead;
    await expect(
      evidence.getByLabel("Related booking", { exact: true }),
    ).toHaveValue(seed.oldBookingId);
    await evidence
      .getByLabel("Evidence title", { exact: true })
      .fill("Unsent revision keeps its original booking");
    await evidence.getByLabel("File", { exact: true }).setInputFiles({
      name: "synthetic-revision.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic unsent revision only."),
    });
    await evidence
      .getByLabel("Show documents", { exact: true })
      .selectOption("reviewed");
    await expect(
      evidence
        .getByRole("status")
        .filter({ hasText: "No saved documents match this search or filter." }),
    ).toBeVisible();
    await expect(
      evidence.getByLabel("Related booking", { exact: true }),
    ).toHaveValue(seed.oldBookingId);
    await expect(
      evidence.getByLabel("Evidence title", { exact: true }),
    ).toHaveValue("Unsent revision keeps its original booking");
    expect(
      await evidence
        .getByLabel("File", { exact: true })
        .evaluate((input: HTMLInputElement) => input.files?.length),
    ).toBe(1);

    await chooseView(page, "Learning records");
    const learning = page.locator("#learning-records");
    await expect(
      learning
        .getByRole("status")
        .filter({ hasText: /^20 learning records loaded/ }),
    ).toBeVisible();
    await expect(
      learning.getByText(seed.oldLearningSummary, { exact: true }),
    ).toHaveCount(0);
    await loadAll(learning, "learning records", seed.learningCount, 20);
    await expect(
      learning.getByText(seed.oldLearningSummary, { exact: true }),
    ).toBeVisible();

    await chooseView(page, "Meetings");
    const meetings = page.locator("#meetings");
    await expect(
      meetings.getByText("Your current booking", { exact: true }),
    ).toBeVisible();
    const select = meetings.getByLabel("Available meeting time", {
      exact: true,
    });
    await expect(
      select.locator(`option[value="${seed.lastAvailableSlotId}"]`),
    ).toHaveCount(0);
    await loadAll(meetings, "available times", seed.availableCount, 50);
    await select.selectOption(seed.lastAvailableSlotId);
    await expect(select).toHaveValue(seed.lastAvailableSlotId);
    await loadAll(meetings, "bookings", seed.pastCount, 50);
    const oldRange = meetingRange(
      seed.oldBookingStartsAt,
      seed.oldBookingEndsAt,
      "America/Phoenix",
      "en-US",
    );
    const oldRow = meetings
      .locator(".meeting-history-list > li")
      .filter({ hasText: oldRange });
    await expect(oldRow).toHaveCount(1);
    const downloaded = page.waitForEvent("download");
    const verified = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/appointments/${seed.oldBookingId}` && response.ok(),
    );
    await oldRow
      .getByRole("button", { name: /^Download calendar for/ })
      .click();
    await verified;
    const download = await downloaded;
    const filename = await download.path();
    expect(filename).toBeTruthy();
    const calendar = await readFile(filename!, "utf8");
    expect(calendar).toContain(`UID:${seed.oldBookingId}@tala.local`);
    expect(calendar).toContain("CLASS:PRIVATE");
    await download.delete();
    await chooseView(page, "Evidence");
    await expect(
      evidence.getByLabel("Related booking", { exact: true }),
    ).toHaveValue(seed.oldBookingId);
    expect(
      await evidence
        .getByLabel("File", { exact: true })
        .evaluate((input: HTMLInputElement) => input.files?.length),
    ).toBe(1);

    await staffPage.bringToFront();
    await staffPage.reload();
    await expect(
      staffPage.getByRole("heading", {
        name: "Learning operations",
        exact: true,
      }),
    ).toBeVisible();
    const review = staffPage.getByRole("tabpanel", {
      name: /^Review evidence/,
    });
    await expect(
      review
        .locator(".operator-selection-list button")
        .filter({ hasText: seed.unreviewedTitle }),
    ).toBeVisible();
    await expect(
      review.getByRole("heading", {
        name: "Your review queue is clear.",
        exact: true,
      }),
    ).toHaveCount(0);
    await staffPage
      .getByRole("tab", { name: "Learning summaries", exact: true })
      .click();
    const periods = staffPage.getByRole("tabpanel", {
      name: "Learning summaries",
      exact: true,
    });
    await expect(
      periods.getByLabel("Meeting summary status", { exact: true }),
    ).toHaveValue("unpublished");
    const oldOperatorRange = await staffPage.evaluate(
      ({ starts, ends }) => {
        const start = new Date(starts),
          end = new Date(ends);
        return `${start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} – ${end.toLocaleTimeString([], { timeStyle: "short" })}`;
      },
      { starts: seed.oldBookingStartsAt, ends: seed.oldBookingEndsAt },
    );
    const oldest = periods
      .locator(".operator-selection-list > li button")
      .filter({ hasText: oldOperatorRange });
    await expect(oldest).toHaveCount(1);
    await expect(oldest).toContainText("Prepare summary");
    await oldest.click();
    await expect(
      periods.getByLabel("Reviewed learning summary", { exact: true }),
    ).toBeVisible();
  } finally {
    await staffContext.close();
  }
});

test("narrow reduced-motion pagination preserves keyboard focus, retry context and the native File draft", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const student = await register(page, "Synthetic keyboard learner");
  const staffContext = await browser.newContext({
    baseURL: "http://127.0.0.1:5180",
  });
  try {
    await restrict(staffContext);
    const staffPage = await staffContext.newPage();
    const staff = await register(staffPage, "Synthetic keyboard operator");
    await rpc("promote", staff.email);
    await rpc("seedPagination", {
      studentEmail: student.email,
      operatorEmail: staff.email,
    });
    await page.bringToFront();
    await page.reload();
    await chooseView(page, "Evidence");
    const evidence = page.locator("#evidence");
    const more = evidence.getByRole("button", {
      name: "Load more documents",
      exact: true,
    });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(
      evidence.getByRole("status").filter({ hasText: /^100 documents loaded/ }),
    ).toBeVisible();
    await expect(more).toBeFocused();
    const search = evidence.getByLabel("Search documents", { exact: true });
    await search.focus();
    await page.keyboard.type("Reviewed reflection 130");
    await expect(
      evidence.getByRole("status").filter({ hasText: /^1 documents loaded/ }),
    ).toBeVisible();
    await expect(search).toBeFocused();
    await search.fill("");
    await expect(
      evidence.getByRole("status").filter({ hasText: /^50 documents loaded/ }),
    ).toBeVisible();
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(
      evidence.getByRole("status").filter({ hasText: /^100 documents loaded/ }),
    ).toBeVisible();
    let failed = false;
    await page.route("**/api/evidence?*", async (route) => {
      if (
        new URL(route.request().url()).searchParams.has("cursor") &&
        !failed
      ) {
        failed = true;
        await route.abort("connectionfailed");
      } else await route.continue();
    });
    await more.focus();
    await page.keyboard.press("Enter");
    const retry = evidence.getByRole("button", {
      name: "Retry documents",
      exact: true,
    });
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    const complete = evidence
      .getByRole("status")
      .filter({ hasText: /^131 documents loaded/ });
    await expect(complete).toBeFocused();
    await evidence
      .getByLabel("Evidence title", { exact: true })
      .fill("Keyboard draft stays in this tab");
    await evidence.getByLabel("File", { exact: true }).setInputFiles({
      name: "keyboard-draft.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic keyboard draft only."),
    });
    await chooseView(page, "Meetings");
    await chooseView(page, "Evidence");
    await expect(
      evidence.getByLabel("Evidence title", { exact: true }),
    ).toHaveValue("Keyboard draft stays in this tab");
    expect(
      await evidence
        .getByLabel("File", { exact: true })
        .evaluate((input: HTMLInputElement) => input.files?.length),
    ).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .include("#evidence")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations.map(({ id }) => id),
    ).toEqual([]);
    await complete.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(tmpdir(), "tala-pagination-keyboard-mobile-qa.png"),
      fullPage: false,
    });
  } finally {
    await staffContext.close();
  }
});

test("rejected and unconfirmed Evidence uploads remain recoverable without losing files or overwriting stale revisions", async ({
  page,
  browser,
}) => {
  await register(page, "Synthetic upload recovery learner");
  const starts = new Date(Date.now() + 86_400_000);
  const slot = (await rpc("addAvailability", {
    startsAt: starts.toISOString(),
    endsAt: new Date(starts.getTime() + 1_800_000).toISOString(),
    label: "Synthetic recovery meeting",
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
  await chooseView(page, "Evidence");
  const evidence = page.locator("#evidence");
  const bytes = Buffer.from(
    "Synthetic upload recovery reflection. These are not real student records.",
  );
  const input = { name: "recovery.txt", mimeType: "text/plain", buffer: bytes };
  await evidence
    .getByLabel("Evidence title", { exact: true })
    .fill("Synthetic recovered reflection");
  await evidence.getByLabel("File", { exact: true }).setInputFiles(input);
  await page.route("**/api/evidence/uploads", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "RATE_LIMITED" } }),
      });
    else await route.continue();
  });
  await evidence
    .getByRole("button", { name: "Submit evidence", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Too many attempts");
  await evidence
    .getByRole("button", { name: "Clear local upload draft", exact: true })
    .click();
  await expect(
    evidence.getByLabel("Evidence title", { exact: true }),
  ).toBeEnabled();
  expect(
    await evidence
      .getByLabel("File", { exact: true })
      .evaluate((element: HTMLInputElement) => element.files?.length),
  ).toBe(1);
  expect(
    (await (await page.request.get("/api/evidence/uploads")).json()).uploads,
  ).toEqual([]);
  await page.unroute("**/api/evidence/uploads");

  let lostCreate = false,
    uploadId = "";
  const createIds: string[] = [];
  await page.route("**/api/evidence/uploads", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    createIds.push(
      (route.request().postDataJSON() as { requestId: string }).requestId,
    );
    if (!lostCreate) {
      lostCreate = true;
      const saved = await route.fetch();
      expect(saved.status()).toBe(201);
      uploadId = ((await saved.json()) as { uploadId: string }).uploadId;
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  await evidence
    .getByRole("button", { name: "Submit evidence", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("could not be reached");
  await expect(evidence.getByLabel("File", { exact: true })).toBeDisabled();
  await chooseView(page, "Meetings");
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Cancel this booking?",
    exact: true,
  });
  await expect(
    confirmation.getByRole("button", {
      name: "Confirm cancellation",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(confirmation).toContainText("Evidence file");
  await confirmation
    .getByRole("button", { name: "Keep booking", exact: true })
    .click();
  await chooseView(page, "Evidence");
  let partialStaged = false;
  await page.route("**/api/evidence/uploads/*/content", async (route) => {
    if (!partialStaged) {
      partialStaged = true;
      const id = new URL(route.request().url()).pathname.split("/").at(-2);
      expect(id).toBe(uploadId);
      await rpc("stagePartialUpload", {
        uploadId,
        prefixBase64: bytes.subarray(0, 7).toString("base64"),
      });
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "INTERNAL_ERROR" } }),
      });
    } else await route.continue();
  });
  await evidence
    .getByRole("button", { name: "Retry this upload", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("could not be confirmed");
  expect(createIds).toHaveLength(2);
  expect(createIds[0]).toBe(createIds[1]);
  await page.unroute("**/api/evidence/uploads");
  await page.unroute("**/api/evidence/uploads/*/content");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  const unfinished = page.getByRole("list", {
    name: "Your unfinished Evidence uploads",
    exact: true,
  });
  const originalFile = unfinished.getByLabel(
    "Choose original file for Synthetic recovered reflection",
    { exact: true },
  );
  await originalFile.setInputFiles({
    ...input,
    name: "wrong-file.txt",
    buffer: Buffer.alloc(bytes.length, 120),
  });
  await unfinished
    .getByRole("button", { name: "Upload and submit", exact: true })
    .click();
  await expect(unfinished.getByRole("alert")).toContainText("checksum");
  await originalFile.setInputFiles(input);
  await unfinished
    .getByRole("button", { name: "Upload and submit", exact: true })
    .click();
  await expect(
    evidence.getByRole("heading", {
      name: "Synthetic recovered reflection",
      exact: true,
      level: 3,
    }),
  ).toBeVisible();
  await expect(
    evidence.getByText("No unfinished uploads to continue.", { exact: true }),
  ).toBeVisible();
  const savedEvidence = (await (await page.request.get("/api/evidence")).json())
    .items as { id: string; reviewVersion: number }[];
  expect(savedEvidence).toHaveLength(1);
  expect(savedEvidence[0]!.id).toBe(uploadId);

  await evidence
    .getByLabel("Evidence title", { exact: true })
    .fill("Synthetic cancelled request");
  await evidence.getByLabel("File", { exact: true }).setInputFiles(input);
  await page.route("**/api/evidence/uploads/*/content", (route) =>
    route.abort("connectionfailed"),
  );
  await evidence
    .getByRole("button", { name: "Submit evidence", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("could not be reached");
  let lostCancellation = false,
    cancelledId = "";
  await page.route("**/api/evidence/uploads/*/cancel", async (route) => {
    cancelledId =
      new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    if (!lostCancellation) {
      lostCancellation = true;
      const saved = await route.fetch();
      expect(saved.ok()).toBe(true);
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  await evidence
    .getByRole("button", { name: "Cancel unsubmitted upload", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("could not be reached");
  await expect(
    evidence.getByLabel("Evidence title", { exact: true }),
  ).toBeDisabled();
  await evidence
    .getByRole("button", { name: "Cancel unsubmitted upload", exact: true })
    .click();
  await expect(
    evidence.getByLabel("Evidence title", { exact: true }),
  ).toBeEnabled();
  expect(
    (
      (await (
        await page.request.get(`/api/evidence/uploads/${cancelledId}`)
      ).json()) as { status: string }
    ).status,
  ).toBe("cancelled");
  expect(
    (await (await page.request.get("/api/evidence/uploads")).json()).uploads,
  ).toEqual([]);
  expect(
    await evidence
      .getByLabel("File", { exact: true })
      .evaluate((element: HTMLInputElement) => element.files?.length),
  ).toBe(1);
  await page.unroute("**/api/evidence/uploads/*/content");
  await page.unroute("**/api/evidence/uploads/*/cancel");

  const staffContext = await browser.newContext({
    baseURL: "http://127.0.0.1:5180",
  });
  try {
    await restrict(staffContext);
    const staffPage = await staffContext.newPage();
    const staff = await register(staffPage, "Synthetic revision reviewer");
    await rpc("promote", staff.email);
    const staffSession = (await (
      await staffPage.request.get("/api/session")
    ).json()) as { csrfToken: string; session: { uid: string } };
    const review = async (
      status: "reviewed" | "needs_revision",
      version: number,
    ) => {
      const response = await staffPage.request.post(
        `/api/evidence/${uploadId}/review`,
        {
          headers: {
            Origin: "http://127.0.0.1:5180",
            "X-CSRF-Token": staffSession.csrfToken,
            "X-TALA-User": staffSession.session.uid,
          },
          data: {
            status,
            note: "Synthetic review change for recovery validation.",
            expectedReviewVersion: version,
            requestId: randomUUID(),
          },
        },
      );
      expect(response.ok()).toBe(true);
      return (await response.json()) as { reviewVersion: number };
    };
    const needingRevision = await review("needs_revision", 0);
    await page.bringToFront();
    await evidence.getByLabel("File", { exact: true }).setInputFiles([]);
    await page
      .getByRole("button", { name: "Refresh records", exact: true })
      .click();
    await evidence
      .getByRole("button", {
        name: "Prepare revision of Synthetic recovered reflection",
        exact: true,
      })
      .click();
    await evidence.getByLabel("File", { exact: true }).setInputFiles(input);
    await page.route("**/api/evidence/uploads/*/content", (route) =>
      route.abort("connectionfailed"),
    );
    await evidence
      .getByRole("button", { name: "Submit revision", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("could not be reached");
    await review("reviewed", needingRevision.reviewVersion);
    await page.unroute("**/api/evidence/uploads/*/content");
    await evidence
      .getByRole("button", { name: "Retry this upload", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("changed");
    expect(
      (await (await page.request.get("/api/evidence")).json()).items,
    ).toHaveLength(1);
    await evidence
      .getByRole("button", { name: "Cancel unsubmitted upload", exact: true })
      .click();
    await expect(
      evidence.getByLabel("Submission type", { exact: true }),
    ).toBeEnabled();
    await evidence
      .getByLabel("Submission type", { exact: true })
      .selectOption("");
    await expect(evidence.getByLabel("File", { exact: true })).toBeEnabled();
    expect(
      await evidence
        .getByLabel("File", { exact: true })
        .evaluate((element: HTMLInputElement) => element.files?.length),
    ).toBe(1);
  } finally {
    await staffContext.close();
  }
});
