import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { completeDemoVerification, registerDemoFamily } from "./signupHelpers";

// Enrollment can contain temporary authenticator material. Never record it.
test.use({ trace: "off", screenshot: "off", video: "off" });

async function assertFits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

async function loginSample(page: Page, role = "Student") {
  await page.goto("/#/login");
  await page.getByLabel("I am a").selectOption(role);
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await expect(page).toHaveURL(/dashboard/);
}

test("the real homepage makes programs and the product preview discoverable", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Room to learn. Space to grow.");
  await expect(
    page.getByRole("link", { name: "Start registration", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("Student hub");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Programs", exact: true })
    .click();
  await expect(page.locator(".program-detail")).toHaveCount(4);
  await assertFits(page);
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Find a way to learn.");
});

test("login shares one pending lock across forms, sample profiles and roles", async ({
  page,
}) => {
  await page.goto("/#/login");
  await page.getByLabel("Email address").fill("sample@example.com");
  await page.getByLabel("Demo password", { exact: true }).fill("made-up-only");
  await page
    .getByRole("button", { name: "Log in to demo", exact: true })
    .click();
  await expect(page.getByLabel("I am a")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Explore with a sample profile" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Email address")).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(page).toHaveURL(/dashboard/);
  const session = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("tala.frontend-demo.session") ?? "null"),
  );
  expect(session).toMatchObject({
    email: "sample@example.com",
    role: "Student",
  });
  expect(JSON.stringify(session)).not.toContain("made-up-only");
});

test("leaving pending sign-in does not create a session or navigate back", async ({
  page,
}) => {
  await page.goto("/#/login");
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .dispatchEvent("click");
  await expect(
    page.getByRole("button", { name: "Opening demo…" }),
  ).toBeDisabled();
  await page
    .getByRole("link", { name: "TALA home", exact: true })
    .first()
    .dispatchEvent("click");
  await expect(page.locator("h1")).toHaveText("Room to learn. Space to grow.");
  await page.clock.runFor(1200);
  await expect(page.locator("h1")).toHaveText("Room to learn. Space to grow.");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("tala.frontend-demo.session"),
    ),
  ).toBeNull();
  await page.clock.resume();
  await page.goto("/#/dashboard");
  await expect(page).toHaveURL(/login/);
});

test("registration choices reach the family workspace and approval leads to safe card checkout", async ({
  page,
}) => {
  test.setTimeout(60000);
  await registerDemoFamily(page);
  await completeDemoVerification(page);
  await expect(
    page.getByRole("link", { name: "Check enrollment status", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Continue to parent workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Parent workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Jordan Learner");
  for (const choice of ["Hybrid", "8–10 AM", "ESA"]) {
    await expect(page.getByRole("main")).toContainText(choice);
  }
  await assertFits(page);
  await page.goto("/#/enrollment-status");
  await page.getByLabel("Demo application status").selectOption("approved");
  await page.getByRole("link", { name: "Continue to payment" }).click();
  await page
    .getByLabel("Funding method", { exact: true })
    .selectOption("Private");
  await page.getByRole("button", { name: "Add demo payment method" }).click();
  const dialog = page.getByRole("dialog", { name: "Add demo payment method" });
  await expect(dialog.locator("[data-demo-field='card-number']")).toContainText(
    "4242 4242 4242 4242",
  );
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Save demo payment method" }).click();
  await page
    .getByLabel("I understand this is a demo and no money will be paid.")
    .check();
  await page.getByRole("button", { name: "Pay with demo card" }).click();
  await expect(
    page.getByRole("heading", { name: "Demo card payment complete" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("$0 · Demo only");
  await assertFits(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Approval required" }),
  ).toBeVisible();
});

test("navigation cancels a pending class join, and the same class can be retried", async ({
  page,
}) => {
  await loginSample(page);
  await page.goto("/#/dashboard?view=slots");
  await expect(page.locator(".schedule-list li")).toHaveCount(4);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const join = page.getByRole("button", { name: "Join Everyday science lab" });
  await join.dispatchEvent("click");
  await expect(join).toBeDisabled();
  await page
    .getByRole("link", { name: "TALA home", exact: true })
    .first()
    .dispatchEvent("click");
  await expect(page.locator("h1")).toHaveText("Room to learn. Space to grow.");
  await page.clock.runFor(1200);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("tala.demo.classes.alex@example.com"),
    ),
  ).toBeNull();
  await page.clock.resume();
  await page.goto("/#/dashboard?view=slots");
  await expect(page.locator(".schedule-list li")).toHaveCount(4);
  await page.getByRole("button", { name: "Join Everyday science lab" }).click();
  await expect(
    page.getByRole("button", { name: "Everyday science lab added" }),
  ).toBeDisabled();
  const joined = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem("tala.demo.classes.alex@example.com") ?? "[]",
    ),
  );
  expect(joined).toHaveLength(1);
});

test("family workspaces remain accessible and fit at 320px with enlarged text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const role of ["Parent", "Alumni", "Staff"]) {
    await loginSample(page, role);
    await expect(
      page.getByRole("heading", { name: `${role} workspace` }),
    ).toBeVisible();
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.map((issue) => ({
        id: issue.id,
        targets: issue.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    await assertFits(page);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.reload();
  }
});
