import { spawnSync } from "node:child_process";
import process from "node:process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, URL } from "node:url";

const script = fileURLToPath(
  new URL("./validateHostingFirebase.mjs", import.meta.url),
);
const values = {
  VITE_FIREBASE_PROJECT_ID: "skip-class-slsru4",
  VITE_FIREBASE_API_KEY: "synthetic-public-key",
  VITE_FIREBASE_AUTH_DOMAIN: "skip-class-slsru4.firebaseapp.com",
  VITE_FIREBASE_APP_ID: "1:123:web:abcdef",
};

function run(env) {
  return spawnSync(process.execPath, [script], {
    env: { ...process.env, ...values, ...env },
    encoding: "utf8",
  });
}

test("requires every nonblank Firebase Web App variable without exposing values", () => {
  for (const name of Object.keys(values)) {
    for (const value of ["", "  "]) {
      const result = run({ [name]: value });
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(name));
      assert.doesNotMatch(result.stderr, /synthetic-public-key/);
    }
  }
});

test("accepts a complete public Firebase Web App configuration", () => {
  const result = run({});
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});
