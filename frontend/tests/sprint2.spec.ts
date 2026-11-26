import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  completeDemoVerification,
  registerDemoFamily,
  readAuthenticator,
  invalidCode,
} from "./signupHelpers";

const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  failures.set(page, errors);
  page.on("pageerror", () => errors.push("Page error"));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("Console error");
  });
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173"))
      errors.push("Unexpected external request");
  });
});
test.afterEach(async ({ page }) => {
  expect(failures.get(page)).toEqual([]);
});
async function checkPage(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  for (const select of await page.locator(".payment-page select").all()) {
    expect((await select.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.map(({ id, impact }) => ({ id, impact })),
  ).toEqual([]);
}
async function route(page: Page, path: string) {
  await page.evaluate((next) => {
    window.location.hash = next;
  }, path);
}
async function openApproval(page: Page) {
  await page.goto("/#/login");
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await page.getByRole("link", { name: "Enrollment status & payment" }).click();
  await expect(
    page.getByRole("heading", { name: "Pending review" }),
  ).toBeVisible();
}
async function openApprovedPayment(page: Page) {
  await page.getByLabel("Demo application status").selectOption("approved");
  await page.getByRole("link", { name: "Continue to payment" }).click();
  await expect(page.getByLabel("Funding method")).toBeVisible();
}

test("SCRUM-46/47: setup, empty and invalid codes, retry, back and verified parent session", async ({
  page,
}, testInfo) => {
  await registerDemoFamily(page);
  const authenticator = await readAuthenticator(page);
  await checkPage(page);
  await page.screenshot({
    path: testInfo.outputPath("two-factor-setup.png"),
    mask: [page.locator(".two-factor-provisioning")],
    fullPage: true,
  });
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("tala.frontend-demo.session"),
    ),
  ).toBeNull();
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await expect(
    page.getByRole("button", { name: "Preparing setup…" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("six-digit");
  await page.getByLabel("Verification code").fill("abcdef");
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("six-digit");
  await page.getByLabel("Verification code").fill(invalidCode(authenticator));
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page.getByRole("button", { name: "Verifying…" })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("does not match");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("tala.frontend-demo.session"),
    ),
  ).toBeNull();
  await checkPage(page);
  await page.screenshot({
    path: testInfo.outputPath("verification-error.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back to setup" }).click();
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await expect(page.getByLabel("Verification code")).toHaveValue("");
  await page.getByLabel("Verification code").fill(authenticator.generate());
  await page.getByText("Demo testing options", { exact: true }).click();
  await page.getByLabel("Simulate 2FA service error").check();
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await page.getByLabel("Simulate 2FA service error").uncheck();
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Verification successful",
  );
  await page
    .getByRole("link", { name: "Continue to parent workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Parent workspace" }),
  ).toBeVisible();
  await expect(page.getByText("Welcome, Taylor Parent.")).toBeVisible();
  await page.goBack();
  await expect(
    page.getByText("Verification successful", { exact: false }),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(/practice-only|246810|challenge|password/.test(storage)).toBe(false);
  await checkPage(page);
});

test("SCRUM-46: setup service failure, gated routes and cancel", async ({
  page,
}) => {
  await registerDemoFamily(page);
  for (const path of [
    "/dashboard",
    "/login",
    "/payment",
    "/enrollment-status",
  ]) {
    await route(page, path);
    await expect(page).toHaveURL(/two-factor/);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("tala.frontend-demo.session"),
      ),
    ).toBeNull();
  }
  await page.getByText("Demo testing options", { exact: true }).click();
  await page.getByLabel("Simulate 2FA service error").check();
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not start");
  await page.getByLabel("Simulate 2FA service error").uncheck();
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  await page.getByRole("button", { name: "Cancel signup demo" }).click();
  await expect(page).toHaveURL(/login/);
  await route(page, "/two-factor");
  await expect(
    page.getByRole("heading", { name: "Start with registration" }),
  ).toBeVisible();
});

