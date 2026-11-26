import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

function firestoreFields(
  values: Record<string, unknown>,
): Record<string, unknown> {
  function value(input: unknown): unknown {
    if (input instanceof Date) return { timestampValue: input.toISOString() };
    if (typeof input === "string") return { stringValue: input };
    if (typeof input === "number") return { integerValue: String(input) };
    if (Array.isArray(input))
      return { arrayValue: { values: input.map(value) } };
    if (input && typeof input === "object")
      return {
        mapValue: { fields: firestoreFields(input as Record<string, unknown>) },
      };
    throw new Error("Unsupported synthetic fixture field.");
  }
  return Object.fromEntries(
    Object.entries(values).map(([key, input]) => [key, value(input)]),
  );
}

test.beforeEach(async ({ context }) => {
  // Fail immediately if browser code attempts cloud access. Only hostnames are
  // retained in failures; URLs, headers and authentication payloads are private.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["data:", "blob:"].includes(url.protocol)
    ) {
      await route.continue();
      return;
    }
    await route.abort();
    throw new Error(`Unexpected external service hostname: ${url.hostname}`);
  });
});

test("cloud configuration is isolated and fails closed before SDK network access", async ({
  page,
}) => {
  await page.goto("/#/login");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/backend/firebaseConfiguration.ts";
    const { resolveFirebaseConfiguration } = await import(modulePath);
    // Deliberately invented public Web App identifiers. These are never passed
    // to initializeApp(), so this test needs no cloud access or credentials.
    const approved: Record<string, string> = {
      VITE_BACKEND_MODE: "firebase-test",
      VITE_FIREBASE_TEST_APPROVED: "true",
      VITE_FIREBASE_TEST_PROJECT_ID: "tala-isolated-test",
      VITE_FIREBASE_PROJECT_ID: "tala-isolated-test",
      VITE_FIREBASE_API_KEY: "synthetic-public-config-only",
      VITE_FIREBASE_AUTH_DOMAIN: "tala-isolated-test.firebaseapp.com",
      VITE_FIREBASE_APP_ID: "1:123456789:web:abcdef0123456789",
      VITE_FIREBASE_STORAGE_BUCKET: "tala-isolated-test.firebasestorage.app",
      VITE_FIREBASE_TEST_STORAGE_BUCKET:
        "tala-isolated-test.firebasestorage.app",
      VITE_FIREBASE_FUNCTIONS_REGION: "us-central1",
    };
    const rejected: Record<string, Record<string, string>> = {
      missingApproval: { VITE_FIREBASE_TEST_APPROVED: "false" },
      productionProject: {
        VITE_FIREBASE_TEST_PROJECT_ID: "skip-class-slsru4",
        VITE_FIREBASE_PROJECT_ID: "skip-class-slsru4",
      },
      mismatchedProject: { VITE_FIREBASE_PROJECT_ID: "unapproved-project" },
      mismatchedBucket: {
        VITE_FIREBASE_STORAGE_BUCKET: "unapproved-project.appspot.com",
      },
      emulatorDestination: {
        VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
      },
      legacyProductionApproval: { VITE_FIREBASE_PRODUCTION_APPROVED: "true" },
      legacyProductionMode: {
        VITE_BACKEND_MODE: "firebase",
        VITE_FIREBASE_PRODUCTION_APPROVED: "true",
      },
    };
    const decisions = Object.fromEntries(
      Object.entries(rejected).map(([name, patch]) => {
        try {
          resolveFirebaseConfiguration({ ...approved, ...patch }, "localhost");
          return [name, false];
        } catch {
          return [name, true];
        }
      }),
    );
    const valid = resolveFirebaseConfiguration(approved, "localhost");
    return {
      decisions,
      approved: {
        mode: valid.mode,
        projectId: valid.options.projectId,
        namespace: valid.namespace,
        hasEmulator: Boolean(valid.emulator),
      },
    };
  });
  expect(result.decisions).toEqual({
    missingApproval: true,
    productionProject: true,
    mismatchedProject: true,
    mismatchedBucket: true,
    emulatorDestination: true,
    legacyProductionApproval: true,
    legacyProductionMode: true,
  });
  expect(result.approved).toEqual({
    mode: "firebase-test",
    projectId: "tala-isolated-test",
    namespace: {
      collectionsPrefix: "tala_test_",
      evidenceRoot: "tala-test-evidence",
    },
    hasEmulator: false,
  });
});

