import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  registerDemoFamily,
  completeDemoVerification,
} from "../../tests/signupHelpers";

test.beforeEach(async ({ context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === "http://127.0.0.1:5173" ||
      ["data:", "blob:"].includes(url.protocol)
    )
      return route.continue();
    await route.abort();
    throw new Error(
      "The meeting demo must not request a backend or external service.",
    );
  });
});

test("registration leads to parent booking; reschedule, refresh and cancellation persist without Firebase", async ({
  page,
}) => {
  await registerDemoFamily(page);
  await completeDemoVerification(page);
  await page
    .getByRole("link", { name: "Continue to parent workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Parent workspace", exact: true }),
  ).toBeVisible();
  const panel = page.getByRole("region", {
    name: "Book a meeting",
    exact: true,
  });
  await expect(
    panel.getByText("Local demo · No Firebase", { exact: true }),
  ).toBeVisible();
  await panel.getByLabel("Available demo times").selectOption({ index: 1 });
  await panel
    .getByRole("button", { name: "Book selected time", exact: true })
    .click();
  await expect(
    panel.getByText("Demo booking saved", { exact: true }),
  ).toBeVisible();
  const first = await panel.locator("time").getAttribute("datetime");
  await panel
    .getByLabel("Choose a different demo time")
    .selectOption({ index: 1 });
  await panel
    .getByRole("button", { name: "Change demo booking", exact: true })
    .click();
  await expect(panel.locator("time")).not.toHaveAttribute("datetime", first!);
  await page.reload();
  await expect(
    panel.getByText("Demo booking saved", { exact: true }),
  ).toBeVisible();
  const records = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith("tala.demo-meetings.v1."))
      .map(([, value]) => value),
  );
  expect(records).toHaveLength(1);
  expect(records[0]).not.toMatch(/@|password|token|parentName|studentName/);
  await panel
    .getByRole("button", { name: "Cancel demo booking", exact: true })
    .click();
  await page.reload();
  await expect(
    panel.getByText("Demo booking cancelled", { exact: true }),
  ).toBeVisible();
});

test("student navigation exposes meetings on a phone with keyboard submission and scoped accessibility", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/login");
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Book a meeting", exact: true }),
  ).toBeVisible();
  await page.goto("/#/dashboard?view=meetings");
  const panel = page.getByRole("region", {
    name: "Book a meeting",
    exact: true,
  });
  await expect(panel.getByLabel("Available demo times")).toBeEnabled();
  // Select native options through the browser API; OS popup key behavior differs
  // in headless macOS. Verify our focus order and keyboard submission separately.
  await panel.getByLabel("Available demo times").selectOption({ index: 1 });
  await panel.getByLabel("Available demo times").focus();
  await page.keyboard.press("Tab");
  await expect(
    panel.getByRole("button", { name: "Book selected time", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    panel.getByText("Demo booking saved", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .include("#demo-meetings")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations.map(({ id }) => id)).toEqual([]);
});

test("blocked browser storage reports failure without claiming a saved booking", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("tala.demo-meetings.v1."))
        throw new Error("Synthetic storage failure");
      return original.call(this, key, value);
    };
  });
  await page.goto("/#/login");
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  const panel = page.getByRole("region", {
    name: "Book a meeting",
    exact: true,
  });
  await panel.getByLabel("Available demo times").selectOption({ index: 1 });
  await panel
    .getByRole("button", { name: "Book selected time", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("could not be saved");
  await expect(
    panel.getByText("Demo booking saved", { exact: true }),
  ).toHaveCount(0);
});
