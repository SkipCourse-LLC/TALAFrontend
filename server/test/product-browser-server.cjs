"use strict";
// A plain Node child avoids Playwright's TypeScript loader intercepting the
// native node:sqlite module. Fixture actions exist only over the parent's IPC.
const path = require("node:path");
const { createApplication } = require("../application.cjs");
const dataDir = process.env.TALA_BROWSER_TEST_DATA_DIR;
if (!process.send || !dataDir || !path.isAbsolute(dataDir) || !path.basename(dataDir).startsWith("tala-product-browser-"))
  throw new Error("The browser harness requires a generated private test directory and IPC parent.");
const application = createApplication({ dataDir, allowedOrigins: ["http://127.0.0.1:5180"] });
application.server.listen(8787, "127.0.0.1", () => process.send({ ready: true }));
process.on("message", async (request) => {
  try {
    let result;
    if (request.action === "addAvailability") result = application.operator.addAvailability(request.input);
    else if (request.action === "linkFamily") result = application.operator.linkFamily(request.input);
    else if (request.action === "findUid" && typeof request.input === "string" && request.input.endsWith("@example.test"))
      result = application.db.prepare("SELECT uid FROM users WHERE email=?").get(request.input)?.uid;
    else throw new Error("Unsupported synthetic fixture action.");
    process.send({ id: request.id, result });
  } catch {
    process.send({ id: request.id, error: "The isolated test fixture operation failed." });
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
