import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webOrigin = "http://127.0.0.1:5188";
const apiOrigin = "http://127.0.0.1:8798";
const unexpectedHosts: string[] = [];
const runtimeErrors: string[] = [];
let directory = "";
let closeServer: (() => Promise<void>) | undefined;
let callFixture: (action: string, input: unknown) => Promise<unknown>;

type Account = { name: string; email: string; password: string };
type Seed = {
  oldBookingId: string;
  oldLearningId: string;
  oldLearningSummary: string;
  unreviewedEvidenceId: string;
  unreviewedTitle: string;
  activeBookingId: string;
};
type Goal = { id: string; ownerUid: string; title: string; version: number; linkedEvidenceCount: number; steps: { id: string; title: string; completed: boolean }[] };

async function isolate(context: BrowserContext) {
  const recordError = (page: Page) => page.on("pageerror", () => runtimeErrors.push("Unhandled learning workflow runtime error"));
  context.pages().forEach(recordError); context.on("page", recordError);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === webOrigin && url.pathname.startsWith("/api/")) {
      try { await route.fulfill({ response: await route.fetch({ url: `${apiOrigin}${url.pathname}${url.search}` }) }); }
      catch { await route.abort("connectionfailed").catch(() => {}); }
      return;
    }
    if (url.origin === webOrigin || ["blob:", "data:"].includes(url.protocol)) return route.continue();
    unexpectedHosts.push(url.host); await route.abort("blockedbyclient");
  });
}
async function startFixture() {
  directory = await mkdtemp(join(tmpdir(), "tala-product-browser-"));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../../server/test/product-browser-server.cjs", import.meta.url))], {
    env: { ...process.env, NODE_ENV: "test", NODE_OPTIONS: "", TALA_BROWSER_TEST_DATA_DIR: directory, TALA_BROWSER_TEST_API_PORT: "8798", TALA_BROWSER_TEST_WEB_PORT: "5188" },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  callFixture = (action, input) => new Promise((resolve, reject) => {
    if (!child.connected) return reject(new Error("The isolated synthetic fixture is unavailable."));
    const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(new Error("The synthetic fixture timed out.")); }, 10_000);
    pending.set(id, { resolve, reject, timer }); child.send({ id, action, input });
  });
  child.once("exit", () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("The isolated fixture exited.")); } pending.clear(); });
  closeServer = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); }); child.kill("SIGTERM");
    });
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The isolated workflow server did not start.")), 10_000);
    child.on("message", (message: { ready?: boolean; id?: string; result?: unknown; error?: string }) => {
      if (message.ready) { clearTimeout(timer); resolve(); }
      if (!message.id) return;
      const item = pending.get(message.id); if (!item) return;
      clearTimeout(item.timer); pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result);
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("The isolated workflow server exited.")); });
  });
}

test.beforeEach(async ({ context }) => {
  unexpectedHosts.length = runtimeErrors.length = 0; closeServer = undefined; directory = "";
  await isolate(context); await startFixture();
});
test.afterEach(async ({ context }) => {
  for (const page of context.pages()) await page.close();
  try { await closeServer?.(); } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  expect(runtimeErrors).toEqual([]);
  expect([...new Set(unexpectedHosts)], "This suite may contact only its temporary local real backend").toEqual([]);
});

