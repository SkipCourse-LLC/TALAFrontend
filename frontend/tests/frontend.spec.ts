import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { completeDemoVerification } from "./signupHelpers";

const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});
test.afterEach(async ({ page }) => {
  expect(
    runtimeErrors.get(page),
    "No browser console or runtime errors",
  ).toEqual([]);
});

async function demoLogin(page: Page) {
  await page.goto("/#/login");
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hello, Alex." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your learning" }),
  ).toBeVisible();
}
async function dashboardView(page: Page, label: string) {
  const menu = page.locator(".dashboard-view-picker summary");
  if (await menu.isVisible()) {
    await menu.click();
    await page
      .getByRole("navigation", { name: "Student hub sections", exact: true })
      .getByRole("link", { name: label, exact: true })
      .click();
  } else {
    await page
      .getByRole("navigation", { name: "Dashboard", exact: true })
      .getByRole("link", { name: label, exact: true })
      .click();
  }
  await expect(page.locator("h1")).toHaveText(
    label === "Overview" ? /^Hello,/ : label,
  );
}
async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
}

test("public navigation, filters, refresh, history and not-found route", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Room to learn. Space to grow." }),
  ).toBeVisible();
  await expectNoOverflow(page);
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  const hasCollapsedMenu = await menu.isVisible();
  if (hasCollapsedMenu) await menu.click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Learn More", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A place for different ways to learn.",
    }),
  ).toBeVisible();
  if (hasCollapsedMenu)
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeHidden();
  await expectNoOverflow(page);
  await page
    .getByRole("link", { name: "Meet the learning opportunities" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Find a way to learn." }),
  ).toBeVisible();
  const mobileFilter = page.getByRole("combobox", {
    name: "Filter programs",
    exact: true,
  });
  if (await mobileFilter.isVisible())
    await mobileFilter.selectOption({ label: "Group courses" });
  else
    await page
      .getByRole("button", { name: "Group courses", exact: true })
      .click();
  await expect(
    page.getByRole("heading", { name: "Better, together" }),
  ).toBeVisible();
  await expect(page.locator(".program-detail")).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Find a way to learn." }),
  ).toBeVisible();
  if (await mobileFilter.isVisible())
    await expect(mobileFilter.locator("option:checked")).toHaveText(
      "Group courses",
    );
  else
    await expect(
      page.getByRole("button", { name: "Group courses", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  if (await mobileFilter.isVisible()) await mobileFilter.selectOption("all");
  else await page.getByRole("button", { name: "All opportunities" }).click();
  await expect(page.locator(".program-detail")).toHaveCount(4);
  await page.goBack();
  await expect(page.locator(".program-detail")).toHaveCount(1);
  await expectNoOverflow(page);
  await page.goto("/#/missing-page");
  await expect(
    page.getByRole("heading", { name: "A little off the path." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page).toHaveTitle("Room to grow | TALA");
  await page.goto("/#/programs?program=unknown");
  await expect(
    page.getByRole("heading", { name: "Find a way to learn." }),
  ).toBeVisible();
  if (await mobileFilter.isVisible())
    await expect(mobileFilter).toHaveValue("all");
  else
    await expect(
      page.getByRole("button", { name: "All opportunities" }),
    ).toHaveAttribute("aria-pressed", "true");
});

test("parent-first registration, review, recoverable failure and student login", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173"))
      externalRequests.push(request.url());
  });
  await page.goto("/");
  await page
    .getByRole("link", { name: "Start registration", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Parent name")).toBeFocused();
  await page.getByLabel("Parent name").fill("Sam Parent");
  await page.getByLabel("Parent email").fill("not-an-email");
  await page.getByLabel("Demo password", { exact: true }).fill("practice-only");
  await page.getByLabel("Confirm demo password").fill("different");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Parent email")).toBeFocused();
  await expect(page.getByText("Passwords must match.")).toBeVisible();
  await page.getByLabel("Parent email").fill("parent@example.com");
  await page.getByLabel("Confirm demo password").fill("practice-only");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Student information" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Student name")).toBeFocused();
  await page.getByLabel("Student name").fill("Sam Learner");
  await page.getByLabel("Student email").fill("sam@example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Learning preference").selectOption("Hybrid");
  await page.getByLabel("Preferred time block").selectOption("8–10 AM");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeFocused();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Funding preference")).toHaveValue("Private");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".review-list")).toContainText("Sam Parent");
  await expect(page.locator(".review-list")).toContainText(
    "Private · no payment",
  );
  await page.getByRole("button", { name: "Edit Student" }).click();
  await expect(page.getByLabel("Student name")).toHaveValue("Sam Learner");
  for (let i = 0; i < 4; i++)
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Demo testing options", { exact: true }).click();
  await page.getByLabel("Simulate service error").check();
  await page
    .getByRole("button", { name: "Complete registration demo" })
    .click();
  await expect(
    page.getByRole("button", { name: "Completing demo…" }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("could not complete");
  await page.getByLabel("Simulate service error").uncheck();
  await page
    .getByRole("button", { name: "Complete registration demo" })
    .click();
  await completeDemoVerification(page);
  await page
    .getByRole("link", { name: "Continue to student demo login" })
    .click();
  await expect(page.getByLabel("Email address")).toHaveValue("sam@example.com");
  await page
    .getByLabel("Demo password", { exact: true })
    .fill("another-demo-password");
  await page.getByRole("button", { name: "Log in to demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, Sam." }),
  ).toBeVisible();
  await expectNoOverflow(page);
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  expect(stored).not.toContain("password");
  expect(stored).not.toContain("practice-only");
  expect(externalRequests).toEqual([]);
});

test("login validation, error recovery and protected dashboard", async ({
  page,
}) => {
  await page.goto("/#/dashboard");
  await expect(page).toHaveURL(/login/);
  await expect(
    page.getByText("Open a demo session to explore the student dashboard."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log in to demo" }).click();
  await expect(page.getByLabel("Email address")).toBeFocused();
  await page.getByLabel("Email address").fill("alex@example.com");
  await page.getByLabel("Demo password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Log in to demo" }).click();
  await expect(
    page.getByText("Use at least 8 characters for this demo."),
  ).toBeVisible();
  await page.getByLabel("Demo password", { exact: true }).fill("learning-demo");
  await page.getByText("Demo testing options", { exact: true }).click();
  await page.getByLabel("Simulate service error").check();
  await page.getByRole("button", { name: "Log in to demo" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "could not open your demo session",
  );
  await page.getByLabel("Simulate service error").uncheck();
  await page.getByRole("button", { name: "Log in to demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, Demo." }),
  ).toBeVisible();
});

test("dashboard views, loading, empty, error, retry, refresh and sign-out", async ({
  page,
}) => {
  await demoLogin(page);
  await expectNoOverflow(page);
  await dashboardView(page, "My learning");
  await expect(
    page.getByRole("heading", { name: "Your learning paths" }),
  ).toBeVisible();
  await expect(page.locator(".course-card")).toHaveCount(3);
  await page.getByText("View sample lessons", { exact: false }).first().click();
  await expect(
    page.getByText("Start with a question", { exact: false }),
  ).toBeVisible();
  await dashboardView(page, "My projects");
  await page.getByText("View sample project").first().click();
  await expect(
    page
      .getByText("No files are uploaded or shared from this preview.", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await dashboardView(page, "My profile");
  await expect(page.getByText("alex@example.com")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Alex Morgan", exact: true }),
  ).toBeVisible();
  await dashboardView(page, "Overview");
  await expect(
    page.getByRole("heading", { name: "Hello, Alex." }),
  ).toBeVisible();
  await page.getByText("Demo preview settings", { exact: true }).click();
  await page.getByLabel("Preview data state").selectOption("loading");
  await expect(page.getByRole("status")).toContainText(
    "Gathering your learning…",
  );
  await page.getByLabel("Preview data state").selectOption("empty");
  await expect(
    page.getByRole("heading", { name: "A little room for what’s next." }),
  ).toBeVisible();
  await page.getByLabel("Preview data state").selectOption("error");
  await expect(page.getByRole("alert")).toContainText("Let’s try that again.");
  await page.getByRole("button", { name: "Retry with demo data" }).click();
  await expect(
    page.getByRole("heading", { name: "Your learning" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/scenario=success/);
  await expectNoOverflow(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("tala.frontend-demo.session"),
    ),
  ).toBeNull();
  await page.goBack();
  await expect(page).toHaveURL(/login/);
});

test("keyboard navigation and mobile menu dismissal", async ({
  page,
  browserName,
}) => {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) {
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Close menu", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    // macOS WebKit uses Option+Tab to include links in keyboard traversal.
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Home", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
    await menu.click();
    await page.getByRole("main").focus();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await page.locator("h1").click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  }
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.goto("/#/login");
  await page.getByLabel("Email address").focus();
  await page.keyboard.type("keyboard@example.com");
  await page.keyboard.press("Tab");
  await page.keyboard.type("practice-demo");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Hello, Demo." }),
  ).toBeVisible();
});

test("WCAG automated checks and responsive overflow on all main pages", async ({
  page,
}) => {
  for (const route of [
    "/",
    "/about",
    "/learn-more",
    "/events",
    "/contact",
    "/programs",
    "/login",
    "/register",
    "/missing-page",
  ]) {
    await page.goto(`/#${route}`);
    await expectNoOverflow(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations,
      `${route}: ${JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))}`,
    ).toEqual([]);
  }
  await demoLogin(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  for (const [query, heading] of [
    ["view=profile", "Alex Morgan"],
    ["scenario=empty", "A little room for what’s next."],
    ["scenario=error", "Let’s try that again."],
  ]) {
    await page.goto(`/#/dashboard?${query}`);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expectNoOverflow(page);
    const stateResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(stateResults.violations, query).toEqual([]);
  }
  for (const [route, action] of [
    ["login", "Log in to demo"],
    ["register", "Continue"],
  ]) {
    await page.goto(`/#/${route}`);
    await page.getByRole("button", { name: action, exact: true }).click();
    const formResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(formResults.violations, `${route} errors`).toEqual([]);
  }
});

test("small screens, long profile text and reduced motion stay usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of ["/", "/programs", "/login", "/register"]) {
    await page.goto(`/#${route}`);
    await expectNoOverflow(page);
  }
  await page.evaluate(() =>
    sessionStorage.setItem(
      "tala.frontend-demo.session",
      JSON.stringify({
        mode: "demo",
        name: "A".repeat(80),
        email: `${"learner".repeat(20)}@example.com`,
      }),
    ),
  );
  await page.reload();
  await page.goto("/#/dashboard?view=profile");
  await expect(
    page.getByText("Your sample learning profile", { exact: true }),
  ).toBeVisible();
  await expectNoOverflow(page);
  await page.getByText("Demo preview settings", { exact: true }).click();
  await page.getByLabel("Preview data state").selectOption("loading");
  await expect(page.getByRole("status")).toBeVisible();
  expect(
    await page
      .locator(".loading-dot")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});

test("invalid or unavailable browser storage does not crash the app", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    sessionStorage.setItem("tala.frontend-demo.session", "{broken-json"),
  );
  await page.goto("/#/dashboard");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hello, Alex." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});

test("forms stay within reach and passwords can be revealed without losing input", async ({
  page,
}) => {
  for (const route of ["login", "register"]) {
    await page.goto(`/#/${route}`);
    const firstInput = page.locator("main input, main select").first();
    const bounds = await firstInput.boundingBox();
    expect(bounds?.y).toBeLessThan(560);
    await expect(page.locator("h1")).toHaveCount(1);
    const password = page.getByLabel("Demo password", { exact: true });
    await password.fill("sample-only-123");
    await page
      .getByRole("checkbox", {
        name: route === "register" ? "Show passwords" : "Show password",
        exact: true,
      })
      .check();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("sample-only-123");
    await page
      .getByRole("checkbox", {
        name: route === "register" ? "Show passwords" : "Show password",
        exact: true,
      })
      .uncheck();
    await expect(password).toHaveAttribute("type", "password");
  }
});

test("student journey using only the keyboard", async ({
  page,
  browserName,
}) => {
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  async function reach(target: Locator) {
    await expect(target).toBeVisible();
    for (let step = 0; step < 50; step++) {
      if (
        await target.evaluate((element) => element === document.activeElement)
      )
        return;
      await page.keyboard.press(tabKey);
    }
    await expect(target).toBeFocused();
  }
  async function navigate(name: string) {
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    if (await menu.isVisible()) {
      await reach(menu);
      await page.keyboard.press("Enter");
    }
    await reach(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name, exact: true }),
    );
    await page.keyboard.press("Enter");
  }
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("Room to learn. Space to grow.");
  await navigate("Learn More");
  await reach(
    page.getByRole("link", { name: "Meet the learning opportunities" }),
  );
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toHaveText("Find a way to learn.");
  const select = page.getByRole("combobox", { name: "Filter programs" });
  if (await select.isVisible()) {
    await reach(select);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
  } else {
    await reach(
      page.getByRole("button", { name: "Group courses", exact: true }),
    );
    await page.keyboard.press("Enter");
  }
  await expect(page.locator(".program-detail")).toHaveCount(1);
  await navigate("Community Login");
  await expect(page.locator("h1")).toHaveText("Welcome back.");
  await reach(page.getByLabel("Email address"));
  await page.keyboard.type("keyboard@example.com");
  await page.keyboard.press("Tab");
  await page.keyboard.type("learning-demo");
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toHaveText("Hello, Demo.");
  await expect(
    page.getByRole("heading", { name: "Your learning", exact: true }),
  ).toBeVisible();
  const dashboardMenu = page.locator(".dashboard-view-picker summary");
  if (await dashboardMenu.isVisible()) {
    await reach(dashboardMenu);
    await page.keyboard.press("Enter");
    await reach(
      page
        .getByRole("navigation", { name: "Student hub sections", exact: true })
        .getByRole("link", { name: "My projects" }),
    );
  } else {
    await reach(
      page
        .getByRole("navigation", { name: "Dashboard", exact: true })
        .getByRole("link", { name: "My projects" }),
    );
  }
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toHaveText("My projects");
  await expect(page.getByRole("main")).toBeFocused();
  if (await dashboardMenu.isVisible()) {
    await expect(page.locator(".dashboard-view-picker")).not.toHaveAttribute(
      "open",
      "",
    );
    await expect(
      page.getByRole("navigation", {
        name: "Student hub sections",
        exact: true,
      }),
    ).toBeHidden();
    await page.keyboard.press(tabKey);
    await expect(dashboardMenu).toBeFocused();
    await page.keyboard.press(tabKey);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused();
  }
  await reach(page.getByRole("button", { name: "Sign out" }));
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toHaveText("Welcome back.");
});

test("public hash deep links refresh without server route rewrites", async ({
  page,
}) => {
  const documentPaths: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document")
      documentPaths.push(new URL(request.url()).pathname);
  });
  for (const [route, heading] of [
    ["learn-more", "A place for different ways to learn."],
    ["register", "Registration"],
    ["events", "Community events"],
    ["contact", "Contact TALA"],
    ["login", "Welcome back."],
  ] as const) {
    await page.goto(`/#/${route}`);
    await expect(page.locator("h1")).toHaveText(heading);
    const response = await page.reload();
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveText(heading);
    await expect(page).toHaveURL(new RegExp(`/#/${route}$`));
    await expectNoOverflow(page);
  }
  expect(documentPaths.length).toBeGreaterThan(0);
  expect(documentPaths.every((path) => path === "/")).toBe(true);
});

