"use strict";

const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = __dirname;
const NODE = join(ROOT, "node_modules/node/bin/node");
const CLI = join(ROOT, "node_modules/firebase-tools/lib/bin/firebase.js");

function localEnvironment() {
  const environment = {
    ...process.env,
    TALA_ENVIRONMENT: "emulator",
    GCLOUD_PROJECT: "demo-tala-local", GOOGLE_CLOUD_PROJECT: "demo-tala-local",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
    // Local SDKs must never probe a cloud VM for application credentials.
    METADATA_SERVER_DETECTION: "none",
    PATH: `${join(ROOT, "node_modules/node/bin")}${require("node:path").delimiter}${process.env.PATH || ""}`,
  };
  for (const key of ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_TOKEN", "FIREBASE_CONFIG", "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE"]) delete environment[key];
  return environment;
}

function runLocal(args, environment = {}) {
  if (!existsSync(NODE)) throw new Error("Install backend tooling first: cd backend && npm ci");
  const child = spawn(NODE, args, {
    cwd: ROOT, stdio: "inherit", detached: process.platform !== "win32",
    env: { ...localEnvironment(), ...environment },
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // One SIGINT allows Firebase CLI to finish --export-on-exit safely.
    child.kill("SIGINT");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("error", () => { console.error("Unable to start the pinned local Node tool."); process.exitCode = 1; });
  child.on("exit", (code) => {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.exitCode = code ?? 1;
  });
  return child;
}

module.exports = { ROOT, NODE, CLI, localEnvironment, runLocal };