async function register(page: Page, role: "student" | "parent" = "student"): Promise<Account> {
  const suffix = randomUUID(), account = { name: `Synthetic workflow ${role}`, email: `${suffix}@example.test`, password: `Synthetic-only-${suffix}` };
  await page.goto("/#/register");
  await page.getByLabel("Name", { exact: true }).fill(account.name);
  await page.getByLabel("Account type", { exact: true }).selectOption(role);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByLabel("Confirm password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Hello, ${account.name}.`, exact: true })).toBeVisible();
  return account;
}
async function seedSavedWork(page: Page, browser: Browser, student: Account): Promise<Seed> {
  const staffContext = await browser.newContext({ baseURL: webOrigin, timezoneId: "America/Phoenix" });
  try {
    await isolate(staffContext); const staffPage = await staffContext.newPage(); const staff = await register(staffPage);
    await callFixture("promote", staff.email);
    const seed = await callFixture("seedPagination", { studentEmail: student.email, operatorEmail: staff.email }) as Seed;
    await page.bringToFront(); await page.reload();
    await expect(page.getByRole("heading", { name: `Hello, ${student.name}.`, exact: true })).toBeVisible();
    return seed;
  } finally { await staffContext.close(); }
}
async function choose(page: Page, label: string) {
  const button = page.getByRole("navigation", { name: "Workspace sections", exact: true }).getByRole("button", { name: label, exact: true });
  await button.click(); await expect(button).toHaveAttribute("aria-current", "page");
}
function goalRow(page: Page, title: string): Locator {
  return page.getByRole("list", { name: "Saved learning goals", exact: true }).locator(":scope > li").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}
async function createGoal(page: Page, title: string, steps = true) {
  await choose(page, "Learning plan");
  await page.getByRole("button", { name: "Add goal", exact: true }).click();
  await page.getByLabel("Goal", { exact: true }).fill(title);
  await page.getByLabel("Notes (optional)", { exact: true }).fill("A synthetic intention for learning, without private student records.");
  await page.getByLabel("Target date (optional)", { exact: true }).fill("2027-05-21");
  if (steps) {
    await page.getByRole("button", { name: "Add step", exact: true }).click(); await page.getByLabel("Step 1", { exact: true }).fill("Read one observation");
    await page.getByRole("button", { name: "Add step", exact: true }).click(); await page.getByLabel("Step 2", { exact: true }).fill("Write one clear question");
    await page.getByRole("checkbox", { name: "Step 2 completed", exact: true }).check();
  }
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(goalRow(page, title)).toHaveCount(1);
}
async function openEvidencePicker(page: Page, title: string, evidenceTitle: string) {
  await goalRow(page, title).getByRole("button", { name: /^Evidence for / }).click();
  const panel = page.locator(".goal-evidence");
  await panel.getByRole("button", { name: "Link saved evidence", exact: true }).click();
  await panel.getByLabel("Search saved evidence", { exact: true }).fill(evidenceTitle);
  await panel.getByRole("radio", { name: `${evidenceTitle}, version 1`, exact: true }).check();
  return panel;
}
async function readJson<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (url) => { const response = await fetch(url, { cache: "no-store", credentials: "same-origin" }); if (!response.ok) throw new Error("Synthetic verification read failed"); return response.json(); }, path) as Promise<T>;
}
async function preparation(page: Page) {
  await choose(page, "Meetings");
  const panel = page.locator("details.meeting-preparation");
  await panel.locator("summary").click();
  await expect(panel.getByLabel("Learning notes (optional)", { exact: true })).toBeVisible();
  return panel;
}

// One compact mobile pass exercises actual persisted rows rather than another
// device matrix. No screenshots or recordings are generated by this suite.
test("checklist steps and real saved Evidence links survive refresh and inform truthful mobile progress", async ({ page, browser }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const account = await register(page), seed = await seedSavedWork(page, browser, account);
  const title = "Explain one observation using saved work";
  await createGoal(page, title);
  await expect(goalRow(page, title)).toContainText("1 of 2 steps completed");
  // This saved control intentionally updates only after its server receipt;
  // await the confirmed state rather than check()'s immediate local toggle.
  const savedStep = goalRow(page, title).getByRole("checkbox", { name: "Complete step “Read one observation”", exact: true });
  await savedStep.click();
  await expect(goalRow(page, title).getByRole("checkbox", { name: "Reopen step “Read one observation”", exact: true })).toBeChecked();
  await expect(goalRow(page, title)).toContainText("2 of 2 steps completed");
  const panel = await openEvidencePicker(page, title, seed.unreviewedTitle);
  await panel.getByRole("button", { name: "Link evidence", exact: true }).click();
  await expect(panel.getByRole("list", { name: "Linked evidence", exact: true })).toContainText(seed.unreviewedTitle);
  await page.reload();
  await expect(goalRow(page, title)).toContainText("2 of 2 steps completed");
  await goalRow(page, title).getByRole("button", { name: /^Evidence for / }).click();
  await expect(page.getByRole("list", { name: "Linked evidence", exact: true })).toContainText(seed.unreviewedTitle);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze(); expect(accessibility.violations).toEqual([]);
  await choose(page, "Progress");
  await expect(page.getByRole("progressbar", { name: "Personal learning steps completed", exact: true })).toHaveAttribute("value", "2");
  await expect(page.getByRole("progressbar", { name: "Personal learning goals completed", exact: true })).toHaveAttribute("value", "0");
  const links = page.locator(".student-progress-work dl > div").filter({ has: page.getByText("Connections to goals", { exact: true }) }); await expect(links.locator("dd")).toHaveText("1");
  await expect(page.getByText(/Attendance, academic mastery, AI assessment and official course credit are not verified/)).toBeVisible();
});

