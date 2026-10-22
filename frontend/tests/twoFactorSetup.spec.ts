import jsQR from "jsqr";
import { URI } from "otpauth";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { registerDemoFamily, readAuthenticator } from "./signupHelpers";

test("2FA setup methods, account information and local authenticator provisioning", async ({
  page,
}, testInfo) => {
  let pageErrors = 0;
  let externalRequests = 0;
  page.on("pageerror", () => pageErrors++);
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173")) externalRequests++;
  });
  await registerDemoFamily(page);
  await expect(page.locator(".two-factor-account")).toContainText(
    "Taylor Parent",
  );
  await expect(page.locator(".two-factor-account")).toContainText(
    "taylor@example.com",
  );
  await expect(
    page.getByRole("radio", { name: /Authenticator app/ }),
  ).toBeChecked();
  await expect
    .poll(() =>
      page.getByRole("img", { name: /Scan this demo QR/ }).isVisible(),
    )
    .toBe(true);
  const authenticator = await readAuthenticator(page);
  const pixels = await page.evaluate(async () => {
    const img = document.querySelector<HTMLImageElement>(
      ".two-factor-qr-image",
    );
    if (!img) return null;
    try {
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(img, 0, 0);
      return {
        data: Array.from(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
        ),
        width: canvas.width,
        height: canvas.height,
      };
    } catch {
      return null;
    }
  });
  expect(pixels !== null).toBe(true);
  if (!pixels) throw new Error("Authenticator QR pixels are unavailable.");
  const decoded = jsQR(
    new Uint8ClampedArray(pixels.data),
    pixels.width,
    pixels.height,
  );
  expect(Boolean(decoded)).toBe(true);
  const matches = { secret: false, issuer: false, label: false };
  try {
    const scanned = URI.parse(decoded!.data);
    matches.secret = scanned.secret.base32 === authenticator.secret.base32;
    matches.issuer = scanned.issuer === "TALA Hub Demo";
    matches.label = scanned.label === "taylor@example.com";
  } catch {
    // Report failed checks only, never the URI.
  }
  expect(matches.secret).toBe(true);
  expect(matches.issuer).toBe(true);
  expect(matches.label).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.map(({ id, impact }) => ({ id, impact })),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("authenticator-setup.png"),
    mask: [page.locator(".two-factor-provisioning")],
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await expect(
    page.getByText("Selected method:", { exact: false }),
  ).toContainText("Authenticator app");
  await page.getByRole("button", { name: "Back to setup" }).click();
  expect(
    (await readAuthenticator(page)).secret.base32 ===
      authenticator.secret.base32,
  ).toBe(true);
  await page.getByRole("radio", { name: /Email code/ }).check();
  await expect
    .poll(
      async () =>
        (await page.getByRole("img", { name: /Scan this demo QR/ }).count()) ===
        0,
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Verify with an email code" }),
  ).toBeVisible();
  await expect(
    page.getByText("No message will be sent.", { exact: false }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.map(({ id, impact }) => ({ id, impact })),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("email-setup.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await expect(
    page.getByText("Selected method:", { exact: false }),
  ).toContainText("Email code");
  await page.getByRole("button", { name: "Back to setup" }).click();
  await expect(page.getByRole("radio", { name: /Email code/ })).toBeChecked();
  await page.getByRole("button", { name: "Continue to verification" }).click();
  await page.getByLabel("Verification code").fill("246810");
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your family demo is ready." }),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(/DEMO-ONLY|246810|challenge/.test(storage)).toBe(false);
  expect(pageErrors === 0).toBe(true);
  expect(externalRequests === 0).toBe(true);
});

test("Authenticator accepts a scanned code, rejects expired codes and never stores its secret", async ({
  page,
}) => {
  await registerDemoFamily(page);
  const authenticator = await readAuthenticator(page);
  await page.getByRole("button", { name: "Continue to verification" }).click();
  let expired = authenticator.generate({ timestamp: Date.now() - 300000 });
  // Avoid a chance collision with a currently valid six-digit code.
  for (
    let age = 330000;
    authenticator.validate({ token: expired, window: 2 }) !== null;
    age += 30000
  )
    expired = authenticator.generate({ timestamp: Date.now() - age });
  await page.getByLabel("Verification code").fill(expired);
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("expired");
  await page.getByLabel("Verification code").fill(authenticator.generate());
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your family demo is ready." }),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(storage.includes(authenticator.secret.base32)).toBe(false);
  await expect
    .poll(
      async () => (await page.locator(".two-factor-manual code").count()) === 0,
    )
    .toBe(true);
});