test("failed real sign-in cannot reuse a demo identity or grant protected payment access", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    sessionStorage.setItem(
      "tala.frontend-demo.session",
      JSON.stringify({
        mode: "demo",
        role: "Staff",
        name: "Synthetic preview identity",
        email: "preview@example.test",
      }),
    );
  });
  await page.goto("/#/payment");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic preview identity")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Complete payment|Pay now|Save card/i }),
  ).toHaveCount(0);
  let rejectedAuthRequests = 0;
  await context.route("http://127.0.0.1:9099/**", async (route) => {
    rejectedAuthRequests++;
    await route.abort("connectionfailed");
  });
  await page.getByLabel("Email", { exact: true }).fill("offline@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-offline-only-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const error = page.getByRole("alert");
  await expect(error).toContainText(
    "The authentication service could not be reached.",
  );
  await expect(error).toBeFocused();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  expect(rejectedAuthRequests > 0).toBe(true);
  const leakedPassword = await page.evaluate(() =>
    [localStorage, sessionStorage].some((storage) =>
      Object.values(storage).some((value) =>
        String(value).includes("Synthetic-offline-only-123"),
      ),
    ),
  );
  expect(leakedPassword, "Application storage must not retain a password").toBe(
    false,
  );
  await page.goto("/#/dashboard");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your learning workspace", exact: true }),
  ).toHaveCount(0);
});

