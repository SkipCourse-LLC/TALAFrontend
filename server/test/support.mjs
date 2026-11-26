import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const security = require("../security.cjs");
const ROLES = new Set(["student", "parent", "alumni", "operator"]);

/**
 * Self-service sign-up is closed: /api/auth/register always answers
 * ENROLLMENT_INVITATION_REQUIRED. Tests create fictional example.test accounts
 * server-side, with the server's own validators and password hashing, the way
 * staff provisioning does. Sign-in still goes through the real HTTP route.
 */
export async function provisionAccount(app, { name, email, password, accountType = "student" }) {
  const role = accountType === "staff" ? "operator" : accountType;
  if (!ROLES.has(role)) throw new Error(`Unknown synthetic account type: ${accountType}`);
  const address = security.email(email);
  if (!/@(?:[a-z0-9-]+\.)*example\.test$/.test(address)) throw new Error("Synthetic accounts must use an example.test address.");
  const encoded = await security.hashPassword(security.password(password));
  const uid = randomUUID();
  app.db.prepare("INSERT INTO users(uid,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)")
    .run(uid, address, security.text(name, "name", 80), encoded, role, Date.now());
  return { uid, email: address, role };
}

/** Provision an account, then sign it in on this client. Returns the login response (200). */
export async function signUpForTest(app, client, account) {
  await provisionAccount(app, account);
  return client.request("/api/auth/login", { method: "POST", json: { email: account.email, password: account.password } });
}

/**
 * Windows only lets administrators or Developer Mode create symlinks. Symlink
 * escape tests still run on Linux/macOS and in CI; locally they skip only the
 * symlink step when the operating system refuses to create one.
 */
export const symlinksAvailable = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "tala-symlink-probe-"));
  try {
    fs.writeFileSync(path.join(probe, "target"), "");
    fs.symlinkSync(path.join(probe, "target"), path.join(probe, "link"));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();
/** POSIX permission bits do not exist on Windows; Node reports 0o666 there. */
export const posixModes = process.platform !== "win32";

/** A cookie jar for isolated HTTP tests; authentication values are never logged. */
export class SyntheticHttpClient {
  constructor(baseUrl, origin = "http://127.0.0.1:5173") {
    const url = new URL(baseUrl);
    assert.equal(url.hostname, "127.0.0.1", "Tests may contact loopback only");
    this.baseUrl = url.origin;
    this.origin = origin;
    this.cookies = new Map();
    this.csrfToken = "";
    this.expectedUid = "";
    this.lastSetCookies = [];
  }

  async bootstrap() {
    const response = await this.request("/api/session");
    assert.equal(response.status, 200, "Session bootstrap should succeed");
    assert.equal(typeof response.json?.csrfToken === "string", true);
    this.csrfToken = response.json.csrfToken;
    return response;
  }

  async request(path, options = {}) {
    assert.equal(path.startsWith("/api/"), true);
    assert.equal(new URL(path, this.baseUrl).origin, this.baseUrl);
    const method = options.method ?? "GET";
    const headers = new Headers(options.headers);
    headers.set("Origin", options.origin ?? this.origin);
    if (this.expectedUid && !headers.has("X-TALA-User"))
      headers.set("X-TALA-User", this.expectedUid);
    if (this.cookies.size)
      headers.set(
        "Cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    if (
      method !== "GET" &&
      options.csrf !== false &&
      !headers.has("X-CSRF-Token")
    )
      headers.set("X-CSRF-Token", this.csrfToken);
    let body = options.body;
    if (Object.hasOwn(options, "json")) {
      body = JSON.stringify(options.json);
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    this.lastSetCookies = response.headers.getSetCookie();
    for (const setCookie of this.lastSetCookies) {
      const [entry] = setCookie.split(";");
      const separator = entry.indexOf("=");
      const name = entry.slice(0, separator);
      const value = entry.slice(separator + 1);
      if (!value || /max-age=0(?:;|$)/i.test(setCookie))
        this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    let json;
    if (
      /^application\/json(?:;|$)/i.test(
        response.headers.get("Content-Type") ?? "",
      )
    )
      json = JSON.parse(bytes.toString("utf8"));
    if (typeof json?.csrfToken === "string") this.csrfToken = json.csrfToken;
    if (json && Object.hasOwn(json, "session"))
      this.expectedUid = json.session?.uid ?? "";
    return { status: response.status, headers: response.headers, json, bytes };
  }

  copy() {
    const client = new SyntheticHttpClient(this.baseUrl, this.origin);
    client.cookies = new Map(this.cookies);
    client.csrfToken = this.csrfToken;
    client.expectedUid = this.expectedUid;
    return client;
  }
}

export function assertNoPrivateLocation(value) {
  const serialized = JSON.stringify(value);
  assert.equal(
    /(?:storagePath|downloadUrl|signedUrl|passwordHash|sessionHash|csrfHash)/i.test(
      serialized,
    ),
    false,
    "Public DTOs must not expose private locations or authentication storage",
  );
}
