import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Follow the same explicit choices as a student, including additional times. */
export async function chooseMeetingTime(page: Page, slotId?: string) {
  const meetings = page.locator("#meetings");
  await expect(meetings).toBeVisible();
  const availability = meetings.locator("#meeting-availability");
  if (!(await availability.isVisible()))
    await meetings
      .getByRole("button", { name: "Change booking", exact: true })
      .click();
  const quick = availability.locator('input[name="quick-meeting-time"]');
  await expect(quick.first()).toBeEnabled();
  if (!slotId) {
    const first = quick.first();
    const value = await first.getAttribute("value");
    expect(value).toBeTruthy();
    await first.check();
    return value!;
  }
  const direct = availability.locator(
    `input[name="quick-meeting-time"][value="${slotId}"]`,
  );
  if (await direct.count()) await direct.check();
  else {
    const allTimes = availability.locator("details.meeting-all-times");
    if ((await allTimes.getAttribute("open")) === null)
      await allTimes.locator("summary").click();
    await availability
      .getByLabel("Available meeting time", { exact: true })
      .selectOption(slotId);
  }
  return slotId;
}
