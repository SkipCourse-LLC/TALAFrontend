import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../application.cjs";
import { runtimeRevision, dataScope } from "../runtimeIdentity.cjs";
import { test } from "node:test";

// All instances and copied source fixtures are generated under a temp prefix.
test("health binds local reuse to the selected private directory without exposing its path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tala-runtime-identity-"));
  const app = createApplication({ dataDir: directory });
  try {
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
    const result = await fetch(`http://127.0.0.1:${app.server.address().port}/api/health`);
    assert.equal(result.status, 200);
    const value = await result.json();
    assert.equal(value.runtimeRevision, runtimeRevision);
    assert.match(value.runtimeRevision, /^[a-f0-9]{64}$/);
    assert.equal(value.instanceScope, dataScope(directory));
    assert.notEqual(value.instanceScope, dataScope(join(directory, "different-instance")));
    assert.equal(JSON.stringify(value).includes(directory), false);
    assert.equal(JSON.stringify(value).includes("tala.sqlite"), false);
    assert.equal(result.headers.get("set-cookie"), null);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a loaded source revision cannot change when files on disk are edited", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tala-runtime-source-"));
  try {
    const files = ["accountServices.cjs", "application.cjs", "contactRequests.cjs", "contract.json", "database.cjs", "index.cjs", "listServices.cjs", "security.cjs", "services.cjs"];
    for (const file of files) await writeFile(join(directory, file), "Synthetic source fixture only.\n");
    await copyFile(new URL("../runtimeIdentity.cjs", import.meta.url), join(directory, "runtimeIdentity.cjs"));
    const probe = spawnSync(process.execPath, ["-e", `const fs = require('node:fs'); const identity = require('./runtimeIdentity.cjs'); const before = identity.runtimeRevision; identity.assertCurrentRevision(); fs.appendFileSync('services.cjs', 'Synthetic security patch.'); let refused = false; try { identity.assertCurrentRevision(); } catch { refused = true; } const cached = require('./runtimeIdentity.cjs').runtimeRevision; const child = require('node:child_process').spawnSync(process.execPath, ['-e', "process.stdout.write(require('./runtimeIdentity.cjs').runtimeRevision)"], { encoding: 'utf8' }); process.stdout.write(JSON.stringify({before,cached,refused,updated:child.stdout,exit:child.status}));`], { cwd: directory, encoding: "utf8" });
    assert.equal(probe.status, 0);
    const value = JSON.parse(probe.stdout);
    assert.equal(value.before, value.cached);
    assert.equal(value.refused, true, "Startup validation must reject changed sources without updating the cached identity");
    assert.notEqual(value.before, value.updated);
    assert.equal(value.exit, 0);
    assert.match(value.updated, /^[a-f0-9]{64}$/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("both server entry points reject source edits during business-module loading before opening any runtime", async () => {
  for (const entry of ["application.cjs", "index.cjs"]) {
    const directory = await mkdtemp(join(tmpdir(), "tala-runtime-load-order-"));
    try {
      for (const file of ["accountServices.cjs", "application.cjs", "contactRequests.cjs", "contract.json", "database.cjs", "index.cjs", "listServices.cjs", "security.cjs", "services.cjs"]) await writeFile(join(directory, file), "module.exports = {};\n");
      await copyFile(new URL("../runtimeIdentity.cjs", import.meta.url), join(directory, "runtimeIdentity.cjs"));
      await copyFile(new URL(`../${entry}`, import.meta.url), join(directory, entry));
      const changingModule = entry === "application.cjs" ? "services.cjs" : "application.cjs";
      await writeFile(join(directory, changingModule), "require('node:fs').appendFileSync(__filename, '\\n// Synthetic edit during startup.\\n'); module.exports = { createApplication() { throw new Error('Runtime must not open'); } };\n");
      const probe = spawnSync(process.execPath, ["-e", `let failure; try { require('./${entry}'); } catch(error) { failure = error.message; } process.stdout.write(JSON.stringify({failure}));`], { cwd: directory, encoding: "utf8" });
      assert.equal(probe.status, 0);
      const value = JSON.parse(probe.stdout);
      assert.match(value.failure, /source changed while startup modules were loading/, `${entry} must capture its identity before loading business code`);
      assert.equal(value.failure.includes("Runtime must not open"), false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
