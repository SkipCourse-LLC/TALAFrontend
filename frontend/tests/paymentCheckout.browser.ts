import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Sprint2Fixture } from "./sprint2Harness";

const fixedCardFields = Object.freeze({
  "card-number": "4242 4242 4242 4242",
  cardholder: "Alex Sample",
  expiry: "12/30",
  "security-code": "123",
  country: "United States",
  address: "123 Example Lane",
  city: "Sample City",
  state: "AZ",
  "postal-code": "00000",
  email: "alex@example.com",
  phone: "(202) 555-0100",
});

declare global {
  interface Window {
    paymentStorageWriteCount: number;
  }
}

// Only fixed, invented sample methods are used. No screenshots or traces.
test.use({ trace: "off", screenshot: "off" });

async function openCheckout(page: Page, scenario = "normal") {
  await page.goto(
    `/tests/sprint2Harness.html?flow=payment&scenario=${scenario}`,
  );
  await page.waitForFunction(() => !!window.sprint2Fixture);
  await expect(
    page.getByLabel("Funding method", { exact: true }),
  ).toBeVisible();
}

async function choosePrivateFunding(page: Page) {
  await page
    .getByLabel("Funding method", { exact: true })
    .selectOption("Private");
}

function methodTrigger(page: Page) {
  return page.getByRole("button", {
    name: /^(Add|Change) demo payment method$/,
  });
}

function methodDialog(page: Page) {
  return page.getByRole("dialog", {
    name: "Add demo payment method",
    exact: true,
  });
}

async function openMethod(page: Page) {
  const trigger = methodTrigger(page);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = methodDialog(page);
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  return dialog;
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

async function fitsViewport(page: Page, dialog?: Locator) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  if (dialog) {
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(!!bounds && !!viewport).toBe(true);
    expect(
      !!bounds &&
        !!viewport &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= viewport.width + 1 &&
        bounds.y + bounds.height <= viewport.height + 1,
    ).toBe(true);
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
  }
}

async function fixedDetails(dialog: Locator) {
  for (const heading of [
    "Credit card details",
    "Billing address",
    "Contact information",
  ]) {
    await expect(
      dialog.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
  for (const [field, value] of Object.entries(fixedCardFields)) {
    await expect(
      dialog.locator(`[data-demo-field="${field}"] strong`),
    ).toHaveText(value);
  }
  const expiry = dialog.locator('[data-demo-field="expiry"]');
  await expect(expiry).toContainText("Month");
  await expect(expiry).toContainText("Year");
  await expect(expiry).toContainText("2030");
}

async function onlySampleControls(page: Page, dialog: Locator) {
  await expect(dialog.locator("[contenteditable]")).toHaveCount(0);
  await expect(
    dialog.locator(
      'input:not([type="radio"]):not([type="checkbox"]), textarea, iframe',
    ),
  ).toHaveCount(0);
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  // Static card, address and contact examples must never become successful form
  // controls. Only safe funding, acknowledgment and sample-method choices qualify.
  expect(
    await page
      .locator("form.payment-form")
      .evaluate((form) =>
        Array.from(new FormData(form as HTMLFormElement).values()).every(
          (value) =>
            typeof value === "string" &&
            ["card", "bank", "Private", "ESA", "STO", "on", "true"].includes(
              value,
            ),
        ),
      ),
  ).toBe(true);
}

async function stickyAction(dialog: Locator) {
  const bounds = await dialog.boundingBox();
  const save = dialog.getByRole("button", {
    name: "Save demo payment method",
    exact: true,
  });
  const action = await save.boundingBox();
  expect(
    !!bounds &&
      !!action &&
      action.x >= bounds.x &&
      action.y >= bounds.y &&
      action.x + action.width <= bounds.x + bounds.width + 1 &&
      action.y + action.height <= bounds.y + bounds.height + 1,
  ).toBe(true);
  expect(
    await save.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return hit === node || (!!hit && node.contains(hit));
    }),
  ).toBe(true);
}

