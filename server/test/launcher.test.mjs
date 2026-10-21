import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runtimeRevision, dataScope } from "../runtimeIdentity.cjs";

function occupied(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", (error) => { socket.destroy(); if (error.code === "ECONNREFUSED") resolve(false); else reject(error); });
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error("Unable to inspect the isolated test port.")); });
  });
}

test("launcher refuses a different data scope or loaded revision without stopping the occupied service", { timeout: 10_000 }, async (context) => {
  if (await occupied(5173) || await occupied(8787)) {
    context.skip("The fixed launcher ports are occupied; no process was stopped or reused.");
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), "tala-launcher-identity-"));
  const expectedData = join(directory, "chosen-runtime");
  let value = { application: "tala-independent-server", version: 1, contractVersion: 4, schemaVersion: 2, status: "ok", authentication: "local-server", runtimeRevision, instanceScope: dataScope(join(directory, "another-runtime")) };
  const mock = createServer((request, response) => {
    assert.equal(request.url, "/api/health");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(value));
  });
  await new Promise((resolve, reject) => { mock.once("error", reject); mock.listen(8787, "127.0.0.1", resolve); });
  try {
    async function launch() {
      const child = spawn(process.execPath, [fileURLToPath(new URL("../../frontend/scripts/startApplication.mjs", import.meta.url))], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        env: { ...process.env, NODE_ENV: "test", TALA_SERVER_PORT: "8787", TALA_DATA_DIR: expectedData },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (part) => { output += part; });
      child.stderr.on("data", (part) => { output += part; });
      const deadline = setTimeout(() => child.kill("SIGTERM"), 3000);
      try {
        const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
        assert.equal(code, 1);
        assert.match(output, /another data directory/);
        assert.match(output, /No process was stopped/);
        assert.equal(output.includes("VITE"), false);
        assert.equal((await fetch("http://127.0.0.1:8787/api/health")).ok, true, "The original occupied service must remain running");
        await assert.rejects(access(expectedData), { code: "ENOENT" });
      } finally { clearTimeout(deadline); }
    }
    await launch();
    value = { ...value, instanceScope: dataScope(expectedData), runtimeRevision: "0".repeat(64) };
    await launch();
    value = { ...value, runtimeRevision, unexpectedLargePayload: "x".repeat(5000) };
    await launch();
  } finally {
    await new Promise((resolve) => mock.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
