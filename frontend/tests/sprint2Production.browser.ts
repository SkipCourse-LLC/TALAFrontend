import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Sprint2Fixture } from "./sprint2Harness";

// Keys/QRs are ephemeral. Never attach screenshots, traces or secret values.
test.use({ trace: "off", screenshot: "off" });

async function open(page: Page, flow = "two-factor", scenario = "normal") {
  await page.goto(
    `/tests/sprint2Harness.html?flow=${flow}&scenario=${scenario}`,
  );
  await page.waitForFunction(() => !!window.sprint2Fixture);
}

async function fixture(
  page: Page,
  action: keyof Pick<
    Sprint2Fixture,
    "release" | "rerender" | "switchIdentity" | "replaceService"
  >,
) {
  await page.evaluate((method) => window.sprint2Fixture[method](), action);
}

async function emailVerification(page: Page) {
  await page.getByRole("radio", { name: /Email code/ }).check();
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await expect(
    page.getByLabel("Verification code", { exact: true }),
  ).toBeFocused();
}

async function paymentDraft(page: Page) {
  await page.getByLabel("Funding method", { exact: true }).selectOption("ESA");
  await page.getByRole("checkbox", { name: /I understand/ }).check();
}

async function accessible(page: Page, selector: string) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations.map(({ id, impact }) => ({ id, impact }))).toEqual(
    [],
  );
}

