import { expect, test } from "@playwright/test";

test("Google sign-in and role changes fail closed until access is confirmed", async ({
  page,
}) => {
  await page.route("**/src/backend/firebaseClient.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
      export const backendMode = "firebase";
      export const getFirebaseClient = () => ({ready: Promise.resolve(), auth: window.testAuth});
    `,
    }),
  );
  await page.route("**/src/backend/firebaseAuth.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
      export class FirebaseMfaRequiredError extends Error {}
      export const safeFirebaseAuthError = () => ({message: "Authentication unavailable"});
      export const firebaseAuthService = {
        cancelMfaSignIn() {},
        async signInWithGoogle() {
          if (window.failLogin) throw new Error("offline");
          window.changeUser("student");
        },
        async signOut() {
          if (window.failSignOut) throw new Error("offline");
          window.changeUser(null);
        }
      };
    `,
    }),
  );
  await page.route("**/node_modules/.vite/deps/firebase_auth.js*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
      window.testAuth = {currentUser: null};
      let listener;
      window.changeUser = (uid) => {
        const user = uid ? {uid, email: uid + "@example.test", displayName: uid, getIdToken: async () => uid} : null;
        window.testAuth.currentUser = user;
        listener?.(user);
      };
      export function onIdTokenChanged(auth, next) { listener = next; queueMicrotask(() => next(auth.currentUser)); return () => { listener = undefined; }; }
      export function getIdTokenResult() {}
    `,
    }),
  );
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(
    "https://us-central1-skip-class-slsru4.cloudfunctions.net/**",
    async (route) => {
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization",
        "access-control-allow-methods": "GET, OPTIONS",
      };
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers });
        return;
      }
      const uid = route
        .request()
        .headers()
        .authorization?.replace("Bearer ", "");
      if (uid === "denied") {
        await route.fulfill({ status: 403, headers });
        return;
      }
      if (uid === "slow") {
        started();
        await delayed;
      }
      await route
        .fulfill({
          headers,
          json: {
            uid,
            school: "tala",
            role:
              uid === "admin"
                ? "talaadmin"
                : uid === "parent"
                  ? "parent"
                  : "student",
            email_verified: true,
          },
        })
        .catch(() => {});
    },
  );
  const changeUser = (uid: string | null) =>
    page.evaluate(
      (value) =>
        (
          window as unknown as { changeUser: (id: string | null) => void }
        ).changeUser(value),
      uid,
    );
  await page.goto("/#/login");
  await page.evaluate(() => {
    (window as unknown as { failLogin: boolean }).failLogin = true;
  });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Authentication unavailable",
  );
  await page.evaluate(() => {
    (window as unknown as { failLogin: boolean }).failLogin = false;
  });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(
    page.getByRole("heading", { name: "Student dashboard" }),
  ).toBeVisible();
  await expect(
    page.getByText("Dashboard data and classes are coming soon."),
  ).toBeVisible();
  await page.goto("/#/dashboard/admin");
  await expect(
    page.getByRole("heading", { name: "Student dashboard" }),
  ).toBeVisible();
  await changeUser("parent");
  await expect(
    page.getByRole("heading", { name: "Parent dashboard" }),
  ).toBeVisible();
  await changeUser("slow");
  await requestStarted;
  await expect(page.getByText("Checking your account access…")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Parent dashboard" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  release();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await changeUser("admin");
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
  await changeUser("student");
  await expect(
    page.getByRole("heading", { name: "Student dashboard" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { failSignOut: boolean }).failSignOut = false;
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await changeUser("denied");
  await expect(
    page.getByRole("heading", { name: "Account access unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Your account could not be authorized",
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});