async function saveSample(page: Page, method: "card" | "bank") {
  const dialog = await openMethod(page);
  await dialog
    .getByRole("radio", {
      name:
        method === "card"
          ? "Demo card ending in 4242"
          : "Demo bank account ending in 0000",
      exact: true,
    })
    .check();
  await dialog
    .getByRole("button", { name: "Save demo payment method", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(methodTrigger(page)).toHaveAccessibleName(
    "Change demo payment method",
  );
  await expect(methodTrigger(page)).toBeFocused();
}

async function fixture(
  page: Page,
  action: keyof Pick<
    Sprint2Fixture,
    "rerender" | "switchIdentity" | "replaceService"
  >,
) {
  await page.evaluate((name) => window.sprint2Fixture[name](), action);
}

test("checkout summary and sample-method dialog fit all viewports and collect no financial information", async ({
  page,
}) => {
  await openCheckout(page);
  await expect(page.locator(".payment-page-checkout")).toBeVisible();
  await expect(page.locator(".payment-order")).toContainText(
    "To be confirmed by TALA",
  );
  await expect(page.locator(".payment-order")).toContainText("No charge");
  await fitsViewport(page);
  await accessible(page, ".payment-page");
  await choosePrivateFunding(page);
  const dialog = await openMethod(page);
  await expect(
    dialog.getByRole("radio", {
      name: "Demo card ending in 4242",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("radio", {
      name: "Demo bank account ending in 0000",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Pay with card", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("img", { name: /^Illustrative demo card brands:/ }),
  ).toBeVisible();
  await fixedDetails(dialog);
  await onlySampleControls(page, dialog);
  await fitsViewport(page, dialog);
  // The sticky action must remain wholly visible, including when the dialog
  // initially opens above fields that need scrolling on smaller viewports.
  await stickyAction(dialog);
  const targets = await dialog
    .locator("button:visible, label:visible")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const bounds = node.getBoundingClientRect();
        return bounds.width >= 44 && bounds.height >= 44;
      }),
    );
  expect(targets.length > 0 && targets.every(Boolean)).toBe(true);
  await accessible(page, "dialog[open]");
  await dialog
    .getByRole("radio", {
      name: "Demo bank account ending in 0000",
      exact: true,
    })
    .check();
  for (const field of Object.keys(fixedCardFields)) {
    await expect(dialog.locator(`[data-demo-field="${field}"]`)).toHaveCount(0);
  }
  for (const heading of [
    "Pay with card",
    "Credit card details",
    "Billing address",
    "Contact information",
  ]) {
    await expect(
      dialog.getByRole("heading", { name: heading, exact: true }),
    ).toHaveCount(0);
  }
  await expect(
    dialog.locator('[data-demo-field="account-number"] strong'),
  ).toHaveText("•••• 0000");
  await onlySampleControls(page, dialog);
  await fitsViewport(page, dialog);
  await stickyAction(dialog);
  await accessible(page, "dialog[open]");
});

test("fixed checkout details reflow at 200 percent text size and keep the action reachable while scrolling", async ({
  page,
}) => {
  await openCheckout(page);
  await page.evaluate(() => {
    const size = parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    document.documentElement.style.fontSize = `${size * 2}px`;
  });
  await choosePrivateFunding(page);
  const dialog = await openMethod(page);
  await fixedDetails(dialog);
  await onlySampleControls(page, dialog);
  await fitsViewport(page, dialog);
  await stickyAction(dialog);
  await dialog.evaluate((node) => {
    for (const candidate of [
      node,
      ...node.querySelectorAll<HTMLElement>("*"),
    ]) {
      if (
        candidate.scrollHeight > candidate.clientHeight &&
        /(auto|scroll)/.test(getComputedStyle(candidate).overflowY)
      )
        candidate.scrollTop = candidate.scrollHeight;
    }
  });
  await fitsViewport(page, dialog);
  await stickyAction(dialog);
  await accessible(page, "dialog[open]");
  await dialog
    .getByRole("button", { name: "Save demo payment method", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(methodTrigger(page)).toBeFocused();
});

test("private checkout displays fixed card details immediately and uses only a sample-method choice", async ({
  page,
}) => {
  let outboundMutations = 0;
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) outboundMutations++;
  });
  await openCheckout(page);
  await page.evaluate(() => {
    const size = parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    document.documentElement.style.fontSize = `${size * 2}px`;
  });
  await choosePrivateFunding(page);
  const inline = page.locator(".payment-method-inline-preview");
  const useCard = page.getByRole("button", {
    name: "Use demo card",
    exact: true,
  });
  await expect(inline).toBeVisible();
  await expect(methodDialog(page)).toHaveCount(0);
  await expect(
    page
      .locator(".payment-method")
      .getByRole("heading", { name: "Pay with card", exact: true }),
  ).toBeVisible();
  await expect(inline.locator("[data-demo-brand]")).toHaveCount(4);
  await fixedDetails(inline);
  await onlySampleControls(page, inline);
  await expect(useCard).toBeVisible();
  await expect(methodTrigger(page)).toHaveAccessibleName(
    "Add demo payment method",
  );
  await expect(page.locator(".payment-method-saved")).toHaveCount(0);
  await fitsViewport(page);
  expect(
    await inline.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await accessible(page, ".payment-page");

  await useCard.click();
  await expect(useCard).toHaveCount(0);
  await expect(page.locator(".payment-method-saved")).toContainText(
    "Demo card · 4242",
  );
  await expect(page.locator(".payment-method-saved")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Pay with demo card", exact: true }),
  ).toBeEnabled();
  await expect(inline).toBeVisible();
  await fixedDetails(inline);
  expect(await page.evaluate(() => window.sprint2Fixture.counts().submit)).toBe(
    0,
  );

  await saveSample(page, "bank");
  await expect(inline).toHaveCount(0);
  for (const field of Object.keys(fixedCardFields)) {
    await expect(page.locator(`[data-demo-field="${field}"]`)).toHaveCount(0);
  }
  await expect(page.locator(".payment-method-saved")).toContainText(
    "Demo bank account · 0000",
  );
  await expect(
    page.getByRole("button", {
      name: "Pay with demo bank account",
      exact: true,
    }),
  ).toBeEnabled();
  await saveSample(page, "card");
  await expect(inline).toBeVisible();
  await fixedDetails(inline);
  await onlySampleControls(page, inline);
  await fitsViewport(page);
  await accessible(page, ".payment-page");

  await page.reload();
  await choosePrivateFunding(page);
  await expect(inline).toBeVisible();
  await expect(useCard).toBeVisible();
  await expect(page.locator(".payment-method-saved")).toHaveCount(0);
  await useCard.click();
  await page.evaluate(() => window.sprint2Fixture.selectApproval("rejected"));
  await expect(
    page.getByRole("heading", { name: "Approval required", exact: true }),
  ).toBeVisible();
  await expect(inline).toHaveCount(0);
  await expect(methodTrigger(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Pay with demo/ }),
  ).toHaveCount(0);
  await page.evaluate(() => window.sprint2Fixture.selectApproval("approved"));
  await choosePrivateFunding(page);
  await expect(inline).toBeVisible();
  await expect(useCard).toBeVisible();
  await expect(page.locator(".payment-method-saved")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.sprint2Fixture.counts().submit)).toBe(
    0,
  );
  expect(outboundMutations).toBe(0);
});

test("checkout dialog traps keyboard focus and Escape or close returns to its opener", async ({
  page,
}) => {
  await openCheckout(page);
  await choosePrivateFunding(page);
  await page.getByRole("checkbox", { name: /I understand/ }).check();
  for (const closeWith of ["escape", "button"] as const) {
    const dialog = await openMethod(page);
    const card = dialog.getByRole("radio", {
      name: "Demo card ending in 4242",
      exact: true,
    });
    const bank = dialog.getByRole("radio", {
      name: "Demo bank account ending in 0000",
      exact: true,
    });
    await card.focus();
    await page.keyboard.press("ArrowDown");
    await expect(bank).toBeChecked();
    await expect(bank).toBeFocused();
    await card.focus();
    await page.keyboard.press("Space");
    await expect(card).toBeChecked();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(() => window.sprint2Fixture.counts().submit),
    ).toBe(0);
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((node) => node.contains(document.activeElement)),
      ).toBe(true);
    }
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press("Shift+Tab");
      expect(
        await dialog.evaluate((node) => node.contains(document.activeElement)),
      ).toBe(true);
    }
    if (closeWith === "escape") await page.keyboard.press("Escape");
    else
      await dialog
        .getByRole("button", {
          name: "Close payment method dialog",
          exact: true,
        })
        .click();
    await expect(dialog).toHaveCount(0);
    await expect(methodTrigger(page)).toBeFocused();
    await expect(methodTrigger(page)).toHaveAccessibleName(
      "Add demo payment method",
    );
  }
});

