import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const projectId = "demo-tala-local";
const authBase = "http://127.0.0.1:9099";
const authEndpoint = `${authBase}/identitytoolkit.googleapis.com/v1/accounts:`;
const accounts: Array<{ email: string; password: string; uid?: string }> = [];
const rejectedExternalRequests: string[] = [];

function assertLocalOnly() {
  for (const [key, expected] of Object.entries({
    GCLOUD_PROJECT: projectId,
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
    STORAGE_EMULATOR_HOST: "http://127.0.0.1:9199",
  })) {
    if (process.env[key] !== expected)
      throw new Error(
        "Browser integration cleanup requires the isolated loopback Firebase Emulators.",
      );
  }
}

// Delete only this run's generated synthetic UIDs, files, receipts and bookings.
// Explicit loopback REST requests avoid Admin SDK ADC or metadata discovery.
async function cleanupSyntheticAccounts(request: APIRequestContext) {
  assertLocalOnly();
  const database = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
  const ownerHeaders = { Authorization: "Bearer owner" }; // Local Emulator admin marker, not a production credential.
  type StoredDocument = {
    name: string;
    fields: Record<string, { stringValue?: string }>;
  };
  for (const account of accounts.splice(0)) {
    const identityResponse = await request.post(
      `${authEndpoint}signInWithPassword?key=demo-emulator-key`,
      {
        data: {
          email: account.email,
          password: account.password,
          returnSecureToken: true,
        },
      },
    );
    if (!identityResponse.ok()) continue;
    const identity = (await identityResponse.json()) as {
      localId: string;
      idToken: string;
    };
    const uid = identity.localId;
    if (account.uid && account.uid !== uid)
      throw new Error("Synthetic cleanup identity changed.");
    for (const name of [
      "tala_local_appointments",
      "tala_local_uploads",
      "tala_local_evidence",
      "tala_local_requests",
    ]) {
      const response = await request.post(`${database}:runQuery`, {
        headers: ownerHeaders,
        data: {
          structuredQuery: {
            from: [{ collectionId: name }],
            where: {
              fieldFilter: {
                field: { fieldPath: "ownerUid" },
                op: "EQUAL",
                value: { stringValue: uid },
              },
            },
          },
        },
      });
      expect(response.ok(), "Scoped local cleanup query should succeed").toBe(
        true,
      );
      const rows = (await response.json()) as Array<{
        document?: StoredDocument;
      }>;
      for (const { document: record } of rows) {
        if (!record || record.fields.ownerUid?.stringValue !== uid) continue;
        const id = record.name.split("/").at(-1)!;
        if (
          name === "tala_local_appointments" &&
          record.fields.status?.stringValue === "reserved"
        ) {
          const slotId = record.fields.slotId?.stringValue;
          const slotUrl = `${database}/tala_local_slots/${slotId}`;
          const slotResponse = await request.get(slotUrl, {
            headers: ownerHeaders,
          });
          const slot = (await slotResponse.json()) as StoredDocument;
          if (
            slotResponse.ok() &&
            slot.fields.appointmentId?.stringValue === id
          ) {
            const released = await request.patch(
              `${slotUrl}?updateMask.fieldPaths=isAvailable&updateMask.fieldPaths=appointmentId`,
              {
                headers: ownerHeaders,
                data: {
                  fields: {
                    isAvailable: { booleanValue: true },
                    appointmentId: { nullValue: "NULL_VALUE" },
                  },
                },
              },
            );
            expect(
              released.ok(),
              "Only this test's occupied slot should be released",
            ).toBe(true);
          }
        }
        const storagePath = record.fields.storagePath?.stringValue;
        if (
          storagePath &&
          ((name === "tala_local_uploads" &&
            storagePath.startsWith(`tala-local-evidence/${uid}/`)) ||
            (name === "tala_local_evidence" &&
              storagePath.startsWith(`tala-local-evidence-private/${uid}/`)))
        ) {
          const deleted = await request.delete(
            `http://127.0.0.1:9199/v0/b/${projectId}.appspot.com/o/${encodeURIComponent(storagePath)}`,
            { headers: ownerHeaders },
          );
          expect(
            deleted.ok() || deleted.status() === 404,
            "Only this test's private file should be removed",
          ).toBe(true);
        }
        const deleted = await request.delete(`${database}/${name}/${id}`, {
          headers: ownerHeaders,
        });
        expect(deleted.ok()).toBe(true);
      }
    }
    for (const path of [
      `users/${uid}`,
      `tala_local_progress/${uid}`,
      `tala_local_booking_locks/${uid}`,
    ]) {
      const response = await request.delete(`${database}/${path}`, {
        headers: ownerHeaders,
      });
      expect(response.ok() || response.status() === 404).toBe(true);
    }
    const deletedAccount = await request.post(
      `${authEndpoint}delete?key=demo-emulator-key`,
      { data: { idToken: identity.idToken } },
    );
    expect(
      deletedAccount.ok(),
      "Only the generated synthetic account should be deleted",
    ).toBe(true);
  }
}

