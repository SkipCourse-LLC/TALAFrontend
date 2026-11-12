import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Temporary provisioning keys must never enter failure artifacts or call logs.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", screenshot: "off", video: "off" });

async function manualKeyVisible(page: Page) {
  await expect
    .poll(() => page.locator(".two-factor-manual code").isVisible())
    .toBe(true);
}

// SCRUM-46/47/48/49 upgrade coverage; no dependency on another feature's helpers.
async function openVerification(page: Page) {
  await page.goto("/#/register");
  await page.getByLabel("Parent name").fill("Taylor Parent");
  await page.getByLabel("Parent email").fill("taylor@example.com");
  await page.getByLabel("Demo password", { exact: true }).fill("practice-only");
  await page.getByLabel("Confirm demo password").fill("practice-only");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Student name").fill("Jordan Learner");
  await page.getByLabel("Student email").fill("jordan@example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Learning preference").selectOption("Hybrid");
  await page.getByLabel("Preferred time block").selectOption("8–10 AM");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Funding preference").selectOption("ESA");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Complete registration demo" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Set up two-factor authentication" }),
  ).toBeVisible();
}

async function openPayment(page: Page) {
  await page.goto("/#/login");
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await page.getByRole("link", { name: "Enrollment status & payment" }).click();
  await expect(
    page.getByRole("heading", { name: "Pending review" }),
  ).toBeVisible();
  await page.getByLabel("Demo application status").selectOption("approved");
  await page.getByRole("link", { name: "Continue to payment" }).click();
  await expect(page.getByLabel("Funding method")).toBeVisible();
}

test("SCRUM-46: manual key visibility and clipboard fallback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("Clipboard unavailable")),
      },
    });
  });
  await openVerification(page);
  await manualKeyVisible(page);
  await page.getByRole("button", { name: "Hide setup key" }).click();
  await expect
    .poll(
      async () => (await page.locator(".two-factor-manual code").count()) === 0,
    )
    .toBe(true);
  await page.getByRole("button", { name: "Copy setup key" }).click();
  await expect(
    page.getByText("Copy is unavailable.", { exact: false }),
  ).toBeVisible();
  await manualKeyVisible(page);
  await page.getByRole("button", { name: "Hide setup key" }).click();
  await page.getByRole("button", { name: "Show setup key" }).click();
  await manualKeyVisible(page);
});

test("SCRUM-46/47: copied key feedback, formatted-code paste and local completion", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  });
  await openVerification(page);
  await page.getByRole("button", { name: "Copy setup key" }).click();
  await expect(
    page.getByText("Setup key copied.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("radio", { name: /Email code/ }).check();
  await page.getByRole("button", { name: "Continue to verification" }).click();
  const input = page.getByLabel("Verification code");
  await input.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "246 810");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(input).toHaveValue("246810");
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Your family demo is ready." }),
  ).toBeFocused();
  await expect
    .poll(
      async () => (await page.locator(".two-factor-manual code").count()) === 0,
    )
    .toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.map(({ id, impact }) => ({ id, impact })),
  ).toEqual([]);
});

test("SCRUM-48: selected summary and completed demo survive navigation, then reset on refresh", async ({
  page,
}) => {
  await openPayment(page);
  await page.getByLabel("Funding method").selectOption("STO");
  await expect(page.locator(".payment-order")).toContainText(
    "Funding choiceSTO",
  );
  await page.getByLabel("I understand this is a demo").check();
  await page
    .getByRole("button", { name: "Complete payment demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Payment demo complete" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to enrollment status" }).click();
  await page.getByRole("link", { name: "Continue to payment" }).click();
  await expect(
    page.getByRole("heading", { name: "Payment demo complete" }),
  ).toBeVisible();
  await expect(page.getByLabel("Funding method")).toHaveCount(0);
  await expect(
    page.getByText("Sample funding choice: STO.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Approval required" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Payment demo complete" }),
  ).toHaveCount(0);
});

test("SCRUM-48/49: leaving a pending payment cannot record a completion", async ({
  page,
}) => {
  await openPayment(page);
  await page.getByLabel("Funding method").selectOption("Private");
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
  await page.getByLabel("I understand this is a demo").check();
  await page
    .getByRole("button", { name: "Pay with demo card", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Completing payment demo…" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Back to enrollment status" }).click();
  await page.getByRole("link", { name: "Continue to payment" }).click();
  await expect(page.getByLabel("Funding method")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Demo card payment complete",
      exact: true,
    }),
  ).toHaveCount(0);
});

test.use({ trace: "off", screenshot: "off" });