test("community roles and explicit parent identity survive refresh", async ({
  page,
}) => {
  for (const role of ["Parent", "Alumni", "Staff"]) {
    await page.goto("/#/login");
    await page.getByLabel("I am a").selectOption(role);
    await page
      .getByRole("button", { name: "Explore with a sample profile" })
      .click();
    await expect(
      page.getByRole("heading", { name: `${role} workspace` }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Dashboard", exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: `${role} workspace` }),
    ).toBeVisible();
    await expectNoOverflow(page);
    await page.getByRole("button", { name: "Sign out" }).click();
  }
  await page.getByLabel("I am a").selectOption("Parent");
  await page.getByRole("radio", { name: /On behalf of Alex Morgan/ }).check();
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await expect(
    page.getByText("Parent demo: Demo parent, representing Alex Morgan"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Parent demo: Demo parent, representing Alex Morgan"),
  ).toBeVisible();
});

test("available class joins calendar, persists and handles errors without duplicate bookings", async ({
  page,
}) => {
  await demoLogin(page);
  await dashboardView(page, "Personal calendar");
  await expect(
    page.getByRole("heading", { name: "Your schedule has room to grow." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Browse available classes" }).click();
  await expect(
    page.getByRole("button", { name: "Creative studio: Full" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Math in daily life: Waiting List" }),
  ).toBeDisabled();
  await page.getByText("Class testing options").click();
  await page.getByLabel("Simulate class error").check();
  await page.getByRole("button", { name: "Join Everyday science lab" }).click();
  await expect(page.getByRole("alert")).toContainText("class was not added");
  await page.getByLabel("Simulate class error").uncheck();
  await page.getByRole("button", { name: "Join Everyday science lab" }).click();
  await expect(page.getByRole("status")).toContainText("added to My classes");
  await expect(
    page.getByRole("button", { name: "Everyday science lab added" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "View personal calendar" }).click();
  await expect(page.locator(".schedule-list li")).toHaveCount(1);
  await expect(page.locator(".schedule-list")).toContainText("Monday");
  await page.reload();
  await expect(page.locator(".schedule-list li")).toHaveCount(1);
  await expectNoOverflow(page);
  await dashboardView(page, "My classes");
  await expect(page.locator(".schedule-list")).toContainText(
    "Everyday science lab",
  );
  await dashboardView(page, "Available class slots");
  await page.getByLabel("Class format").selectOption("Online");
  await expect(page.locator(".schedule-list li")).toHaveCount(2);
  await page.getByText("Demo preview settings", { exact: true }).click();
  await page.getByLabel("Preview data state").selectOption("loading");
  await expect(page.getByRole("status")).toContainText(
    "Loading your sample schedule",
  );
  await page.getByLabel("Preview data state").selectOption("empty");
  await expect(
    page.getByRole("heading", { name: "No classes to show" }),
  ).toBeVisible();
  await page.getByLabel("Preview data state").selectOption("error");
  await expect(page.getByRole("alert")).toContainText("Schedule unavailable");
  await page.getByRole("button", { name: "Retry with demo data" }).click();
  await expect(page.locator(".schedule-list li")).toHaveCount(4);
});

test("new schedule and community surfaces pass accessibility checks", async ({
  page,
}) => {
  await demoLogin(page);
  for (const view of [
    "slots",
    "calendar",
    "classes",
    "attendance",
    "skipcourse",
    "messages",
  ]) {
    await page.goto(`/#/dashboard?view=${view}`);
    if (["slots", "calendar", "classes"].includes(view))
      await expect(page.getByText("Loading your sample schedule…")).toHaveCount(
        0,
      );
    await expectNoOverflow(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations, view).toEqual([]);
  }
});

test("private funding, waiting list and registered parent retain the correct student", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page.screenshot({
    path: testInfo.outputPath("home.png"),
    fullPage: true,
  });
  const funding = "Private";
  await page.goto("/#/register?intent=waiting-list");
  await page.getByLabel("Parent name").fill("Pat Sample");
  await page.getByLabel("Parent email").fill("pat@example.com");
  await page.getByLabel("Demo password", { exact: true }).fill("made-up-only");
  await page.getByLabel("Confirm demo password").fill("made-up-only");
  await page.screenshot({
    path: testInfo.outputPath(`registration-${funding}.png`),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Student name").fill("Jamie Sample");
  await page.getByLabel("Student email").fill("jamie@example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Registration interest")).toHaveValue(
    "Waiting list",
  );
  await page.getByLabel("Learning preference").selectOption("Online");
  await page.getByLabel("Preferred time block").selectOption("2–4 PM");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Funding preference")).toHaveValue(funding);
  await expect(
    page.getByLabel("Funding preference").locator("option"),
  ).toHaveText(["Private"]);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeFocused();
  await page.getByRole("checkbox").check();
  await page.screenshot({
    path: testInfo.outputPath(`funding-${funding}.png`),
    fullPage: true,
  });
  const fundingAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(fundingAxe.violations).toEqual([]);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".review-list")).toContainText(funding);
  await expectNoOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath(`review-${funding}.png`),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Complete registration demo" })
    .click();
  await completeDemoVerification(page);
  await page.getByRole("link", { name: "Explore as a parent" }).click();
  await expect(page.getByLabel("I am a")).toHaveValue("Parent");
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Parent workspace" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("link", { name: "Choose my student’s demo view" })
    .click();
  await page.getByRole("radio", { name: /On behalf of Jamie Sample/ }).check();
  await page.screenshot({
    path: testInfo.outputPath(`parent-login-${funding}.png`),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Explore with a sample profile" })
    .click();
  await expect(
    page.getByText("Parent demo: Pat Sample, representing Jamie Sample"),
  ).toBeVisible();
  await dashboardView(page, "My profile");
  await expect(page.locator(".profile-panel")).toContainText(
    "jamie@example.com",
  );
  await dashboardView(page, "Available class slots");
  await expect(page.locator(".schedule-list li")).toHaveCount(4);
  await page.screenshot({
    path: testInfo.outputPath(`classes-${funding}.png`),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Join Reading together" }).click();
  await expect(
    page.getByRole("button", { name: "Reading together added" }),
  ).toBeDisabled();
  // A catalog filter must never hide a joined class in the personal calendar.
  await page.getByLabel("Class format").selectOption("In-Person");
  await page.getByRole("link", { name: "View personal calendar" }).click();
  await expect(page.locator(".schedule-list")).toContainText(
    "Reading together",
  );
  await page.screenshot({
    path: testInfo.outputPath(`calendar-${funding}.png`),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out" }).click();
});

// Authentication tests handle ephemeral enrollment secrets; do not record traces.
test.use({ trace: "off", screenshot: "off" });