async function signup(page: Page, request: APIRequestContext) {
  const suffix = randomUUID();
  const account = {
    email: `browser-${suffix}@example.test`,
    password: `Synthetic-${suffix}`,
    uid: undefined as string | undefined,
  };
  accounts.push(account);
  await page.goto("/#/register");
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Synthetic browser learner");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page
    .getByRole("button", { name: "Create test account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Account verification", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Complete local profile setup",
      exact: true,
    }),
  ).toHaveCount(0);
  const response = await request.post(
    `${authEndpoint}signInWithPassword?key=demo-emulator-key`,
    {
      data: {
        email: account.email,
        password: account.password,
        returnSecureToken: true,
      },
    },
  );
  expect(
    response.ok(),
    "Synthetic account should exist in the Auth Emulator",
  ).toBe(true);
  account.uid = ((await response.json()) as { localId: string }).localId;
  return account;
}

async function verifyLocalEmail(
  page: Page,
  request: APIRequestContext,
  email: string,
) {
  // Only the local Emulator exposes OOB codes. No link, code or token is logged.
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `${authBase}/emulator/v1/projects/${projectId}/oobCodes`,
        );
        if (!response.ok()) return false;
        const result = (await response.json()) as {
          oobCodes?: Array<{
            email: string;
            requestType: string;
            oobCode: string;
          }>;
        };
        code = result.oobCodes
          ?.filter(
            (entry) =>
              entry.email === email && entry.requestType === "VERIFY_EMAIL",
          )
          .slice(-1)[0]?.oobCode;
        return !!code;
      },
      {
        message:
          "Local Auth Emulator should issue an email verification action",
      },
    )
    .toBe(true);
  const response = await request.post(
    `${authEndpoint}update?key=demo-emulator-key`,
    { data: { oobCode: code } },
  );
  expect(response.ok(), "Local verification action should be accepted").toBe(
    true,
  );
  await page
    .getByRole("button", { name: "I have verified my email", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your learning workspace", exact: true }),
  ).toBeVisible();
  const claims = await page.evaluate(async () => {
    const modulePath = "/src/backend/firebaseClient.ts";
    const { getFirebaseClient } = await import(modulePath);
    const result =
      await getFirebaseClient().auth.currentUser.getIdTokenResult();
    return {
      role: result.claims.role,
      emailVerified: result.claims.email_verified,
    };
  });
  expect(
    claims,
    "Signed token claims must reflect server provisioning and verified email",
  ).toEqual({ role: "student", emailVerified: true });
  await expect
    .poll(() => page.locator(".firebase-workspace-error").allTextContents(), {
      message:
        "Workspace loading must not report an authorization or contract error",
    })
    .toEqual([]);
  await expect(
    page.getByText("Loading your saved records…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Available times", { exact: true }),
  ).toBeEnabled();
}

async function selectAvailableTime(page: Page) {
  const select = page.getByLabel(/Available times|Choose a different time/);
  await expect(select).toBeEnabled();
  const value = await select.locator("option").nth(1).getAttribute("value");
  expect(!!value, "At least one seeded local time should be available").toBe(
    true,
  );
  await select.selectOption(value!);
  return value;
}

test.beforeEach(async ({ context }) => {
  rejectedExternalRequests.length = 0;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
    ) {
      await route.continue();
    } else {
      // Store only the hostname, never URLs, query parameters or headers.
      rejectedExternalRequests.push(url.hostname);
      await route.abort();
    }
  });
});
test.afterEach(async ({ request }) => {
  await cleanupSyntheticAccounts(request);
  expect(
    [...new Set(rejectedExternalRequests)],
    "Application must never contact live Firebase or external services in these tests",
  ).toEqual([]);
});

