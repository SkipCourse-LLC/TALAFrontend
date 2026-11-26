"use strict";

const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { ROOT, CLI, runLocal } = require("./local-tooling.cjs");

if (process.argv.length !== 2) {
  console.error("This launcher accepts no project, host or deployment overrides.");
  process.exitCode = 1;
} else if (!existsSync(CLI)) {
  console.error("Install backend tooling first: cd backend && npm ci");
  process.exitCode = 1;
} else {
  const data = join(ROOT, ".emulator-data");
  const args = [CLI, "emulators:start", "--config", join(ROOT, "firebase.json"), "--project", "demo-tala-local",
    "--only", "auth,firestore,storage,functions", `--export-on-exit=${data}`];
  if (existsSync(join(data, "firebase-export-metadata.json"))) args.push(`--import=${data}`);
  console.log("Starting isolated TALA emulators. Use synthetic @example.test users and files only. Stop with Ctrl+C to save local data.");
  runLocal(args);
}