test("published learning review persists and family access ignores unconfirmed legacy profile links", async ({
  page,
  request,
}) => {
  const projectId = "demo-tala-local";
  const authEndpoint =
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:";
  const database = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
  const functions = `http://127.0.0.1:5001/${projectId}/us-central1/`;
  const headers = { Authorization: "Bearer owner" }; // Isolated Emulator admin marker only.
  const suffix = randomUUID();
  const account = {
    email: `learning-${suffix}@example.test`,
    password: `Synthetic-only-${suffix}`,
  };
  const recordId = `synthetic-record-${suffix}`;
  const outcomeId = "synthetic-outcome";
  const parentUid = `synthetic-parent-${suffix}`;
  const legacyParentUid = `synthetic-unconfirmed-${suffix}`;
  const relationshipId = `synthetic-family-${suffix}`;
  let uid = "";
  let token = "";
  async function seed(path: string, values: Record<string, unknown>) {
    const response = await request.patch(`${database}/${path}`, {
      headers,
      data: { fields: firestoreFields(values) },
    });
    expect(
      response.ok(),
      "Own synthetic Emulator fixture should be saved",
    ).toBe(true);
  }
  try {
    const created = await request.post(
      `${authEndpoint}signUp?key=demo-emulator-key`,
      {
        data: { ...account, returnSecureToken: true },
      },
    );
    expect(
      created.ok(),
      "Synthetic Auth Emulator account should be created",
    ).toBe(true);
    const identity = (await created.json()) as {
      localId: string;
      idToken: string;
    };
    uid = identity.localId;
    token = identity.idToken;
    const provisioned = await request.post(`${functions}provisionTalaStudent`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { data: { displayName: "Synthetic learning reviewer" } },
    });
    expect(
      provisioned.ok(),
      "Local backend must provision the synthetic UID",
    ).toBe(true);
    const emailAction = await request.post(
      `${authEndpoint}sendOobCode?key=demo-emulator-key`,
      {
        data: { idToken: token, requestType: "VERIFY_EMAIL" },
      },
    );
    expect(emailAction.ok()).toBe(true);
    const actionsResponse = await request.get(
      `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/oobCodes`,
    );
    expect(actionsResponse.ok()).toBe(true);
    const actions = (await actionsResponse.json()) as {
      oobCodes?: Array<{ email: string; requestType: string; oobCode: string }>;
    };
    const code = actions.oobCodes
      ?.filter(
        (entry) =>
          entry.email === account.email && entry.requestType === "VERIFY_EMAIL",
      )
      .at(-1)?.oobCode;
    expect(Boolean(code), "Local verification action should exist").toBe(true);
    const verified = await request.post(
      `${authEndpoint}update?key=demo-emulator-key`,
      {
        data: { oobCode: code },
      },
    );
    expect(verified.ok()).toBe(true);

    const now = new Date();
    await seed(`tala_local_appointments/${recordId}`, {
      ownerUid: uid,
      slotId: `synthetic-slot-${suffix}`,
      status: "ended",
      startAt: new Date(now.getTime() - 3_600_000),
      endAt: new Date(now.getTime() - 1_800_000),
      meetingIntegration: "unavailable",
      updatedAt: now,
    });
    // Administrative fixture publication is explicit; the student UI cannot
    // create records, claim attendance or generate a simulated AI assessment.
    await seed(`tala_local_meeting_records/${recordId}`, {
      ownerUid: uid,
      appointmentId: recordId,
      status: "published",
      attendance: "not_recorded",
      source: "staff",
      revision: 1,
      outcomes: [
        {
          id: outcomeId,
          summary: "Synthetic staff summary: practiced explaining a solution.",
          publishedAt: now,
        },
      ],
      acknowledgedOutcomeIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await seed(`users/${parentUid}`, {
      role: "parent",
      displayName: "Confirmed synthetic parent",
    });
    await seed(`users/${legacyParentUid}`, {
      role: "parent",
      displayName: "Unconfirmed synthetic parent",
    });
    await seed(`tala_local_relationships/${relationshipId}`, {
      student_id: uid,
      principal_id: parentUid,
      principal_role: "parent",
      relationship_type: "student_parent",
      status: "active",
      confirmedBy: "synthetic-fixture-operator",
      confirmedAt: now,
      consent: {
        status: "recorded",
        scope: "family_learning_view",
        recordedAt: now,
      },
    });
    const legacyLink = await request.patch(
      `${database}/users/${uid}?updateMask.fieldPaths=parentIds`,
      {
        headers,
        data: { fields: firestoreFields({ parentIds: [legacyParentUid] }) },
      },
    );
    expect(legacyLink.ok()).toBe(true);

    await page.goto("/#/login");
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const learning = page.getByRole("region", {
      name: "Meeting records and learning outcomes",
      exact: true,
    });
    await expect(
      learning.getByText(
        "Synthetic staff summary: practiced explaining a solution.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      learning.getByText("Attendance has not been confirmed.", { exact: true }),
    ).toBeVisible();
    const family = page.getByRole("region", {
      name: "Family connections",
      exact: true,
    });
    await expect(family).toContainText("Confirmed synthetic parent");
    await expect(family).not.toContainText("Unconfirmed synthetic parent");
    await learning
      .getByRole("button", { name: "Mark as reviewed", exact: true })
      .click();
    await expect(
      learning.getByText("Reviewed by you · Saved", { exact: true }),
    ).toBeVisible();
    const reviewedCount = page
      .locator(".firebase-workspace-progress > div")
      .filter({ hasText: "Outcomes reviewed" })
      .locator("dd");
    await expect(reviewedCount).toHaveText("1");
    await page.reload();
    await expect(
      learning.getByText("Reviewed by you · Saved", { exact: true }),
    ).toBeVisible();
    await expect(reviewedCount).toHaveText("1");
    await expect(
      learning.getByRole("button", { name: "Mark as reviewed", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .locator(".firebase-workspace-progress > div")
        .filter({ hasText: "Evidence assessed" })
        .locator("dd"),
    ).toHaveText("0");
  } finally {
    // Known generated paths only: no collection reset or production credential
    // discovery. The synthetic Auth token is never attached to any remote URL.
    if (uid) {
      const acknowledgementId = createHash("sha256")
        .update(`${uid}\0${recordId}\0${outcomeId}`)
        .digest("hex");
      for (const path of [
        `tala_local_meeting_records/${recordId}`,
        `tala_local_appointments/${recordId}`,
        `tala_local_outcome_acknowledgments/${acknowledgementId}`,
        `tala_local_relationships/${relationshipId}`,
        `tala_local_progress/${uid}`,
        `users/${uid}`,
        `users/${parentUid}`,
        `users/${legacyParentUid}`,
      ]) {
        const deleted = await request.delete(`${database}/${path}`, {
          headers,
        });
        expect(
          deleted.ok() || deleted.status() === 404,
          "Only this run's known synthetic fixture is removed",
        ).toBe(true);
      }
      const deleted = await request.post(
        `${authEndpoint}delete?key=demo-emulator-key`,
        { data: { idToken: token } },
      );
      expect(
        deleted.ok(),
        "Only the generated Auth Emulator account is removed",
      ).toBe(true);
    }
  }
});