test("an interrupted Evidence link retries one committed operation and unlinking preserves the original saved file", async ({ page, browser }) => {
  const account = await register(page), seed = await seedSavedWork(page, browser, account), title = "Connect a saved reflection";
  await createGoal(page, title, false);
  const panel = await openEvidencePicker(page, title, seed.unreviewedTitle);
  let attempts = 0, release: (() => void) | undefined, started: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { started = resolve; }); const held = new Promise<void>((resolve) => { release = resolve; }); const requests: string[] = [];
  await page.route("**/api/learning-goals/*/evidence", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { requestId: string }; requests.push(body.requestId); attempts++;
    if (attempts === 1) { started?.(); await held; const saved = await route.fetch({ url: `${apiOrigin}${new URL(route.request().url()).pathname}` }); expect(saved.ok()).toBe(true); await route.abort("connectionfailed"); }
    else await route.fallback();
  });
  try {
    await panel.getByRole("button", { name: "Link evidence", exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await ready; expect(attempts).toBe(1); await expect(panel.getByRole("button", { name: "Link evidence", exact: true })).toBeDisabled(); release?.();
    await expect(panel.getByRole("button", { name: "Retry link", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Retry link", exact: true }).click();
    await expect(panel.getByRole("list", { name: "Linked evidence", exact: true }).locator(":scope > li")).toHaveCount(1);
    expect(attempts).toBe(2); expect(new Set(requests).size).toBe(1);
    const goals = await readJson<{ goals: Goal[] }>(page, "/api/learning-goals"); expect(goals.goals[0]?.version).toBe(2); expect(goals.goals[0]?.linkedEvidenceCount).toBe(1);
    await panel.getByRole("button", { name: `Unlink “${seed.unreviewedTitle}”`, exact: true }).click();
    await expect(panel.getByText("No evidence is linked to this goal yet.", { exact: true })).toBeVisible();
    const body = await page.evaluate(async (id) => { const response = await fetch(`/api/evidence/${id}/content`, { cache: "no-store", credentials: "same-origin" }); if (!response.ok) throw new Error("Synthetic saved file is unavailable"); return response.text(); }, seed.unreviewedEvidenceId);
    expect(body).toBe("Synthetic pagination reflection. No real learner or payment data.");
    await page.goto(`/#/dashboard?view=evidence&document=${seed.unreviewedEvidenceId}`);
    const history = page.getByRole("dialog", { name: "Document history", exact: true }); await expect(history).toBeVisible(); await expect(history.getByRole("heading", { name: seed.unreviewedTitle, exact: true })).toBeVisible();
    await history.getByRole("button", { name: "Close history", exact: true }).click();
  } finally { release?.(); }
});

test("meeting preparation persists on its original reservation and a real reschedule starts with a blank replacement", async ({ page, browser }) => {
  const account = await register(page), seed = await seedSavedWork(page, browser, account), title = "Prepare one question for advising";
  await createGoal(page, title, false);
  let panel = await preparation(page); const note = "A synthetic question to explore at the next meeting.\nOne small learning objective.";
  await panel.getByLabel("Learning notes (optional)", { exact: true }).fill(note);
  await panel.getByLabel("Related goal (optional)", { exact: true }).selectOption({ label: title });
  await panel.getByRole("checkbox", { name: "My learning materials are ready", exact: true }).check();
  await panel.getByRole("button", { name: "Save preparation", exact: true }).click();
  await expect(panel.getByText("Your meeting preparation was saved.", { exact: true })).toBeVisible();
  const saved = await readJson<{ version: number; note: string; ready: boolean; goalId: string | null }>(page, `/api/appointments/${seed.activeBookingId}/preparation`);
  expect(saved.version).toBe(1); expect(saved.note).toBe(note); expect(saved.ready).toBe(true); expect(saved.goalId).not.toBeNull();
  await page.reload(); panel = await preparation(page);
  await expect(panel.getByLabel("Learning notes (optional)", { exact: true })).toHaveValue(note);
  await expect(panel.getByRole("checkbox", { name: "My learning materials are ready", exact: true })).toBeChecked();
  const times = page.getByLabel("Available meeting time", { exact: true });
  await expect(times).toBeEnabled();
  const replacementId = await times.locator('option[value]:not([value=""])').first().getAttribute("value"); expect(replacementId).not.toBeNull();
  await times.selectOption(replacementId!);
  await page.getByRole("button", { name: "Change booking", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Change this booking?", exact: true });
  await expect(confirmation).toBeVisible(); await confirmation.getByRole("button", { name: "Confirm change", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByText("Your booking was changed on the server.", { exact: true })).toBeVisible();
  const workspace = await readJson<{ activeAppointments: { id: string }[] }>(page, "/api/workspace");
  expect(workspace.activeAppointments[0]?.id).not.toBe(seed.activeBookingId);
  const nextId = workspace.activeAppointments[0]!.id;
  const next = await readJson<{ version: number; note: string; goalId: string | null; ready: boolean }>(page, `/api/appointments/${nextId}/preparation`);
  expect(next).toMatchObject({ version: 0, note: "", goalId: null, ready: false });
  const prior = await readJson<{ version: number; note: string; ready: boolean }>(page, `/api/appointments/${seed.activeBookingId}/preparation`);
  expect(prior).toMatchObject({ version: 1, note, ready: true });
  await page.goto(`/#/dashboard?view=meetings&booking=${seed.activeBookingId}`);
  const details = page.getByRole("dialog", { name: "Meeting details", exact: true });
  await expect(details).toBeVisible(); await expect(details.getByText("Reservation cancelled", { exact: true })).toBeVisible();
  await expect(details.getByText(note, { exact: true })).toBeVisible();
  await details.getByRole("button", { name: "Close details", exact: true }).click();
});

test("progress links and direct details reach older saved records without relying on the first page", async ({ page, browser }) => {
  const account = await register(page), seed = await seedSavedWork(page, browser, account), title = "Trace my next investigation";
  await createGoal(page, title, false); await choose(page, "Progress");
  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click(); await expect(page.getByRole("heading", { name: title, exact: true })).toBeFocused();
  await choose(page, "Learning records");
  await expect(page.getByText(seed.oldLearningSummary, { exact: true })).not.toBeVisible();
  const search = page.getByLabel("Search learning records", { exact: true });
  await search.fill(seed.oldLearningSummary);
  await expect(page.getByText(seed.oldLearningSummary, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByText(seed.oldLearningSummary, { exact: true })).not.toBeVisible();
  await page.goto(`/#/dashboard?view=learning&record=${seed.oldLearningId}&from=updates`);
  const learning = page.getByRole("dialog", { name: "Learning summary", exact: true }); await expect(learning).toBeVisible(); await expect(learning.getByText(seed.oldLearningSummary, { exact: true })).toBeVisible();
  await learning.getByRole("button", { name: "I have reviewed this summary", exact: true }).click(); await expect(learning.getByText("Reviewed by student", { exact: true })).toBeVisible();
  await learning.getByRole("button", { name: "Close details", exact: true }).click(); await choose(page, "Progress");
  await expect(page.getByText("1 learning note marked as reviewed.", { exact: true })).toBeVisible();
  await page.goto(`/#/dashboard?view=meetings&booking=${seed.oldBookingId}`);
  const meeting = page.getByRole("dialog", { name: "Meeting details", exact: true }); await expect(meeting).toBeVisible(); await expect(meeting.getByText("Reservation period ended", { exact: true })).toBeVisible(); await expect(meeting.getByText("No preparation saved for this reservation.", { exact: true })).toBeVisible();
  await meeting.getByRole("button", { name: "Close details", exact: true }).click();
  await page.reload(); await choose(page, "Progress"); await expect(page.getByText("1 learning note marked as reviewed.", { exact: true })).toBeVisible();
});

test("a linked parent can read goals, Evidence and preparation while revocation immediately conceals cached private content", async ({ page, browser }) => {
  const account = await register(page), seed = await seedSavedWork(page, browser, account), title = "A student-owned synthetic goal";
  await createGoal(page, title); const links = await openEvidencePicker(page, title, seed.unreviewedTitle); await links.getByRole("button", { name: "Link evidence", exact: true }).click(); await expect(links.getByRole("list", { name: "Linked evidence", exact: true })).toContainText(seed.unreviewedTitle);
  const prep = await preparation(page), note = "Synthetic private preparation visible only during authorized family access.";
  await prep.getByLabel("Learning notes (optional)", { exact: true }).fill(note); await prep.getByRole("button", { name: "Save preparation", exact: true }).click(); await expect(prep.getByText("Your meeting preparation was saved.", { exact: true })).toBeVisible();
  const parentContext = await browser.newContext({ baseURL: webOrigin, timezoneId: "America/Phoenix" });
  try {
    await isolate(parentContext); const parentPage = await parentContext.newPage(), parent = await register(parentPage, "parent");
    const studentUid = await callFixture("findUid", account.email), parentUid = await callFixture("findUid", parent.email);
    await callFixture("linkFamily", { studentUid, parentUid, consentReference: "Synthetic isolated workflow read-only consent." });
    await parentPage.reload(); await choose(parentPage, "Learning plan"); await expect(goalRow(parentPage, title)).toHaveCount(1);
    await expect(goalRow(parentPage, title).getByRole("checkbox")).toHaveCount(0); await expect(parentPage.getByRole("button", { name: "Add goal", exact: true })).toHaveCount(0);
    await goalRow(parentPage, title).getByRole("button", { name: /^Evidence for / }).click();
    await expect(parentPage.getByRole("list", { name: "Linked evidence", exact: true })).toContainText(seed.unreviewedTitle);
    await expect(parentPage.getByRole("button", { name: "Link saved evidence", exact: true })).toHaveCount(0); await expect(parentPage.getByRole("button", { name: /^Unlink / })).toHaveCount(0);
    await choose(parentPage, "Meetings"); const parentPrep = parentPage.locator("details.meeting-preparation"); await parentPrep.locator("summary").click(); await expect(parentPrep.getByText(note, { exact: true })).toBeVisible(); await expect(parentPrep.getByRole("button", { name: "Save preparation", exact: true })).toHaveCount(0);
    await choose(parentPage, "Learning plan");
    const evidencePanel = parentPage.locator(".goal-evidence");
    if (!await evidencePanel.isVisible()) await goalRow(parentPage, title).getByRole("button", { name: /^Evidence for / }).click();
    await expect(evidencePanel.getByRole("list", { name: "Linked evidence", exact: true })).toContainText(seed.unreviewedTitle);
    await expect(evidencePanel.getByRole("button", { name: "Refresh links", exact: true })).toBeEnabled();
    await callFixture("revokeFamily", { studentUid, parentUid });
    await evidencePanel.getByRole("button", { name: "Refresh links", exact: true }).click();
    await expect(parentPage.locator("#plan-heading")).not.toBeVisible(); await expect(parentPage.getByRole("heading", { name: title, exact: true })).not.toBeVisible(); await expect(parentPage.getByText(note, { exact: true })).not.toBeVisible();
    await expect(parentPage.getByRole("list", { name: "Linked evidence", exact: true })).not.toBeVisible();
  } finally { await parentContext.close(); }
});
