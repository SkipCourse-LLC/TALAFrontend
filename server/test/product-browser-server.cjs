"use strict";
// A plain Node child avoids Playwright's TypeScript loader intercepting the
// native node:sqlite module. Fixture actions exist only over the parent's IPC.
const path = require("node:path");
const fs = require("node:fs");
const { createApplication } = require("../application.cjs");
const dataDir = process.env.TALA_BROWSER_TEST_DATA_DIR;
if (
  !process.send ||
  !dataDir ||
  !path.isAbsolute(dataDir) ||
  !path.basename(dataDir).startsWith("tala-product-browser-")
)
  throw new Error(
    "The browser harness requires a generated private test directory and IPC parent.",
  );
const application = createApplication({
  dataDir,
  allowedOrigins: ["http://127.0.0.1:5180"],
});
application.server.listen(8787, "127.0.0.1", () =>
  process.send({ ready: true }),
);
process.on("message", async (request) => {
  try {
    let result;
    if (request.action === "addAvailability")
      result = application.operator.addAvailability(request.input);
    else if (request.action === "linkFamily")
      result = application.operator.linkFamily(request.input);
    else if (request.action === "revokeFamily")
      result = application.operator.revokeFamily(request.input);
    else if (
      request.action === "promote" &&
      typeof request.input === "string" &&
      request.input.endsWith("@example.test")
    )
      result = application.operator.promote(request.input);
    else if (
      request.action === "endBooking" &&
      typeof request.input === "string" &&
      request.input.endsWith("@example.test")
    ) {
      const booking = application.db
        .prepare(
          "SELECT a.id,a.slot_id FROM appointments a JOIN users u ON u.uid=a.owner_uid WHERE u.email=? AND a.status='reserved'",
        )
        .get(request.input);
      if (!booking) throw new Error("A generated active booking is required.");
      application.db
        .prepare("UPDATE slots SET starts_at=?,ends_at=? WHERE id=?")
        .run(Date.now() - 3_600_000, Date.now() - 1_800_000, booking.slot_id);
      result = { appointmentId: booking.id };
    } else if (request.action === "dropUnsubmittedFile" && typeof request.input === "string" && /^[a-f0-9-]{36}$/.test(request.input)) {
      const upload = application.db.prepare("SELECT u.id FROM uploads u JOIN users p ON p.uid=u.owner_uid WHERE u.id=? AND u.status='uploaded' AND p.email LIKE '%@example.test' AND NOT EXISTS(SELECT 1 FROM evidence e WHERE e.id=u.id)").get(request.input);
      if (!upload) throw new Error("A generated unfinished upload is required.");
      fs.rmSync(path.join(dataDir, "uploads", `${upload.id}.bin`));
      result = { removed: true };
    } else if (
      request.action === "findUid" &&
      typeof request.input === "string" &&
      request.input.endsWith("@example.test")
    )
      result = application.db
        .prepare("SELECT uid FROM users WHERE email=?")
        .get(request.input)?.uid;
    else throw new Error("Unsupported synthetic fixture action.");
    process.send({ id: request.id, result });
  } catch {
    process.send({
      id: request.id,
      error: "The isolated test fixture operation failed.",
    });
  }
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await application.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
process.on("disconnect", close);
