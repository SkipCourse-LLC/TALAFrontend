import { expect, test } from "@playwright/test";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { LearningGoal } from "../api";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webOrigin = "http://127.0.0.1:5194";
const apiOrigin = "http://127.0.0.1:8804";
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
        TALA_BROWSER_TEST_API_PORT: "8804",
        TALA_BROWSER_TEST_WEB_PORT: "5194",
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
        reject(new Error("The isolated organization server did not start.")),
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
      reject(new Error("The isolated organization server exited."));
    });
  });
}

async function isolate(context: BrowserContext) {
  const recordPageError = (page: Page) =>
    page.on("pageerror", () =>
      runtimeErrors.push("Unhandled organization runtime error"),
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
    "Learning organization must not contact Firebase or external services",
  ).toEqual([]);
});

async function register(page: Page, role: "student" | "parent" = "student") {
  const suffix = randomUUID();
  const account = {
    name: `Synthetic learning organization ${role}`,
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

function plan(page: Page) {
  return page.getByRole("region", { name: "Learning plan", exact: true });
}

function goalTitles(page: Page) {
  return plan(page)
    .getByRole("list", { name: "Saved learning goals", exact: true })
    .getByRole("heading", { level: 3 });
}

function goalRow(page: Page, title: string): Locator {
  return plan(page)
    .getByRole("list", { name: "Saved learning goals", exact: true })
    .locator(":scope > li")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

async function createGoal(
  page: Page,
  input: {
    title: string;
    notes?: string;
    dueDate?: string | null;
    steps?: Array<{ title: string; completed?: boolean }>;
  },
): Promise<LearningGoal> {
  return page.evaluate(async (goal) => {
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
        title: goal.title,
        notes: goal.notes ?? "",
        dueDate: goal.dueDate ?? null,
        steps: (goal.steps ?? []).map((step) => ({
          id: crypto.randomUUID(),
          title: step.title,
          completed: Boolean(step.completed),
        })),
        requestId: crypto.randomUUID(),
      }),
    });
    if (response.status !== 201)
      throw new Error(`Synthetic goal creation failed: ${response.status}.`);
    return response.json();
  }, input);
}

