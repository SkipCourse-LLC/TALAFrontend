"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

// Capture once so a running process never reports source it didn't load.
const files = ["accountServices.cjs", "application.cjs", "contract.json", "database.cjs", "index.cjs", "listServices.cjs", "runtimeIdentity.cjs", "security.cjs", "services.cjs"];
function currentRevision() {
  const digest = createHash("sha256").update("tala-runtime-source-v1\0");
  for (const filename of files) digest.update(filename).update("\0").update(fs.readFileSync(path.join(__dirname, filename))).update("\0");
  return digest.digest("hex");
}
const runtimeRevision = currentRevision();
function assertCurrentRevision() {
  if (currentRevision() !== runtimeRevision) throw new Error("TALA server source changed while startup modules were loading. Start the server again after editing finishes.");
}

// A mismatch check, not a credential; hashed so the path isn't disclosed.
function dataScope(dataDir) {
  return createHash("sha256").update("tala-data-directory-v1\0").update(path.resolve(dataDir)).digest("hex");
}
module.exports = { runtimeRevision, dataScope, assertCurrentRevision };
