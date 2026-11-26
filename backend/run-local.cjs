"use strict";

const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT, NODE, localEnvironment, runLocal } = require("./local-tooling.cjs");

const command = process.argv[2];
if (process.argv.length !== 3 || !["seed", "runtime", "integration", "check", "persistence-prepare", "persistence-verify"].includes(command)) {
  console.error("Choose a fixed local task: seed, runtime, integration, check, persistence-prepare or persistence-verify.");
  process.exitCode = 1;
} else if (command === "check") {
  for (const file of ["start-emulators.cjs", "local-tooling.cjs", "run-local.cjs", "functions/index.cjs", "functions/local-runtime.cjs", "functions/seed.cjs"]) {
    const result = spawnSync(NODE, ["--check", join(ROOT, file)], { stdio: "inherit", env: localEnvironment() });
    if (result.status !== 0) { process.exitCode = 1; break; }
  }
} else if (command.startsWith("persistence-")) {
  runLocal([join(ROOT, "functions/test/persistence-probe.cjs"), command.slice("persistence-".length)]);
} else if (command === "seed") {
  runLocal([join(ROOT, "functions/seed.cjs")]);
} else {
  const args = ["--test", join(ROOT, "functions/test/runtime.test.cjs")];
  if (command === "integration") args.push(join(ROOT, "functions/test/integration.test.cjs"));
  runLocal(args, { TALA_EMULATOR_TESTS: command === "integration" ? "true" : "false" });
}
