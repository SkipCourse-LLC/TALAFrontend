import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("unknown, inherited and incomplete operator commands cannot open a data directory", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "tala-operator-cli-"));
  const cli = fileURLToPath(new URL("../operator.cjs", import.meta.url));
  const cases = [
    [], ["unknown-command"], ["toString"], ["constructor"], ["__proto__"], ["hasOwnProperty"], ["valueOf"],
    ["promote"], ["promote", "--email"], ["promote", "--email", ""], ["promote", "--email", " "],
    ["promote", "--email", "one@example.test", "--email", "two@example.test"],
    ["add-availability"], ["add-availability", "--startsAt", "2027-01-05T17:00:00Z"],
    ["link-family", "--studentUid", "synthetic-student", "--parentUid", "synthetic-parent"],
    ["revoke-family", "--studentUid", "synthetic-student"],
    ["cleanup-expired", "--constructor", "unsupported"], ["cleanup-expired", "--toString", "unsupported"],
  ];
  try {
    for (const [index, args] of cases.entries()) {
      const dataDir = join(root, `must-not-be-created-${index}`);
      assert.equal(existsSync(dataDir), false);
      const result = spawnSync(process.execPath, [cli, ...args], {
        env: { ...process.env, NODE_ENV: "test", TALA_DATA_DIR: dataDir },
        encoding: "utf8", timeout: 5_000,
      });
      const label = JSON.stringify(args);
      assert.equal(result.error, undefined, `The invalid command should fail promptly: ${label}`);
      assert.equal(result.status, 1, `The invalid command must be refused: ${label}`);
      assert.equal(result.stdout.trim(), "", `No operator action should report success: ${label}`);
      assert.equal(existsSync(join(dataDir, "tala.sqlite")), false, `No database may be created: ${label}`);
      assert.equal(existsSync(dataDir), false, `Validation must happen before opening a runtime directory: ${label}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