test("SCRUM-47: refresh and interrupted setup never authenticate", async ({
  page,
}) => {
  await page.goto("/#/two-factor");
  await expect(
    page.getByRole("heading", { name: "Start with registration" }),
  ).toBeVisible();
  await registerDemoFamily(page);
  let authenticator = await readAuthenticator(page);
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await page.getByLabel("Verification code").fill(authenticator.generate());
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Start with registration" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("tala.frontend-demo.session"),
    ),
  ).toBeNull();
  await registerDemoFamily(page);
  authenticator = await readAuthenticator(page);
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await page.getByLabel("Verification code").fill(authenticator.generate());
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await route(page, "/events");
  await expect(page).toHaveURL(/events/);
  await route(page, "/two-factor");
  await expect(
    page.getByRole("heading", { name: "Set up two-factor authentication" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("tala.frontend-demo.session"),
    ),
  ).toBeNull();
});

test("SCRUM-48/49: signup to approval to payment, validation and failure recovery", async ({
  page,
}, testInfo) => {
  await registerDemoFamily(page);
  await completeDemoVerification(page);
  await page
    .getByRole("link", { name: "Continue to parent workspace" })
    .click();
  await page.getByRole("link", { name: "Enrollment status & payment" }).click();
  await expect(
    page.getByRole("heading", { name: "Pending review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue to payment" }),
  ).toHaveCount(0);
  await checkPage(page);
  await openApprovedPayment(page);
  await checkPage(page);
  await expect(
    page.getByText("Approved to continue", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Enrollment payment progress" }),
  ).toContainText("ApplicationApprovalFunding");
  await expect(page.getByText("taylor@example.com")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("payment.png"),
    fullPage: true,
  });
  await expect(
    page.locator('input:not([type="checkbox"]), iframe'),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Complete payment demo", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add demo payment method", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("alert")).toContainText(
    "Choose a demo payment method",
  );
  await expect(page.getByLabel("Funding method")).toHaveValue("Private");
  await expect(
    page.getByRole("heading", { name: "Pay with card", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".payment-method-inline-preview")
      .getByRole("heading", { name: "Credit card details", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add demo payment method", exact: true })
    .click();
  const methodDialog = page.getByRole("dialog", {
    name: "Add demo payment method",
    exact: true,
  });
  await methodDialog
    .getByRole("radio", { name: "Demo card ending in 4242", exact: true })
    .check();
  await methodDialog
    .getByRole("button", { name: "Save demo payment method", exact: true })
    .click();
  await expect(methodDialog).toHaveCount(0);
  await expect(page.locator(".payment-method-saved")).toContainText("4242");
  await expect(
    page.getByRole("form", { name: "Payment demo", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Demo card payment complete",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Pay with demo card", exact: true })
    .click();
  await expect(page.getByLabel("I understand this is a demo")).toBeFocused();
  await checkPage(page);
  await page.getByLabel("I understand this is a demo").check();
  await page.getByText("Demo testing options", { exact: true }).click();
  await page.getByLabel("Simulate payment error").check();
  await page
    .getByRole("button", { name: "Pay with demo card", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Completing payment demo…" }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("No payment was made");
  await expect(page.getByLabel("Funding method")).toHaveValue("Private");
  await expect(page.locator(".payment-method-saved")).toContainText("4242");
  await page.getByLabel("Simulate payment error").uncheck();
  await page
    .getByRole("button", { name: "Pay with demo card", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Demo card payment complete",
      exact: true,
    }),
  ).toBeFocused();
  await expect(page.locator(".payment-success")).toContainText("4242");
  await expect(page.locator(".payment-success")).toContainText(
    "$0 · Demo only",
  );
  await expect(
    page.getByText("No money was paid", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pay with demo card", exact: true }),
  ).toHaveCount(0);
  await checkPage(page);
  await page.getByRole("link", { name: "Back to enrollment status" }).click();
  await page.getByRole("link", { name: "Continue to payment" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Demo card payment complete",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".payment-success")).toContainText("4242");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Approval required", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Demo card payment complete",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Parent workspace" }),
  ).toBeVisible();
});

test("SCRUM-49: direct access, not-approved status, approval error and retry", async ({
  page,
}) => {
  await page.goto("/#/payment");
  await expect(page).toHaveURL(/login/);
  await expect(
    page.getByText("Sign in to check approval", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Pending review" }),
  ).toBeVisible();
  await route(page, "/payment");
  await expect(
    page.getByText("Approval required", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Funding method")).toHaveCount(0);
  await checkPage(page);
  await page.getByRole("link", { name: "Back to enrollment status" }).click();
  await page.getByLabel("Demo application status").selectOption("not-approved");
  await expect(
    page.getByRole("heading", { name: "Not approved (demo)" }),
  ).toBeVisible();
  await route(page, "/payment?approved=true");
  await expect(
    page.getByText("Approval required", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Funding method")).toHaveCount(0);
  await page.getByRole("link", { name: "Back to enrollment status" }).click();
  await page.getByText("Demo testing options", { exact: true }).click();
  await page.getByRole("button", { name: "Simulate approval error" }).click();
  await expect(page.getByRole("status")).toContainText("Checking approval");
  await expect(page.getByRole("alert")).toContainText(
    "Could not load approval",
  );
  await checkPage(page);
  await page.getByRole("button", { name: "Retry approval check" }).click();
  await expect(
    page.getByRole("heading", { name: "Not approved (demo)" }),
  ).toBeVisible();
  await openApprovedPayment(page);
});

test("SCRUM-49: approval resets on refresh, role change and sign-out", async ({
  page,
}) => {
  await openApproval(page);
  await openApprovedPayment(page);
  await page.reload();
  await expect(
    page.getByText("Approval required", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to enrollment status" }).click();
  await openApprovedPayment(page);
  await route(page, "/login");
  await page.getByLabel("I am a").selectOption("Parent");
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await page.getByRole("link", { name: "Enrollment status & payment" }).click();
  await expect(
    page.getByRole("heading", { name: "Pending review" }),
  ).toBeVisible();
  await openApprovedPayment(page);
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await route(page, "/payment");
  await expect(page).toHaveURL(/login/);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("tala.frontend-demo.session"),
    ),
  ).toBeNull();
});

test("SCRUM-48: private card checkout, keyboard submission and no financial persistence", async ({
  page,
  browserName,
}) => {
  await openApproval(page);
  await openApprovedPayment(page);
  await expect(page.getByLabel("Funding method")).toHaveValue("Private");
  await expect(page.getByLabel("Funding method").locator("option")).toHaveText([
    "Private (self-funded)",
  ]);
  await page
    .getByRole("button", { name: "Use demo card", exact: true })
    .click();
  await page.getByLabel("I understand this is a demo").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(
    page.getByRole("button", { name: "Pay with demo card", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Demo card payment complete" }),
  ).toBeVisible();
  await expect(page.getByText("$0 · Demo only")).toBeVisible();
  await expect(page.locator(".payment-summary")).toContainText("Private");
  await expect(page.locator(".payment-summary")).toContainText("4242");
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  expect(storage).not.toMatch(/funding|receipt|payment|approved|cardNumber/);
});

test("SCRUM-46: leaving registration during submission cancels its redirect", async ({
  page,
}) => {
  await registerDemoFamily(page, false);
  await page
    .getByRole("button", { name: "Complete registration demo" })
    .click();
  await expect(
    page.getByRole("button", { name: "Completing demo…" }),
  ).toBeDisabled();
  await route(page, "/login");
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your learning", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/dashboard/);
  await route(page, "/two-factor");
  await expect(
    page.getByRole("heading", { name: "Start with registration" }),
  ).toBeVisible();
});

// Authentication tests handle ephemeral enrollment secrets; do not record traces.
test.use({ trace: "off", screenshot: "off" });