async function fitsViewport(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

async function provisioningVisible(page: Page, selector: string) {
  // A failed locator matcher can print the key or QR data URL in its call log.
  await expect.poll(() => page.locator(selector).isVisible()).toBe(true);
}

test("authenticator setup privacy, clipboard fallback, responsive targets and recovery focus", async ({
  page,
}) => {
  await open(page);
  await provisioningVisible(page, ".two-factor-qr-image");
  await fitsViewport(page);
  await accessible(page, ".two-factor-page");
  const targets = await page
    .locator(
      ".two-factor-page button:visible, .two-factor-page summary:visible, .two-factor-methods label",
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height >= 44),
    );
  expect(targets.every(Boolean)).toBe(true);
  await page.getByRole("button", { name: "Hide QR code" }).click();
  await expect(
    page.getByRole("button", { name: "Show QR code" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(
      async () => (await page.locator(".two-factor-qr-image").count()) === 0,
    )
    .toBe(true);
  await page.getByRole("button", { name: "Hide setup key" }).click();
  await expect
    .poll(
      async () => (await page.locator(".two-factor-manual code").count()) === 0,
    )
    .toBe(true);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Fixture clipboard unavailable");
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Copy setup key" }).click();
  await expect(page.locator(".two-factor-copy-message")).toContainText(
    "Copy is unavailable",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement ===
          document.querySelector(".two-factor-manual code"),
      ),
    )
    .toBe(true);
  expect(await page.evaluate(() => !!window.getSelection()?.toString())).toBe(
    true,
  );
  const help = page.getByRole("button", {
    name: "Lost your device or cannot get a code?",
  });
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Get back to verification" }),
  ).toBeFocused();
  await expect(page.locator(".two-factor-recovery")).toContainText(
    "no recovery codes, device reset or recovery email",
  );
  await accessible(page, ".two-factor-page");
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();
  await expect(help).toHaveAttribute("aria-expanded", "false");
});

test("six-digit keyboard editing, normalized paste, validation and success announcements", async ({
  page,
}) => {
  await open(page);
  await emailVerification(page);
  const code = page.getByLabel("Verification code", { exact: true });
  await code.pressSequentially("246819");
  await code.press("Backspace");
  await code.press("0");
  await expect(code).toHaveValue("246810");
  await code.fill("");
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await accessible(page, ".two-factor-page");
  await code.fill("111111");
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "does not match or has expired",
  );
  await code.evaluate((node) => {
    const data = new DataTransfer();
    data.setData("text", "２４６-８１０");
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(code).toHaveValue("246810");
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your family demo is ready." }),
  ).toBeFocused();
  await expect(page.getByRole("status")).toContainText(
    "Verification successful",
  );
  await expect(page.getByTestId("verified-count")).toHaveText("1");
  await accessible(page, ".two-factor-page");
  await fitsViewport(page);
});

test("equivalent identity props preserve authenticator setup and unfinished input", async ({
  page,
}) => {
  await open(page);
  await provisioningVisible(page, ".two-factor-manual code");
  await page.evaluate(() => {
    const key = document.querySelector(".two-factor-manual code")?.textContent;
    (
      window as Window & { originalFixtureKey?: string | null }
    ).originalFixtureKey = key;
  });
  await fixture(page, "rerender");
  expect(
    await page.evaluate(
      () =>
        document.querySelector(".two-factor-manual code")?.textContent ===
        (window as Window & { originalFixtureKey?: string | null })
          .originalFixtureKey,
    ),
  ).toBe(true);
  await emailVerification(page);
  await page.getByLabel("Verification code", { exact: true }).fill("246");
  await fixture(page, "rerender");
  await expect(
    page.getByLabel("Verification code", { exact: true }),
  ).toHaveValue("246");
});

test("expired challenge offers a focused restart and no apparent recovery", async ({
  page,
}) => {
  await open(page, "two-factor", "expired");
  await emailVerification(page);
  await expect(page.getByRole("alert")).toContainText(
    "setup has ended or expired",
  );
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(
    page.getByLabel("Verification code", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await page
    .getByRole("button", { name: "Restart setup", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Set up two-factor authentication" }),
  ).toBeFocused();
  await expect(page.getByTestId("verified-count")).toHaveText("0");
});

test("empty state and unknown adapter diagnostics are safe", async ({
  page,
}) => {
  await open(page, "two-factor", "empty");
  await expect(
    page.getByRole("heading", { name: "Start with registration" }),
  ).toBeFocused();
  await accessible(page, ".two-factor-page");
  await open(page, "two-factor", "unknown-prepare");
  await expect(page.getByRole("alert")).toContainText(
    "Could not start this setup",
  );
  await expect(page.locator("body")).not.toContainText(
    "Private diagnostic fixture",
  );
  await open(page, "two-factor", "unknown-verify");
  await emailVerification(page);
  await page.getByLabel("Verification code", { exact: true }).fill("246810");
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await expect(page.locator("body")).not.toContainText(
    "Private diagnostic fixture",
  );
});

test("late key preparation cannot restore a deselected method", async ({
  page,
}) => {
  await open(page, "two-factor", "late-prepare");
  await expect
    .poll(() => page.evaluate(() => window.sprint2Fixture.pending()))
    .toBe(true);
  await page.getByRole("radio", { name: /Email code/ }).check();
  await fixture(page, "release");
  await expect(
    page.getByRole("heading", { name: "Verify with an email code" }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.locator(".two-factor-provisioning").count()) === 0,
    )
    .toBe(true);
  await emailVerification(page);
  await expect(
    page.getByLabel("Verification code", { exact: true }),
  ).toBeVisible();
});

test("cancel, identity change and adapter replacement reject late verification", async ({
  page,
}) => {
  for (const action of [
    "cancel",
    "switchIdentity",
    "replaceService",
  ] as const) {
    await open(page, "two-factor", "late-verify");
    await emailVerification(page);
    const code = page.getByLabel("Verification code", { exact: true });
    await code.fill("246810");
    await page
      .getByRole("button", { name: "Verify code", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Verifying…", exact: true }),
    ).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => window.sprint2Fixture.pending()))
      .toBe(true);
    await code.evaluate((node) => {
      const data = new DataTransfer();
      data.setData("text", "999999");
      node.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(code).toHaveValue("246810");
    if (action === "cancel")
      await page.getByRole("button", { name: "Cancel signup demo" }).click();
    else await fixture(page, action);
    await fixture(page, "release");
    await expect(page.getByTestId("verified-count")).toHaveText("0");
    await expect(
      page.getByRole("heading", { name: "Your family demo is ready." }),
    ).toHaveCount(0);
    if (action !== "cancel")
      await expect(
        page.getByRole("heading", { name: "Set up two-factor authentication" }),
      ).toBeVisible();
  }
});

test("all approval outcomes gate continuation and announce updates", async ({
  page,
}) => {
  await open(page, "approval");
  const select = page.getByLabel("Demo application status", { exact: true });
  for (const [value, heading] of [
    ["pending", "Pending review"],
    ["rejected", "Rejected (demo)"],
    ["not-approved", "Not approved (demo)"],
    ["approved", "Approved (demo)"],
  ]) {
    await select.selectOption(value!);
    await expect(
      page.getByRole("heading", { name: heading!, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Continue to payment" }),
    ).toHaveCount(value === "approved" ? 1 : 0);
    await expect(page.locator(".payment-sr-only")).toContainText(heading!);
  }
  await fitsViewport(page);
  await accessible(page, ".payment-page");
  await page.getByText("Demo testing options", { exact: true }).click();
  await page.getByRole("button", { name: "Simulate approval error" }).click();
  await expect(
    page.getByRole("heading", { name: "Approval status is unavailable" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Retry approval check" }).click();
  await expect(
    page.getByRole("heading", { name: "Approved (demo)", exact: true }),
  ).toBeFocused();
});

test("payment validation, keyboard order, cancel/resume, failure retry and confirmation", async ({
  page,
}) => {
  await open(page, "payment");
  await page
    .getByRole("button", { name: "Complete payment demo", exact: true })
    .click();
  await expect(
    page.getByLabel("Funding method", { exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("alert")).toBeVisible();
  await accessible(page, ".payment-page");
  await paymentDraft(page);
  const acknowledged = page.getByRole("checkbox", { name: /I understand/ });
  await acknowledged.focus();
  await page.keyboard.press(
    test.info().project.name === "owned-tablet" ? "Alt+Tab" : "Tab",
  );
  await expect(
    page.getByRole("button", { name: "Complete payment demo", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Cancel payment demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Payment demo cancelled" }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Complete payment demo", exact: true }),
  ).toBeDisabled();
  await accessible(page, ".payment-page");
  await page.getByRole("button", { name: "Resume payment demo" }).click();
  await expect(
    page.getByLabel("Funding method", { exact: true }),
  ).toBeFocused();
  await expect(acknowledged).toBeChecked();
  await page.getByText("Demo testing options", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Simulate payment error" }).check();
  await page
    .getByRole("button", { name: "Complete payment demo", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("could not complete");
  await expect(page.getByLabel("Funding method", { exact: true })).toHaveValue(
    "ESA",
  );
  await page
    .getByRole("checkbox", { name: "Simulate payment error" })
    .uncheck();
  await page
    .getByRole("button", { name: "Complete payment demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Payment demo complete" }),
  ).toBeFocused();
  await expect(page.locator(".payment-success")).toContainText(
    "$0 · Demo only",
  );
  await fitsViewport(page);
  await accessible(page, ".payment-page");
  await page.getByRole("button", { name: "Start a new payment demo" }).click();
  await expect(page.getByLabel("Funding method", { exact: true })).toHaveValue(
    "",
  );
  await expect(acknowledged).not.toBeChecked();
  await expect(page.locator("input:not([type=checkbox]), iframe")).toHaveCount(
    0,
  );
});

test("synchronous duplicate submits result in one adapter call", async ({
  page,
}) => {
  await open(page, "payment", "slow");
  await paymentDraft(page);
  await page
    .getByRole("form", { name: "Payment demo", exact: true })
    .evaluate((form) => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  await expect(
    page.getByRole("button", { name: "Completing payment demo…" }),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.sprint2Fixture.counts().submit)).toBe(
    1,
  );
  await expect(
    page.getByRole("heading", { name: "Payment demo complete" }),
  ).toBeVisible();
});

test("approval revocation invalidates confirmation without receipt resurrection", async ({
  page,
}) => {
  await open(page, "payment");
  await paymentDraft(page);
  await page
    .getByRole("button", { name: "Complete payment demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Payment demo complete" }),
  ).toBeVisible();
  await page.evaluate(() => window.sprint2Fixture.selectApproval("rejected"));
  await expect(
    page.getByRole("heading", { name: "Approval required" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete payment demo", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => window.sprint2Fixture.selectApproval("approved"));
  await expect(page.getByLabel("Funding method", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("heading", { name: "Payment demo complete" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Funding method", { exact: true })).toHaveValue(
    "",
  );
});

test("late payment responses cannot override cancellation, identity or adapter changes", async ({
  page,
}) => {
  for (const action of [
    "cancel",
    "switchIdentity",
    "replaceService",
  ] as const) {
    await open(page, "payment", "late-payment");
    await paymentDraft(page);
    await page
      .getByRole("button", { name: "Complete payment demo", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Completing payment demo…" }),
    ).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => window.sprint2Fixture.pending()))
      .toBe(true);
    if (action === "cancel")
      await page.getByRole("button", { name: "Cancel payment demo" }).click();
    else await fixture(page, action);
    await fixture(page, "release");
    await expect(
      page.getByRole("heading", { name: "Payment demo complete" }),
    ).toHaveCount(0);
    if (action === "cancel") {
      await expect(
        page.getByRole("heading", { name: "Payment demo cancelled" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Resume payment demo" }).click();
    }
    await expect(
      page.getByRole("button", { name: "Complete payment demo", exact: true }),
    ).toBeEnabled();
  }
});

test("unknown payment errors show safe retry feedback without diagnostics", async ({
  page,
}) => {
  await open(page, "payment", "unknown-payment");
  await paymentDraft(page);
  await page
    .getByRole("button", { name: "Complete payment demo", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.locator("body")).not.toContainText(
    "Private diagnostic fixture",
  );
  await expect(
    page.getByRole("button", { name: "Complete payment demo", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Funding method", { exact: true })).toHaveValue(
    "ESA",
  );
});

test("reduced-motion preferences disable decorative motion in both modules", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const flow of ["two-factor", "payment"]) {
    await open(page, flow);
    const selector = flow === "payment" ? ".payment-page" : ".two-factor-page";
    expect(
      await page.locator(selector).evaluate((root) =>
        [...root.querySelectorAll("*")].every((node) => {
          const style = getComputedStyle(node);
          return (
            style.animationDuration
              .split(",")
              .every((value) => parseFloat(value) <= 0.001) &&
            style.transitionDuration
              .split(",")
              .every((value) => parseFloat(value) <= 0.001)
          );
        }),
      ),
    ).toBe(true);
    await fitsViewport(page);
  }
});
