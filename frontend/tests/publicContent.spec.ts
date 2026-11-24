import { expect, test } from "@playwright/test";

test("families can explore programs, admissions, tuition and FAQs", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A School Designed Around Health, Dignity & True Potential",
  );
  await expect(
    page.getByRole("link", {
      name: "Schedule a Family Interview",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://calendar.app.google/YapTB4MQLus16DATA");
  await page
    .getByRole("link", { name: "Explore Programs", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "In-Person Campus Program" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Virtual Academy" }),
  ).toBeVisible();
  const filter = page.getByRole("combobox", { name: "Filter programs" });
  const filterButton = page.getByRole("button", { name: "Nationwide online" });
  await expect(filter.or(filterButton).filter({ visible: true })).toBeVisible();
  if (await filter.isVisible()) await filter.selectOption("virtual");
  else await filterButton.click();
  await expect(page.locator(".program-detail")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Virtual Academy" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".program-detail")).toHaveCount(1);
  await page.goto("/#/admissions");
  await expect(
    page.getByRole("heading", { name: "Is TALA the Right Fit?" }),
  ).toBeVisible();
  await expect(
    page.getByText("ESA-funded educational services for qualifying students"),
  ).toBeVisible();
  await page.goto("/#/tuition");
  await expect(page.getByText("$5,000/year ($1,250 quarterly).")).toBeVisible();
  await expect(page.getByText("Faculty Advisor Check-In")).toBeVisible();
  await expect(
    page.getByText("$120 per hour ($240 per two-hour block)."),
  ).toBeVisible();
  await expect(
    page.getByText("$30 per hour ($60 per two-hour block)."),
  ).toBeVisible();
  await expect(page.getByText("$60 per hour.")).toBeVisible();
  await expect(page).toHaveTitle(/Tuition and Funding/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /ESA/,
  );
  await page.goto("/#/faq");
  await page.getByText("Can families use ESA or scholarships?").click();
  await expect(
    page.getByText(/Qualifying Arizona students may use ESA/),
  ).toBeVisible();
});
