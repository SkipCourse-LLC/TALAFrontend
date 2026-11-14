// SCRUM-89 end to end: student, parent, alumni and staff sign in through the real
// login form against the real local server, each lands on its own dashboard,
// cannot reach another role's pages by URL or API, and signs out for good.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startIsolatedServer } from "./browserHarness";
import type { IsolatedServer, SyntheticAccount } from "./browserHarness";
import { ROLE_TEST_API_PORT, ROLE_TEST_WEB_PORT } from "./roleSignIn.ports";

let server: IsolatedServer;
let dataDir = "";

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "tala-product-browser-roles-"));
  server = await startIsolatedServer({ dataDir, apiPort: ROLE_TEST_API_PORT, webPort: ROLE_TEST_WEB_PORT });
});
test.afterAll(async () => {
  await server?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

async function signIn(page: Page, account: SyntheticAccount) {
  await page.goto("/#/login");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/#\/dashboard/);
}
async function sessionRole(page: Page) {
  const response = await page.request.get("/api/session");
  return ((await response.json()) as { session: { role: string } | null }).session?.role ?? null;
}
async function signOutAndConfirm(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/#\/login$/);
  expect(await sessionRole(page)).toBeNull();
  await page.goto("/#/dashboard");
  await expect(page).toHaveURL(/#\/login$/);
}

test("T4-5 T4-8 each of the four roles signs in to its own dashboard and signs out for good", async ({ page }) => {
  const student = await server.provisionAccount("student", "Synthetic Role Student");
  const parent = await server.provisionAccount("parent", "Synthetic Role Parent");
  const alumni = await server.provisionAccount("alumni", "Synthetic Role Alumni");
  const staff = await server.provisionAccount("staff", "Synthetic Role Staff");

  await signIn(page, student);
  await expect(page.getByRole("heading", { name: `Hello, ${student.name}.`, exact: true })).toBeVisible();
  expect(await sessionRole(page)).toBe("student");
  await signOutAndConfirm(page);

  await signIn(page, parent);
  await expect(page.getByRole("heading", { name: `Hello, ${parent.name}.`, exact: true })).toBeVisible();
  expect(await sessionRole(page)).toBe("parent");
  await signOutAndConfirm(page);

  await signIn(page, alumni);
  await expect(page.getByRole("heading", { name: `Hello, ${alumni.name}.`, exact: true })).toBeVisible();
  await expect(page.getByText("with an alumni account")).toBeVisible();
  expect(await sessionRole(page)).toBe("alumni");
  await signOutAndConfirm(page);

  await signIn(page, staff);
  await expect(page.getByRole("heading", { name: "Learning operations", exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Operations workspace" })
      .getByRole("button", { name: "Contact requests" }),
  ).toBeVisible();
  expect(await sessionRole(page)).toBe("operator");
  await signOutAndConfirm(page);
});

test("T4-6 a role cannot reach another role's pages by direct URL or API call", async ({ page }) => {
  const student = await server.provisionAccount("student", "Synthetic URL Student");
  const alumni = await server.provisionAccount("alumni", "Synthetic URL Alumni");

  await page.goto("/#/dashboard");
  await expect(page).toHaveURL(/#\/login$/);

  await signIn(page, student);
  await page.goto("/#/payment");
  await expect(page).toHaveURL(/#\/dashboard/);
  await page.goto("/#/dashboard?panel=requests");
  await expect(page.getByRole("heading", { name: `Hello, ${student.name}.`, exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Operations workspace" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Contact requests" })).toHaveCount(0);
  for (const path of ["/api/operations/contact-requests", "/api/operator/admissions", "/api/operator/payments"])
    expect((await page.request.get(path)).status(), path).toBe(403);
  await signOutAndConfirm(page);

  await signIn(page, alumni);
  await page.goto("/#/payment");
  await expect(page).toHaveURL(/#\/dashboard/);
  // An alumni account has its own empty workspace, but no student's records.
  expect((await page.request.get(`/api/workspace?studentUid=${student.uid}`)).status()).toBe(403);
  expect((await page.request.get("/api/operations/contact-requests")).status()).toBe(403);
  await signOutAndConfirm(page);
});

test("T4-7 a parent views a linked student read-only, stays recorded as the parent, and cannot open an unlinked student", async ({ page }) => {
  const parent = await server.provisionAccount("parent", "Synthetic Linked Parent");
  const linked = await server.provisionAccount("student", "Synthetic Linked Learner");
  const unlinked = await server.provisionAccount("student", "Synthetic Unlinked Learner");
  await server.linkFamily(linked.uid, parent.uid);

  await signIn(page, parent);
  await expect(page.getByText(`Viewing as ${linked.name}`)).toBeVisible();
  await expect(page.getByText("Read-only student records").first()).toBeVisible();
  const picker = page.getByLabel("Student workspace");
  if (await picker.count()) {
    await expect(picker.locator("option", { hasText: unlinked.name })).toHaveCount(0);
  }
  expect(await sessionRole(page)).toBe("parent");
  expect((await page.request.get(`/api/workspace?studentUid=${linked.uid}`)).status()).toBe(200);
  expect((await page.request.get(`/api/workspace?studentUid=${unlinked.uid}`)).status()).toBe(403);
  await signOutAndConfirm(page);
});
