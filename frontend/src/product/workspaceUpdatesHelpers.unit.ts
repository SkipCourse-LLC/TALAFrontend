import { expect, test } from "@playwright/test";
import type { WorkspaceUpdate } from "../api";
import {
  groupWorkspaceUpdates,
  mergeWorkspaceUpdates,
} from "./workspaceUpdatesHelpers";

function update(
  index: number,
  occurredAt: Date,
  read = false,
): WorkspaceUpdate {
  return {
    id: `update_${String(index).padStart(64, "0")}`,
    type: "appointment",
    title: `Synthetic saved reservation ${index}`,
    summary: "Synthetic local calendar grouping fixture only.",
    occurredAt: occurredAt.toISOString(),
    read,
    target: { view: "meetings", resourceId: `synthetic-reservation-${index}` },
  };
}

test("update groups cross local midnight and the year boundary without changing server order", () => {
  const now = new Date(2027, 0, 1, 0, 5);
  const first = update(1, new Date(2027, 0, 1, 0, 4));
  const second = update(2, new Date(2027, 0, 1, 0, 1));
  const previousDay = update(3, new Date(2026, 11, 31, 23, 59));
  const records = [first, second, previousDay];
  Object.freeze(records);
  expect(groupWorkspaceUpdates(records, now)).toEqual([
    { key: "2027-01-01", label: "Today", items: [first, second] },
    { key: "2026-12-31", label: "Yesterday", items: [previousDay] },
  ]);
  expect(records).toEqual([first, second, previousDay]);
});

test("older update groups include a previous year and omit the current year", () => {
  const now = new Date(2027, 0, 10, 12);
  const currentYear = update(1, new Date(2027, 0, 5, 10));
  const previousYear = update(2, new Date(2026, 11, 30, 18));
  expect(groupWorkspaceUpdates([currentYear, previousYear], now)).toEqual([
    { key: "2027-01-05", label: "January 5", items: [currentYear] },
    { key: "2026-12-30", label: "December 30, 2026", items: [previousYear] },
  ]);
});

test("Yesterday is a local calendar day across the 23-hour and 25-hour daylight-saving transitions", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    for (const [now, yesterday] of [
      ["2027-03-15T04:10:00Z", "2027-03-14T05:05:00Z"],
      ["2027-11-08T05:10:00Z", "2027-11-07T04:05:00Z"],
    ]) {
      const event = update(1, new Date(yesterday!));
      expect(groupWorkspaceUpdates([event], new Date(now!))[0]?.label).toBe(
        "Yesterday",
      );
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("page merging deduplicates identities and keeps only server-provided read changes without mutating cached records", () => {
  const first = update(1, new Date(2027, 0, 5, 10));
  const second = update(2, new Date(2027, 0, 5, 9));
  const confirmedRead = { ...second, read: true };
  const older = update(3, new Date(2027, 0, 4, 15));
  const cached = [first, second];
  const page = [confirmedRead, older];
  Object.freeze(cached);
  Object.freeze(page);
  Object.freeze(first);
  Object.freeze(second);
  expect(mergeWorkspaceUpdates(cached, page)).toEqual([
    first,
    confirmedRead,
    older,
  ]);
  expect(first.read).toBe(false);
  expect(second.read).toBe(false);
  expect(cached).toEqual([first, second]);
  expect(page).toEqual([confirmedRead, older]);
});