test("checkout saves only fixed card or bank samples and refresh discards those choices", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let writes = 0;
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, "paymentStorageWriteCount", {
      get: () => writes,
    });
    Storage.prototype.setItem = function (key, value) {
      writes++;
      original.call(this, key, value);
    };
  });
  let outboundMutations = 0;
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) outboundMutations++;
  });
  await openCheckout(page);
  await choosePrivateFunding(page);
  await saveSample(page, "card");
  await fixture(page, "rerender");
  await expect(methodTrigger(page)).toHaveAccessibleName(
    "Change demo payment method",
  );
  let dialog = await openMethod(page);
  await expect(
    dialog.getByRole("radio", {
      name: "Demo card ending in 4242",
      exact: true,
    }),
  ).toBeChecked();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.paymentStorageWriteCount)).toBe(0);
  expect(outboundMutations).toBe(0);
  await saveSample(page, "bank");
  dialog = await openMethod(page);
  await expect(
    dialog.getByRole("radio", {
      name: "Demo bank account ending in 0000",
      exact: true,
    }),
  ).toBeChecked();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.paymentStorageWriteCount)).toBe(0);
  expect(outboundMutations).toBe(0);
  expect(
    await page.evaluate(
      () => localStorage.length === 0 && sessionStorage.length === 0,
    ),
  ).toBe(true);
  await page.reload();
  await choosePrivateFunding(page);
  await expect(methodTrigger(page)).toHaveAccessibleName(
    "Add demo payment method",
  );
  await expect(
    page.locator('input:not([type="checkbox"]), textarea, iframe'),
  ).toHaveCount(0);
});

