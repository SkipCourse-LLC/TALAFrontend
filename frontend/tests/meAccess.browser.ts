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
        async signIn(email) { window.changeUser(email.split("@")[0]); },
        async sendPasswordReset(email) { window.resetRequests.push(email); if (window.failReset) throw new Error("failed"); },
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
      window.resetRequests = [];
      window.verificationRequests = 0;
      let listener;
      window.changeUser = (uid) => {
        const user = uid ? {uid, email: uid + "@example.test", displayName: uid, getIdToken: async () => uid} : null;
        window.testAuth.currentUser = user;
        listener?.(user);
      };
      export function onIdTokenChanged(auth, next) { listener = next; queueMicrotask(() => next(auth.currentUser)); return () => { listener = undefined; }; }
      export function getIdTokenResult() {}
      export async function sendEmailVerification() { window.verificationRequests++; }
      export async function reload() {}
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
  const consoleErrors: string[] = [];
  const requests: string[] = [];
  const mutations: Array<{ path: string; body: Record<string, unknown> }> = [];
  let failLink = false;
  let invalidProgress = false;
  let bookingOffline = false;
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route(
    "https://us-central1-skip-class-slsru4.cloudfunctions.net/**",
    async (route) => {
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization,content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      };
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers });
        return;
      }
      const url = new URL(route.request().url());
      const uid = route
        .request()
        .headers()
        .authorization?.replace("Bearer ", "");
      if (!url.pathname.includes("/me-access/")) {
        requests.push(`${url.pathname}${url.search}|${uid}`);
        if (url.pathname.endsWith("/tala-admissions/students")) {
          await route.fulfill({
            headers,
            json: {
              students: [
                { uid: "linked-student", email: "linked-student@example.test" },
              ],
            },
          });
          return;
        }
        if (url.pathname.includes("/tala-admissions/students/")) {
          const json = url.pathname.endsWith("/projects")
            ? {
                student_id: "linked-student",
                projects: [{ job_id: "p", essay_name: "Family project" }],
              }
            : {
                student_id: "linked-student",
                courses: [
                  {
                    course: "Family science",
                    standards_count: 2,
                    average_grade: 85,
                  },
                ],
              };
          await route.fulfill({ headers, json });
          return;
        }
        if (
          url.pathname.endsWith("/tala-admissions/accounts") ||
          url.pathname.endsWith("/tala-admissions/relationships")
        ) {
          const body = route.request().postDataJSON() as Record<
            string,
            unknown
          >;
          mutations.push({ path: url.pathname, body });
          if (url.pathname.endsWith("/relationships") && failLink) {
            await route.fulfill({
              status: 409,
              headers,
              json: { error: "relationship_requires_review" },
            });
          } else {
            await route.fulfill({
              headers,
              json: url.pathname.endsWith("/accounts")
                ? {
                    uid: String(body.email).split("@")[0],
                    created: true,
                  }
                : { status: "active", created: true },
            });
          }
          return;
        }
        if (url.pathname.includes("/tala-")) {
          if (url.pathname.endsWith("/tala-booking") && bookingOffline) {
            await route.abort("failed");
            return;
          }
          await route.fulfill({
            status: 404,
            headers,
            body: "Service not found",
          });
          return;
        }
        let json: object;
        if (url.pathname.endsWith("/get-student-profile")) {
          json = {
            student_id: uid,
            courses: [
              { course: "Science", standards_count: 2, average_grade: 85 },
            ],
            completed_jobs: 1,
          };
        } else if (url.pathname.endsWith("/get-course-progress")) {
          json = invalidProgress
            ? { error: "Unexpected response" }
            : {
                student_id: uid,
                courses: [
                  {
                    course: "Mathematics",
                    standards_count: 3,
                    average_grade: 90,
                  },
                ],
              };
        } else if (url.pathname.endsWith("/list-student-projects")) {
          json = {
            student_id: uid,
            projects: [
              {
                job_id: "one",
                essay_name: "My project",
                standards_count: 2,
                average_grade: 80,
              },
            ],
          };
        } else if (url.pathname.endsWith("/relationships/stats")) {
          json = { total_relationships: 4, by_type: {} };
        } else if (url.pathname.endsWith("/get-aggregate-admin-stats")) {
          json = { found_job_count: 7 };
        } else {
          await route.fulfill({ status: 404, headers });
          return;
        }
        await route.fulfill({ headers, json }).catch(() => {});
        return;
      }
      if (uid === "denied") {
        await route.fulfill({ status: 403, headers });
        return;
      }
      if (uid === "unverified") {
        await route.fulfill({
          status: 403,
          headers,
          json: { error: "email_not_verified" },
        });
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
  await page.getByLabel("Email", { exact: true }).fill("student@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("secret-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Student dashboard:/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await changeUser("unverified");
  await expect(
    page.getByText("Verify your email address before opening your dashboard."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(page.getByText(/Verification email requested/)).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { verificationRequests: number })
          .verificationRequests,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "Sign out" }).click();
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
    page.getByRole("heading", { name: /Student dashboard:/ }),
  ).toBeVisible();
  await expect(page).toHaveTitle(
    "Student dashboard | Tucson Adaptive Learning Academy",
  );
  await expect(page.getByRole("alert").first()).toContainText("404");
  await expect(page.getByText("Science", { exact: true })).toBeVisible();
  await expect(page.getByText("My project", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      consoleErrors.some((text) =>
        text.includes("[TALA dashboard] Calendar fetch failed (http 404)"),
      ),
    )
    .toBe(true);
  expect(
    requests.some((value) =>
      value.includes("/get-course-progress?student_id=student|student"),
    ),
  ).toBe(true);
  await page
    .getByRole("navigation", { name: "Workspace sections" })
    .first()
    .getByRole("button", { name: "Evidence", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Evidence", exact: true, level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Evidence", exact: true, level: 2 }),
  ).toBeFocused();
  await expect(page.getByText("My project", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace sections" })
    .first()
    .getByRole("button", { name: "Progress", exact: true })
    .click();
  invalidProgress = true;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(
    page.getByText("The service response did not match the expected contract."),
  ).toBeVisible();
  expect(
    consoleErrors.some((text) =>
      text.includes("Course progress fetch failed (invalid-response"),
    ),
  ).toBe(true);
  invalidProgress = false;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Mathematics", { exact: true })).toBeVisible();
  bookingOffline = true;
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Sections: Progress").click();
  await page
    .locator(".server-dashboard-mobile-links")
    .getByRole("button", { name: "Meetings" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Meetings", level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Meetings", level: 2 }),
  ).toBeFocused();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Progress", exact: true, level: 2 }),
  ).toBeFocused();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Meetings", exact: true, level: 2 }),
  ).toBeFocused();
  await expect(page.getByRole("alert").first()).toContainText("network");
  expect(
    consoleErrors.some((text) =>
      text.includes("Booking fetch failed (network"),
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/dashboard/admin");
  await expect(
    page.getByRole("heading", { name: /Student dashboard:/ }),
  ).toBeVisible();
  await changeUser("parent");
  await expect(
    page.getByRole("heading", { name: /Parent dashboard:/ }),
  ).toBeVisible();
  await expect(page).toHaveTitle(
    "Parent dashboard | Tucson Adaptive Learning Academy",
  );
  await expect(
    page.getByRole("option", { name: "linked-student@example.test" }),
  ).toHaveAttribute("value", "linked-student");
  await page
    .getByLabel("View student records (read-only)")
    .selectOption("linked-student");
  await expect(page.getByText("Family project", { exact: true })).toBeVisible();
  expect(
    requests.some((value) =>
      value.includes(
        "/tala-admissions/students/linked-student/projects|parent",
      ),
    ),
  ).toBe(true);
  await expect(page.getByText("My project", { exact: true })).toHaveCount(0);
  await changeUser("slow");
  await requestStarted;
  await expect(page.getByText("Checking your account access…")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Parent dashboard:/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  release();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await changeUser("admin");
  await expect(
    page.getByRole("heading", { name: /Admin dashboard:/ }),
  ).toBeVisible();
  await expect(page).toHaveTitle(
    "Admin dashboard | Tucson Adaptive Learning Academy",
  );
  await expect(page.getByText("4 relationships.")).toBeVisible();
  await page
    .getByLabel("Parent email addresses, one per line")
    .fill("family@example.test\nfamily2@example.test");
  await page
    .getByLabel("Student email addresses, one per line")
    .fill("learner@example.test\nlearner2@example.test");
  await page
    .getByLabel("Date and time consent was obtained from family@example.test")
    .fill("2025-01-01T10:00");
  await page
    .getByLabel("Date and time consent was obtained from family2@example.test")
    .fill("2025-01-02T10:00");
  await page.getByLabel(/I attest that the listed family/).check();
  await page.getByLabel(/I understand existing accounts/).check();
  failLink = true;
  await page.getByRole("button", { name: "Set up family accounts" }).click();
  await expect(
    page.getByText(
      /existing inactive or revoked relationship requires manual review/,
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { resetRequests: string[] }).resetRequests,
    ),
  ).toEqual([]);
  failLink = false;
  await page.getByRole("button", { name: "Set up family accounts" }).click();
  await expect(
    page.getByText(/Firebase accepted the password-reset requests/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { resetRequests: string[] }).resetRequests,
    ),
  ).toEqual([
    "family@example.test",
    "family2@example.test",
    "learner@example.test",
    "learner2@example.test",
  ]);
  const links = mutations
    .filter((item) => item.path.endsWith("/relationships"))
    .slice(1)
    .map((item) => item.body);
  expect(links).toEqual([
    {
      parent_uid: "family",
      student_uid: "learner",
      consent_attested: true,
      consent_given_at: new Date("2025-01-01T10:00").toISOString(),
    },
    {
      parent_uid: "family",
      student_uid: "learner2",
      consent_attested: true,
      consent_given_at: new Date("2025-01-01T10:00").toISOString(),
    },
    {
      parent_uid: "family2",
      student_uid: "learner",
      consent_attested: true,
      consent_given_at: new Date("2025-01-02T10:00").toISOString(),
    },
    {
      parent_uid: "family2",
      student_uid: "learner2",
      consent_attested: true,
      consent_given_at: new Date("2025-01-02T10:00").toISOString(),
    },
  ]);
  await page.evaluate(() => {
    (window as unknown as { failReset: boolean }).failReset = true;
  });
  await page.getByRole("button", { name: "Set up family accounts" }).click();
  await expect(
    page.getByText(/Password reset requests failed for:/),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { failReset: boolean }).failReset = false;
  });
  await page.getByRole("button", { name: "Learning summaries" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Learning summaries",
      exact: true,
      level: 2,
    }),
  ).toBeFocused();
  await expect(
    page.getByText("7 assessments in the last 30 days."),
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
    page.getByRole("heading", { name: /Student dashboard:/ }),
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