async function updateGoal(
  page: Page,
  goal: LearningGoal,
  patch: Partial<Pick<LearningGoal, "title" | "notes" | "dueDate" | "status">>,
): Promise<LearningGoal> {
  return page.evaluate(
    async ({ previous, changes }) => {
      const session = (await (
        await fetch("/api/session", { credentials: "same-origin" })
      ).json()) as { csrfToken: string; session: { uid: string } };
      const response = await fetch(`/api/learning-goals/${previous.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "X-TALA-User": session.session.uid,
        },
        body: JSON.stringify({
          title: previous.title,
          notes: previous.notes,
          dueDate: previous.dueDate,
          status: previous.status,
          steps: previous.steps,
          ...changes,
          version: previous.version,
          requestId: crypto.randomUUID(),
        }),
      });
      if (response.status !== 200)
        throw new Error(`Synthetic goal update failed: ${response.status}.`);
      return response.json();
    },
    { previous: goal, changes: patch },
  );
}

async function seedGoals(page: Page) {
  const zebra = await createGoal(page, {
    title: "Zebra observations",
    notes: "Observe the leaves carefully.",
    dueDate: "2027-06-10",
    steps: [{ title: "Compare two samples" }],
  });
  const alpha = await createGoal(page, {
    title: "Alpha sketches",
    notes: "Explain a constellation.",
    dueDate: "2027-04-04",
    steps: [{ title: "Draw a diagram" }],
  });
  const beta = await createGoal(page, {
    title: "Beta practice",
    notes: "Describe a pattern.",
    steps: [{ title: "Practice a short explanation", completed: true }],
  });
  return { zebra, alpha, beta };
}

async function refreshRecords(page: Page) {
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
}

async function downloadedText(page: Page, name: string) {
  const ready = page.waitForEvent("download");
  await plan(page).getByRole("button", { name, exact: true }).click();
  const download = await ready;
  expect(download.suggestedFilename()).toMatch(
    /^tala-learning-plan-\d{4}-\d{2}-\d{2}\.(txt|json)$/,
  );
  const filename = await download.path();
  expect(filename).not.toBeNull();
  const content = await readFile(filename!, "utf8");
  await download.delete();
  return content;
}

function exportedGoal(goal: LearningGoal) {
  return {
    title: goal.title,
    notes: goal.notes,
    dueDate: goal.dueDate,
    status: goal.status,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    completedAt: goal.completedAt,
    steps: goal.steps.map(({ title, completed }) => ({ title, completed })),
    linkedEvidenceCount: goal.linkedEvidenceCount,
  };
}

test("goal search and sorting organize saved work without changing an open draft", async ({
  page,
}, testInfo) => {
  await register(page);
  const saved = await seedGoals(page);
  await page.reload();
  await choosePlan(page);
  await expect(goalTitles(page)).toHaveText([
    "Alpha sketches",
    "Zebra observations",
    "Beta practice",
  ]);
  const search = plan(page).getByLabel("Search learning goals", {
    exact: true,
  });
  const sort = plan(page).getByLabel("Sort goals", { exact: true });
  await sort.selectOption("title");
  await expect(goalTitles(page)).toHaveText([
    "Alpha sketches",
    "Beta practice",
    "Zebra observations",
  ]);
  await search.fill("CONSTELLATION");
  await expect(goalTitles(page)).toHaveText(["Alpha sketches"]);
  await search.fill("short explanation");
  await expect(goalTitles(page)).toHaveText(["Beta practice"]);
  await plan(page)
    .getByRole("button", { name: "Clear search", exact: true })
    .click();
  await expect(search).toBeFocused();
  await goalRow(page, "Alpha sketches")
    .getByRole("button", { name: "Edit “Alpha sketches”", exact: true })
    .click();
  await page
    .getByLabel("Goal", { exact: true })
    .fill("Unsent learning intention");
  await page
    .getByLabel("Notes (optional)", { exact: true })
    .fill("This private draft has not been saved.");
  await search.fill("no-synthetic-goal-matches-this");
  await expect(goalTitles(page)).toHaveCount(0);
  await expect(
    plan(page).getByRole("heading", {
      name: "No goals match this search.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Goal", { exact: true })).toHaveValue(
    "Unsent learning intention",
  );
  await sort.selectOption("updated");
  await plan(page)
    .getByRole("button", { name: "Completed goals (0)", exact: true })
    .click();
  await expect(goalTitles(page)).toHaveCount(0);
  await plan(page)
    .getByRole("button", { name: "Clear search", exact: true })
    .click();
  await expect(
    plan(page).getByRole("heading", {
      name: "No completed goals yet.",
      exact: true,
    }),
  ).toBeVisible();
  await plan(page)
    .getByRole("button", { name: "All goals (3)", exact: true })
    .click();
  await expect(goalTitles(page)).toHaveCount(3);
  await expect(
    page.getByLabel("Notes (optional)", { exact: true }),
  ).toHaveValue("This private draft has not been saved.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(goalRow(page, "Alpha sketches")).toContainText(
    saved.alpha.notes,
  );
  await updateGoal(page, saved.zebra, {
    notes: "The most recently saved observation.",
  });
  await refreshRecords(page);
  await expect(goalTitles(page).first()).toHaveText("Zebra observations");
  await sort.selectOption("target");
  await expect(goalTitles(page)).toHaveText([
    "Alpha sketches",
    "Zebra observations",
    "Beta practice",
  ]);
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
    if (width !== 768) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`learning-organization-${width}.png`),
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
  await search.fill("Beta practice");
  await goalRow(page, "Beta practice")
    .getByRole("button", { name: "Edit “Beta practice”", exact: true })
    .click();
  await page
    .getByLabel("Goal", { exact: true })
    .fill("A renamed practice goal");
  await search.fill("nothing-matches-the-updated-title");
  await expect(goalTitles(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(goalRow(page, "A renamed practice goal")).toBeVisible();
});

test("text and JSON exports read all fresh saved goals and omit unsent changes and internal identifiers", async ({
  page,
}) => {
  const account = await register(page);
  const saved = await seedGoals(page);
  await page.reload();
  await choosePlan(page);
  await expect(goalRow(page, saved.alpha.title)).toContainText(
    saved.alpha.notes,
  );
  const changed = await updateGoal(page, saved.alpha, {
    notes:
      "A newly saved note from another authorized view — café.\nKeep its second line.",
    status: "completed",
  });
  await goalRow(page, saved.alpha.title)
    .getByRole("button", { name: `Edit “${saved.alpha.title}”`, exact: true })
    .click();
  await page.getByLabel("Goal", { exact: true }).fill("UNSENT EDITOR TITLE");
  await page
    .getByLabel("Notes (optional)", { exact: true })
    .fill("UNSENT EDITOR NOTES");
  await plan(page)
    .getByLabel("Search learning goals", { exact: true })
    .fill("nothing-in-this-saved-plan");
  await expect(goalTitles(page)).toHaveCount(0);
  await plan(page).getByText("Export plan", { exact: true }).click();
  let reads = 0;
  await page.route("**/api/learning-goals", async (route) => {
    if (route.request().method() === "GET") reads++;
    await route.fallback();
  });
  const exportedAt = "2026-10-26T19:30:00.000Z";
  await page.clock.setFixedTime(new Date(exportedAt));
  const json = await downloadedText(page, "Download JSON plan");
  const result = JSON.parse(json) as {
    format: string;
    version: number;
    exportedAt: string;
    goals: unknown[];
  };
  expect(Object.keys(result).sort()).toEqual([
    "exportedAt",
    "format",
    "goals",
    "version",
  ]);
  expect(result.format).toBe("tala.learning-plan");
  expect(result.version).toBe(1);
  expect(result.exportedAt).toBe(exportedAt);
  expect(json).toBe(`${JSON.stringify(result, null, 2)}\n`);
  expect(result.goals).toHaveLength(3);
  expect(result.goals).toEqual(
    expect.arrayContaining([
      exportedGoal(changed),
      exportedGoal(saved.beta),
      exportedGoal(saved.zebra),
    ]),
  );
  expect(reads).toBe(1);
  const text = await downloadedText(page, "Download text plan");
  expect(reads).toBe(2);
  expect(text).toContain(`Exported: ${exportedAt}`);
  expect(text).toContain("All saved goals: 3");
  expect(text).toContain("Status: Completed");
  expect(text).toContain("  [x] Practice a short explanation");
  expect(text.endsWith("\n")).toBe(true);
  for (const goal of [changed, saved.beta, saved.zebra]) {
    expect(text).toContain(goal.title);
    expect(text).toContain(goal.notes);
    for (const step of goal.steps) expect(text).toContain(step.title);
    for (const content of [json, text]) {
      expect(content).not.toContain(goal.id);
      expect(content).not.toContain(goal.ownerUid);
      for (const step of goal.steps) expect(content).not.toContain(step.id);
    }
  }
  for (const content of [json, text]) {
    expect(content).not.toContain(account.email);
    expect(content).not.toContain("UNSENT EDITOR TITLE");
    expect(content).not.toContain("UNSENT EDITOR NOTES");
  }
  await expect(page.getByLabel("Goal", { exact: true })).toHaveValue(
    "UNSENT EDITOR TITLE",
  );
  await expect(
    page.getByLabel("Notes (optional)", { exact: true }),
  ).toHaveValue("UNSENT EDITOR NOTES");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

for (const permissionChange of ["revoke", "disable"] as const) {
  test(`a linked parent export conceals cached goals after ${permissionChange === "revoke" ? "family access is revoked" : "student access is disabled"}`, async ({
    page,
    browser,
  }) => {
    const student = await register(page);
    const goal = await createGoal(page, {
      title: "Private family learning intention",
      notes:
        "Private synthetic family note shared only by an active consented relationship.",
      steps: [{ title: "A student-owned next step" }],
    });
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
        consentReference: "Synthetic organization export fixture consent.",
      });
      await parentPage.reload();
      await choosePlan(parentPage);
      await expect(goalRow(parentPage, goal.title)).toContainText(goal.notes);
      await expect(
        plan(parentPage).getByRole("button", { name: "Add goal", exact: true }),
      ).toHaveCount(0);
      await plan(parentPage).getByText("Export plan", { exact: true }).click();
      const allowed = JSON.parse(
        await downloadedText(parentPage, "Download JSON plan"),
      ) as { goals: unknown[] };
      expect(allowed.goals).toEqual([exportedGoal(goal)]);
      let started: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      await parentPage.route("**/api/learning-goals?*", async (route) => {
        started?.();
        await held;
        await route.fallback().catch(() => route.abort().catch(() => {}));
      });
      let downloads = 0;
      parentPage.on("download", () => {
        downloads++;
      });
      await plan(parentPage)
        .getByRole("button", { name: "Download text plan", exact: true })
        .click();
      await ready;
      if (permissionChange === "revoke")
        await callFixture("revokeFamily", { studentUid, parentUid });
      else await callFixture("disableStudent", student.email);
      const denied = parentPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/learning-goals" &&
          response.status() === (permissionChange === "revoke" ? 403 : 404),
      );
      release?.();
      await denied;
      await expect(plan(parentPage)).not.toBeVisible({ timeout: 3_000 });
      await expect(
        parentPage.getByText(goal.notes, { exact: true }),
      ).not.toBeVisible();
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
}

test("date ranges locate old booking history before paging and invalid edits keep the applied results", async ({
  page,
  browser,
}, testInfo) => {
  const student = await register(page);
  const operatorContext = await browser.newContext({
    baseURL: webOrigin,
    timezoneId: "America/Phoenix",
  });
  let releaseEarlierPage: (() => void) | undefined;
  try {
    await isolate(operatorContext);
    const operatorPage = await operatorContext.newPage();
    const operator = await register(operatorPage);
    await callFixture("promote", operator.email);
    const seed = (await callFixture("seedPagination", {
      studentEmail: student.email,
      operatorEmail: operator.email,
    })) as {
      pastCount: number;
      oldBookingStartsAt: string;
      oldBookingId: string;
    };
    expect(seed.pastCount).toBeGreaterThan(50);
    await page.bringToFront();
    await page.reload();
    await page
      .getByRole("navigation", { name: "Workspace sections", exact: true })
      .getByRole("button", { name: "Meetings", exact: true })
      .click();
    const history = page.locator(".meeting-history");
    const rows = history.locator(".meeting-history-list > li");
    await expect(rows).toHaveCount(50);
    await expect(
      history.locator(`time[datetime="${seed.oldBookingStartsAt}"]`),
    ).toHaveCount(0);
    let earlierPageStarted: (() => void) | undefined;
    let earlierPageEnded: (() => void) | undefined;
    const earlierPageHeld = new Promise<void>((resolve) => {
      releaseEarlierPage = resolve;
    });
    const earlierPageReady = new Promise<void>((resolve) => {
      earlierPageStarted = resolve;
    });
    const earlierPageDrained = new Promise<void>((resolve) => {
      earlierPageEnded = resolve;
    });
    await page.route("**/api/appointments?*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.searchParams.get("status") !== "ended" ||
        !url.searchParams.has("cursor") ||
        url.searchParams.has("from")
      ) {
        await route.fallback();
        return;
      }
      const response = await route.fetch({
        url: `${apiOrigin}${url.pathname}${url.search}`,
      });
      expect(response.status()).toBe(200);
      earlierPageStarted?.();
      await earlierPageHeld;
      try {
        await route.fulfill({ response });
      } catch {
        await route.abort().catch(() => {});
      } finally {
        earlierPageEnded?.();
      }
    });
    await history
      .getByRole("button", { name: "Load more bookings", exact: true })
      .click();
    await earlierPageReady;
    const day = await page.evaluate((instant) => {
      const value = new Date(instant);
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }, seed.oldBookingStartsAt);
    const rangeRequest = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/appointments" &&
        url.searchParams.has("from") &&
        url.searchParams.has("to") &&
        !url.searchParams.has("cursor") &&
        response.status() === 200
      );
    });
    await history.getByLabel("From date", { exact: true }).fill(day);
    await history.getByLabel("Through date", { exact: true }).fill(day);
    await history
      .getByRole("button", { name: "Apply dates", exact: true })
      .click();
    const response = await rangeRequest;
    const query = new URL(response.url()).searchParams;
    const expectedFrom = `${day}T07:00:00.000Z`;
    expect(query.get("from")).toBe(expectedFrom);
    expect(query.get("to")).toBe(
      new Date(Date.parse(expectedFrom) + 86_400_000).toISOString(),
    );
    expect(Date.parse(query.get("from")!)).toBeLessThanOrEqual(
      Date.parse(seed.oldBookingStartsAt),
    );
    expect(Date.parse(query.get("to")!)).toBeGreaterThan(
      Date.parse(seed.oldBookingStartsAt),
    );
    expect(Date.parse(query.get("to")!) - Date.parse(query.get("from")!)).toBe(
      86_400_000,
    );
    await expect(rows).toHaveCount(1);
    await expect(
      history.locator(`time[datetime="${seed.oldBookingStartsAt}"]`),
    ).toBeVisible();
    await expect(
      history.getByRole("button", { name: "Load more bookings", exact: true }),
    ).toHaveCount(0);
    releaseEarlierPage?.();
    await earlierPageDrained;
    await expect(rows).toHaveCount(1);
    await page.unroute("**/api/appointments?*");
    await page.setViewportSize({ width: 320, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("booking-history-range-320.png"),
      fullPage: true,
    });
    await history.getByLabel("From date", { exact: true }).fill("2030-06-11");
    await history
      .getByLabel("Through date", { exact: true })
      .fill("2030-06-10");
    await expect(history.locator(".meeting-date-range-applied")).toContainText(
      "Date changes are not applied yet.",
    );
    await history
      .getByRole("button", { name: "Apply dates", exact: true })
      .click();
    await expect(
      history.getByLabel("Through date", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await expect(
      history.getByLabel("Through date", { exact: true }),
    ).toBeFocused();
    await expect(rows).toHaveCount(1);
    await expect(
      history.locator(`time[datetime="${seed.oldBookingStartsAt}"]`),
    ).toBeVisible();
    await history
      .getByRole("button", { name: "Clear dates", exact: true })
      .click();
    await expect(history.getByLabel("From date", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      history.getByLabel("Through date", { exact: true }),
    ).toHaveValue("");
    await expect(rows).toHaveCount(50);
    await expect(
      history.locator(`time[datetime="${seed.oldBookingStartsAt}"]`),
    ).toHaveCount(0);
  } finally {
    releaseEarlierPage?.();
    await operatorContext.close();
  }
});

test("a fresh export cannot download a previous workspace after session confirmation conceals it", async ({
  page,
}) => {
  await register(page);
  const goal = await createGoal(page, {
    title: "A concealed private learning goal",
    notes: "Synthetic notes must not escape after session concealment.",
  });
  await page.reload();
  await choosePlan(page);
  await expect(goalRow(page, goal.title)).toContainText(goal.notes);
  await plan(page).getByText("Export plan", { exact: true }).click();
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  let ended: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const drained = new Promise<void>((resolve) => {
    ended = resolve;
  });
  await page.route("**/api/learning-goals", async (route) => {
    const response = await route.fetch({
      url: `${apiOrigin}/api/learning-goals`,
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
  let downloads = 0;
  page.on("download", () => {
    downloads++;
  });
  try {
    await plan(page)
      .getByRole("button", { name: "Download JSON plan", exact: true })
      .click();
    await ready;
    await page.route("**/api/session", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "UNAVAILABLE",
            message: "Synthetic session check interruption.",
          },
        }),
      }),
    );
    await page.evaluate(() => {
      const channel = new BroadcastChannel("tala-session-events-v1");
      channel.postMessage({ type: "session-changed" });
      channel.close();
    });
    await expect(
      page.getByRole("heading", {
        name: "Confirm your session to continue",
        exact: true,
      }),
    ).toBeVisible();
    await expect(plan(page)).not.toBeVisible();
    await expect(page.getByText(goal.notes, { exact: true })).not.toBeVisible();
    release?.();
    await drained;
    expect(downloads).toBe(0);
  } finally {
    release?.();
  }
});
