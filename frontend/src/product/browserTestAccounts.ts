import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export type BrowserTestAccount = {
  name: string;
  email: string;
  password: string;
  role: "student" | "parent";
};

export async function provisionAndLogin(
  page: Page,
  provision: (account: BrowserTestAccount) => Promise<unknown>,
  account: BrowserTestAccount,
) {
  await provision(account);
  await page.goto("/#/login");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: `Hello, ${account.name}.`,
      exact: true,
    }),
  ).toBeVisible();
  return account;
}
