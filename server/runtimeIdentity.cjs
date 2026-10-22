"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

// Capture the loaded version once. Re-reading changed source on each health
// request would make an old process claim to run code it never loaded.
const files = ["accountServices.cjs", "application.cjs", "contactRequests.cjs", "contract.json", "database.cjs", "index.cjs", "listServices.cjs", "runtimeIdentity.cjs", "security.cjs", "services.cjs"];
function currentRevision() {
  const digest = createHash("sha256").update("tala-runtime-source-v1\0");
  for (const filename of files) digest.update(filename).update("\0").update(fs.readFileSync(path.join(__dirname, filename))).update("\0");
  return digest.digest("hex");
}
const runtimeRevision = currentRevision();
function assertCurrentRevision() {
  if (currentRevision() !== runtimeRevision) throw new Error("TALA server source changed while startup modules were loading. Start the server again after editing finishes.");
}

// This is a local-instance mismatch check, not an authentication credential.
// Return a digest rather than disclosing the user's absolute private path.
function dataScope(dataDir) {
  return createHash("sha256").update("tala-data-directory-v1\0").update(path.resolve(dataDir)).digest("hex");
}
module.exports = { runtimeRevision, dataScope, assertCurrentRevision };