test("SDK signup provisions a UID profile, keeps unverified workflows locked, and restores the session after refresh", async ({
  page,
  request,
}) => {
  await signup(page, request);
  await expect(
    page.getByText("Verify your email before booking or submitting evidence.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Finish your account setup",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Book selected time", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Account verification", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Finish your account setup",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sign out of Firebase", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
  await page.goto("/#/dashboard");
  await expect(
    page.getByRole("heading", { name: "Welcome back.", exact: true }),
  ).toBeVisible();
});

test("verified booking, atomic reschedule, private Evidence and profile persist; payment stays unavailable", async ({
  page,
  request,
}) => {
  const account = await signup(page, request);
  await verifyLocalEmail(page, request, account.email);
  const firstSlot = await selectAvailableTime(page);
  await page
    .getByRole("button", { name: "Book selected time", exact: true })
    .click();
  await expect(page.getByText("Booking saved", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your booking was saved by the local backend." }),
  ).toBeVisible();
  const secondSlot = await selectAvailableTime(page);
  expect(secondSlot !== firstSlot).toBe(true);
  await page
    .getByRole("button", { name: "Change booking", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your booking was changed and saved" }),
  ).toBeVisible();
  await page
    .getByLabel("Evidence title", { exact: true })
    .fill("Synthetic learning reflection");
  await page.getByLabel("Synthetic test file", { exact: true }).setInputFiles({
    name: "synthetic-reflection.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Synthetic learning evidence only. A test learner practiced explaining a solution. No real personal data.",
    ),
  });
  await page
    .getByLabel(
      "This file contains only synthetic test data and no real personal information.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", { name: "Submit Evidence", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your Evidence was submitted" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic learning reflection",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(".firebase-workspace-progress > div")
      .filter({ hasText: "Evidence submitted" })
      .locator("dd"),
  ).toHaveText("1");
  await expect(
    page
      .locator(".firebase-workspace-progress > div")
      .filter({ hasText: "Evidence assessed" })
      .locator("dd"),
  ).toHaveText("0");
  await expect(
    page.getByLabel("Synthetic test file", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Updated synthetic learner");
  await page
    .getByRole("button", { name: "Save display name", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your display name was saved" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic learning reflection",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(
    "Updated synthetic learner",
  );
  await expect(
    page
      .locator(".firebase-workspace-progress > div")
      .filter({ hasText: "Evidence submitted" })
      .locator("dd"),
  ).toHaveText("1");
  await page
    .getByRole("link", { name: "View payment integration status", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Payment/i }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Complete payment|Pay now|Save card/i }),
  ).toHaveCount(0);
  await expect(
    page.locator(
      "input[autocomplete='cc-number'], input[autocomplete='cc-csc']",
    ),
  ).toHaveCount(0);
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic learning reflection",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your booking was cancelled" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel booking", exact: true }),
  ).toHaveCount(0);
});

test("wrong credentials are announced, UID isolation holds, and mobile keyboard layouts meet scoped accessibility checks", async ({
  page,
  request,
}) => {
  await page.goto("/#/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`missing-${randomUUID()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-wrong-credentials");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const error = page.getByRole("alert");
  await expect(error).toContainText("The email or password was not accepted.");
  await expect(error).toBeFocused();
  const account = await signup(page, request);
  await verifyLocalEmail(page, request, account.email);
  const signIn = await request.post(
    `${authEndpoint}signInWithPassword?key=demo-emulator-key`,
    {
      data: {
        email: account.email,
        password: account.password,
        returnSecureToken: true,
      },
    },
  );
  expect(signIn.ok()).toBe(true);
  const identity = (await signIn.json()) as { idToken: string };
  const denied = await request.get(
    `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents/users/unowned-${randomUUID()}`,
    {
      headers: { Authorization: `Bearer ${identity.idToken}` },
    },
  );
  expect(
    denied.status(),
    "Another user's profile must be denied by actual Emulator Rules",
  ).toBe(403);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(
      page.getByRole("heading", {
        name: "Your learning workspace",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `${width}px layout should not overflow horizontally`,
    ).toBe(true);
    await page.getByLabel("Available times", { exact: true }).focus();
    await expect(
      page.getByLabel("Available times", { exact: true }),
    ).toBeFocused();
    const violations = (
      await new AxeBuilder({ page })
        .include(".firebase-workspace")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations;
    expect(
      violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        targets: item.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  }
  await selectAvailableTime(page);
  await page.getByLabel("Available times", { exact: true }).focus();
  await page.keyboard.press("Tab");
  const bookButton = page.getByRole("button", {
    name: "Book selected time",
    exact: true,
  });
  await expect(bookButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Booking saved", { exact: true })).toBeVisible();
  const status = page
    .getByRole("status")
    .filter({ hasText: "Your booking was saved" });
  await expect(status).toBeFocused();
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your booking was cancelled" }),
  ).toBeVisible();
});