test("checkout changes funding and approval without preserving an obsolete sample method", async ({
  page,
}) => {
  await openCheckout(page);
  await choosePrivateFunding(page);
  await saveSample(page, "card");
  await page.getByLabel("Funding method", { exact: true }).selectOption("ESA");
  await expect(methodTrigger(page)).toHaveCount(0);
  await choosePrivateFunding(page);
  await expect(methodTrigger(page)).toHaveAccessibleName(
    "Add demo payment method",
  );
  await openMethod(page);
  await page.evaluate(() => window.sprint2Fixture.selectApproval("rejected"));
  await expect(methodDialog(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Approval required", exact: true }),
  ).toBeFocused();
  await expect(methodTrigger(page)).toHaveCount(0);
  await page.evaluate(() => window.sprint2Fixture.selectApproval("approved"));
  await choosePrivateFunding(page);
  await expect(methodTrigger(page)).toHaveAccessibleName(
    "Add demo payment method",
  );
});

test("checkout dialog and sample choices are isolated across identity and adapter changes", async ({
  page,
}) => {
  for (const action of ["switchIdentity", "replaceService"] as const) {
    await openCheckout(page);
    await choosePrivateFunding(page);
    await saveSample(page, "bank");
    await openMethod(page);
    await fixture(page, action);
    await expect(methodDialog(page)).toHaveCount(0);
    await choosePrivateFunding(page);
    await expect(methodTrigger(page)).toHaveAccessibleName(
      "Add demo payment method",
    );
    await expect(
      page.getByRole("button", { name: "Complete payment demo", exact: true }),
    ).toBeEnabled();
  }
});

test("private demo validates the sample choice, then card failures preserve that choice for retry", async ({
  page,
}) => {
  await openCheckout(page);
  await choosePrivateFunding(page);
  await page
    .getByRole("button", { name: "Complete payment demo", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Choose a demo payment method before continuing.",
  );
  await expect(methodTrigger(page)).toBeFocused();
  await expect(methodTrigger(page)).toHaveAttribute("aria-invalid", "true");
  expect(await page.evaluate(() => window.sprint2Fixture.counts().submit)).toBe(
    0,
  );
  await accessible(page, ".payment-page");
  await saveSample(page, "card");
  await expect(page.getByRole("alert")).toHaveCount(0);
  const pay = page.getByRole("button", {
    name: "Pay with demo card",
    exact: true,
  });
  await pay.click();
  const acknowledgement = page.getByRole("checkbox", { name: /I understand/ });
  await expect(acknowledgement).toBeFocused();
  expect(await page.evaluate(() => window.sprint2Fixture.counts().submit)).toBe(
    0,
  );
  await acknowledgement.check();
  await page.getByText("Demo testing options", { exact: true }).click();
  const simulate = page.getByRole("checkbox", {
    name: "Simulate payment error",
    exact: true,
  });
  await simulate.check();
  await pay.click();
  await expect(page.getByRole("alert")).toContainText("No payment was made");
  await expect(pay).toBeEnabled();
  await expect(page.locator(".payment-method-saved")).toContainText(
    "Demo card · 4242",
  );
  await expect(acknowledgement).toBeChecked();
  await accessible(page, ".payment-page");
  await simulate.uncheck();
  await pay.click();
  await expect(
    page.getByRole("heading", {
      name: "Demo card payment complete",
      exact: true,
    }),
  ).toBeFocused();
  await expect(page.locator(".payment-success")).toContainText(
    "Demo card · 4242",
  );
  await expect(page.locator(".payment-success")).toContainText(
    "$0 · Demo only",
  );
  expect(await page.evaluate(() => window.sprint2Fixture.counts().submit)).toBe(
    2,
  );
  await expect(
    page.locator('input:not([type="checkbox"]), textarea, iframe'),
  ).toHaveCount(0);
  await fitsViewport(page);
  await accessible(page, ".payment-page");
});

for (const method of ["card", "bank"] as const) {
  test(`private ${method} demo guards duplicate submit, preserves its receipt on remount, and clears on refresh`, async ({
    page,
  }) => {
    await openCheckout(page, "slow");
    await choosePrivateFunding(page);
    await saveSample(page, method);
    await page.getByRole("checkbox", { name: /I understand/ }).check();
    const action =
      method === "card" ? "Pay with demo card" : "Pay with demo bank account";
    await expect(
      page.getByRole("button", { name: action, exact: true }),
    ).toBeEnabled();
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
      page.getByRole("button", {
        name: "Completing payment demo…",
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      await page.evaluate(() => window.sprint2Fixture.counts().submit),
    ).toBe(1);
    const heading =
      method === "card"
        ? "Demo card payment complete"
        : "Demo bank payment complete";
    const summary =
      method === "card" ? "Demo card · 4242" : "Demo bank account · 0000";
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeFocused();
    await expect(page.locator(".payment-success")).toContainText(summary);
    await expect(page.locator(".payment-success")).toContainText(
      "$0 · Demo only",
    );
    // Replacing the wrapper with the same store remounts the keyed form content.
    await fixture(page, "replaceService");
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".payment-success")).toContainText(summary);
    await fitsViewport(page);
    await accessible(page, ".payment-page");
    expect(
      await page.evaluate(
        () => localStorage.length === 0 && sessionStorage.length === 0,
      ),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toHaveCount(0);
    await choosePrivateFunding(page);
    await expect(methodTrigger(page)).toHaveAccessibleName(
      "Add demo payment method",
    );
    await expect(
      page.getByRole("button", { name: "Complete payment demo", exact: true }),
    ).toBeEnabled();
  });
}

test("private bank demo retains its sample across cancel and resume, and revocation removes the completed receipt", async ({
  page,
}) => {
  await openCheckout(page);
  await choosePrivateFunding(page);
  await saveSample(page, "bank");
  await page.getByRole("checkbox", { name: /I understand/ }).check();
  await page
    .getByRole("button", { name: "Cancel payment demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Payment demo cancelled", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", {
      name: "Pay with demo bank account",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Resume payment demo", exact: true })
    .click();
  await expect(page.locator(".payment-method-saved")).toContainText(
    "Demo bank account · 0000",
  );
  await expect(
    page.getByRole("checkbox", { name: /I understand/ }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Pay with demo bank account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Demo bank payment complete",
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() => window.sprint2Fixture.selectApproval("rejected"));
  await expect(
    page.getByRole("heading", { name: "Approval required", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".payment-success")).toHaveCount(0);
  await page.evaluate(() => window.sprint2Fixture.selectApproval("approved"));
  await choosePrivateFunding(page);
  await expect(methodTrigger(page)).toHaveAccessibleName(
    "Add demo payment method",
  );
  await expect(page.locator(".payment-success")).toHaveCount(0);
});
