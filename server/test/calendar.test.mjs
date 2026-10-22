import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApplication } from "../application.cjs";

test("availability rejects impossible calendar dates without normalizing them into other meeting days", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "tala-calendar-test-"));
  const app = createApplication({ dataDir });
  try {
    for (const date of ["2027-02-29T17:00:00Z", "2028-02-30T17:00:00Z", "2027-04-31T17:00:00Z", "2027-01-01T24:00:00Z"]) {
      assert.throws(() => app.operator.addAvailability({ startsAt: date, endsAt: date.replace("17:00", "17:30").replace("24:00", "24:30") }), (error) => error.status === 400 && error.code === "INVALID_INPUT");
    }
    assert.equal(app.db.prepare("SELECT count(*) AS n FROM slots").get().n, 0, "Invalid dates must not create any slot");
    const leap = app.operator.addAvailability({ startsAt: "2028-02-29T17:00:00Z", endsAt: "2028-02-29T17:30:00Z" });
    assert.equal(leap.startsAt, "2028-02-29T17:00:00.000Z");
    const zoned = app.operator.addAvailability({ startsAt: "2028-03-01T17:00:00+05:30", endsAt: "2028-03-01T17:30:00+05:30" });
    assert.equal(zoned.startsAt, "2028-03-01T11:30:00.000Z", "Valid explicit offsets must retain their exact instant");
  } finally { await app.close(); await rm(dataDir, { recursive: true, force: true }); }
});
