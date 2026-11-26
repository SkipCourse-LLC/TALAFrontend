import { expect, test } from "@playwright/test";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("native role choices stay readable with enlarged text on small screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/#/login");
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  const role = page.getByLabel("I am a");
  await role.selectOption("Parent");
  await expect(role).toHaveValue("Parent");
  const readable = await role.evaluate((element) => {
    const css = getComputedStyle(element);
    const available =
      element.clientHeight -
      parseFloat(css.paddingTop) -
      parseFloat(css.paddingBottom);
    return available >= parseFloat(css.fontSize) * 1.2;
  });
  expect(
    readable,
    "The selected role has enough vertical space to display its text",
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
