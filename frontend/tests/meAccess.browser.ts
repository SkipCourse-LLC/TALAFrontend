import { expect, test } from "@playwright/test";

test("role routing fails closed across identity changes and sign out", async ({
  page,
}) => {
  await page.route("**/src/backend/liveFirebase.ts*", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
      export const getLiveAuth = async () => window.testAuth;
    `,
    });
  });
  await page.route(
    "**/node_modules/.vite/deps/firebase_auth.js*",
    async (route) => {
      await route.fulfill({
        contentType: "application/javascript",
        body: `
      window.testAuth = { currentUser: null };
      let listener;
      window.changeUser = (uid) => {
        const user = uid ? { uid, email: uid + "@example.test", displayName: uid, getIdToken: async () => uid } : null;
        window.testAuth.currentUser = user;
        listener?.(user);
      };
      export function onIdTokenChanged(auth, next) { listener = next; queueMicrotask(() => next(auth.currentUser)); return () => { listener = undefined; }; }
      export async function signOut() { if (window.failSignOut) throw new Error("offline"); window.changeUser(null); }
      export async function signInWithEmailAndPassword() {}
      export function getMultiFactorResolver() {}
      export const TotpMultiFactorGenerator = {};
    `,
      });
    },
  );
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  await page.route(
    "https://us-central1-skip-class-slsru4.cloudfunctions.net/**",
    async (route) => {
      const request = route.request();
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization",
        "access-control-allow-methods": "GET, OPTIONS",
      };
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers });
        return;
      }
      const token = request.headers().authorization?.replace("Bearer ", "");
      if (token === "denied") {
        await route.fulfill({ status: 403, headers });
        return;
      }
      if (token === "slow") {
        requestStarted();
        await delayed;
      }
      const role =
        token === "admin"
          ? "talaadmin"
          : token === "parent"
            ? "parent"
            : "student";
      await route
        .fulfill({
          status: 200,
          headers,
          json: { uid: token, school: "tala", role, email_verified: true },
        })
        .catch(() => {});
    },
  );
  await page.goto("/#/login");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { changeUser: (uid: string | null) => void }
    ).changeUser("student"),
  );
  await expect(
    page.getByRole("heading", { name: "Student dashboard" }),
  ).toBeVisible();
  await page.goto("/#/dashboard/admin");
  await expect(
    page.getByRole("heading", { name: "Student dashboard" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { changeUser: (uid: string | null) => void }
    ).changeUser("parent"),
  );
  await expect(
    page.getByRole("heading", { name: "Parent dashboard" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { changeUser: (uid: string | null) => void }
    ).changeUser("slow"),
  );
  await started;
  await expect(page.getByText("Checking your account access…")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Parent dashboard" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  release();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { changeUser: (uid: string | null) => void }
    ).changeUser("admin"),
  );
  await expect(
    page.getByRole("heading", { name: "Admin dashboard" }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { failSignOut: boolean }).failSignOut = true;
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByText("Sign out failed. Please try again."),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { changeUser: (uid: string | null) => void }
    ).changeUser("student"),
  );
  await expect(
    page.getByText("Sign out failed. Please try again."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Student dashboard" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { failSignOut: boolean }).failSignOut = false;
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { changeUser: (uid: string | null) => void }
    ).changeUser("denied"),
  );
  await expect(
    page.getByRole("heading", { name: "Account access unavailable" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});
