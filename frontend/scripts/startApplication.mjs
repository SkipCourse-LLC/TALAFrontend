import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { Buffer } from "node:buffer";
import runtimeIdentity from "../../server/runtimeIdentity.cjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const frontend = fileURLToPath(new URL("../", import.meta.url));
const serverEntry = fileURLToPath(
  new URL("../../server/index.cjs", import.meta.url),
);
const viteEntry = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);
const children = new Set();
const expectedScope = runtimeIdentity.dataScope(
  path.resolve(root, process.env.TALA_DATA_DIR || "server/.runtime"),
);
let stopping = false;

function listening(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("The local port did not respond."));
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(new Error("The local port could not be checked."));
    });
  });
}
async function healthy() {
  try {
    const response = await globalThis.fetch(
      "http://127.0.0.1:8787/api/health",
      {
        signal: globalThis.AbortSignal.timeout(1500),
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
      },
    );
    const refuseResponse = async () => {
      await response.body?.cancel().catch(() => {});
      return false;
    };
    if (
      !response.ok ||
      !/^application\/json(?:;|$)/i.test(
        response.headers.get("content-type") || "",
      )
    )
      return refuseResponse();
    const declared = response.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > 4096))
      return refuseResponse();
    if (!response.body) return false;
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 4096) return false;
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return (
      value?.application === "tala-independent-server" &&
      value.version === 1 &&
      value.contractVersion === 6 &&
      value.schemaVersion === 4 &&
      value.runtimeRevision === runtimeIdentity.runtimeRevision &&
      value.instanceScope === expectedScope &&
      value.status === "ok" &&
      value.authentication === "local-server"
    );
  } catch {
    return false;
  }
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
function launch(entry, args, cwd, env) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  children.add(child);
  child.once("error", () => {
    process.stderr.write(
      "A local TALA process could not start. Check the Node version and installed frontend dependencies.\n",
    );
    stop(1);
  });
  child.once("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code ?? 1);
  });
  return child;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));

try {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error(
      "The independent TALA server requires Node.js 24 or newer.",
    );
  if (process.argv[2] === "--demo") {
    launch(
      viteEntry,
      ["--mode", "demo", "--host", "127.0.0.1", ...process.argv.slice(3)],
      frontend,
      { VITE_BACKEND_MODE: "demo", VITE_DEMO_MODE: "true" },
    );
  } else {
    if (process.argv.length > 2)
      throw new Error(
        "The combined launcher uses API 8787 and website 5173. Use dev:demo for presentation-only Vite options.",
      );
    if (process.env.TALA_SERVER_PORT && process.env.TALA_SERVER_PORT !== "8787")
      throw new Error(
        "The combined launcher requires TALA_SERVER_PORT=8787 to match the website proxy.",
      );
    if (await listening(5173))
      throw new Error(
        "Port 5173 is already in use. Stop that process yourself or keep using the existing site. No process was stopped.",
      );
    if (await listening(8787)) {
      if (!(await healthy()))
        throw new Error(
          "Port 8787 belongs to an older TALA version, another data directory, or an unverified service. Stop that instance yourself or choose its intended data directory before starting. No process was stopped.",
        );
      process.stdout.write(
        "Using the existing verified local TALA API on port 8787.\n",
      );
    } else {
      const api = launch(serverEntry, [], root, { TALA_SERVER_PORT: "8787" });
      let ready = false;
      for (let attempt = 0; attempt < 50 && !stopping; attempt++) {
        if (api.exitCode !== null) break;
        if (await healthy()) {
          ready = true;
          break;
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
      }
      if (!ready || stopping)
        throw new Error(
          "The local TALA API did not become ready. Review its terminal output.",
        );
    }
    if (!stopping)
      launch(
        viteEntry,
        [
          "--mode",
          "api",
          "--host",
          "127.0.0.1",
          "--port",
          "5173",
          "--strictPort",
        ],
        frontend,
        {
          VITE_BACKEND_MODE: "api",
          VITE_DEMO_MODE: "false",
          VITE_DEMO_TOOLS: "false",
        },
      );
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "The local application could not start."}\n`,
  );
  stop(1);
}
